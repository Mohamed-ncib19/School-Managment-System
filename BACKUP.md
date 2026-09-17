# Backup & Disaster Recovery (BACKUP.md)

Zero-knowledge, append-only cloud backup for the School Management System.

- **Continuous** — every INSERT/UPDATE/DELETE is captured by PostgreSQL triggers into a local `sync_queue` and shipped to your cloud storage within seconds to minutes.
- **Encrypted end-to-end** — the cloud only ever sees ciphertext. The sole secret is a 12-word recovery phrase that never leaves paper.
- **Self-restoring** — a brand-new computer can rebuild the whole school database from the cloud + the phrase alone, via the link on the login page.
- **Worst case data loss**: a few minutes (one sync cycle).

---

## 1. How it works

```
PostgreSQL trigger ──► sync_queue (local table)
                              │
                    SyncWorkerService (every 30–300 s)
                              │
              group events by entity ──► event batch object
                              │
        SnapshotService (daily 02:00–04:00 + after migrations)
                              │
              pg_dump ──► snapshot object + manifest
                              │
                   AES-256-GCM encrypt ──► upload to targets
```

1. **Capture** — triggers on every business table write `(table, id, operation, payload)` rows into `sync_queue` with a monotonic `seq`. Triggers are installed idempotently at backend boot (`SyncTriggerBootstrap`) because the schema is managed with `drizzle-kit push`.
2. **Event batches** — the worker drains queued rows in sequence order, groups them, compresses + encrypts them into one immutable object per batch, then marks rows processed. A crash mid-drain re-processes from the last acknowledged sequence — replay is idempotent (`ON CONFLICT DO UPDATE`).
3. **Snapshots** — a full `pg_dump` runs daily during quiet hours, immediately after a schema migration is detected, or on demand (`POST /api/cloud-backup/backup/now`). Snapshots make restores fast; event batches cover the gap between snapshots. Every snapshot also uploads an **Importer-compatible export** (`kind: "data_export"`, the `iq-data-export` JSON in the same envelope with the same phrase) — the copy that survives an instance loss via Settings → Données → "Importer des données" (best-effort; never fails the snapshot).
4. **Manifests** — after each upload the worker writes an encrypted manifest recording the latest contiguous sequence and the newest snapshot key. Restore reads the manifest first, so it knows exactly what to pull.

### Multi-instance safety (split-brain)

Each backend install registers itself in `meta/instances.json` (append-only). If two installs claim to be active simultaneously, the worker **stops syncing and raises a conflict** shown in Settings → Data safety rather than writing divergent history. Retire the old machine ("This is the only copy" / uninstall) to clear it.

The sync worker re-asserts its claim on every drain cycle. A claim with no heartbeat for three hours is treated as a dead machine and no longer blocks a replacement — otherwise a machine that died mid-term would block the very restore the phrase exists for.

### Choosing a destination

The wizard shows **two** destinations. Both are free, neither needs a payment card, and either is done in under a minute:

| Destination | What the administrator provides | Cost |
|---|---|---|
| **Dropbox** | One click on "Se connecter avec Dropbox" — no vendor validation, no test list, works from any computer | 2 GB free |
| **Disque externe ou dossier réseau** | A path — a USB disk, a NAS, a mapped drive | Free |

**Connecting from another computer (no need to sit at the server).** Under the Dropbox connect button, **« Sur un autre poste ? »** shows a link: open it on any device (phone included), approve, then copy the `code` out of the address bar — that page never needs to load — and paste it back. The server swaps the code for its credential itself, so the secret never crosses the browser.

**Why these two, in this order.** Dropbox leads because its consent never shows a validation wall: App-folder registration needs no review and has no test-user list, so login-and-link works for every school on day one. The external disk covers the offline case. The copy-code flow above removes the old loopback restriction — any computer on the network connects the account in two pastes.

**Google Drive is retired from new setups** (its consent page refuses with `access_denied` for most schools: Google gates unreviewed apps behind test users). Installs that already back up to Drive are unaffected — their targets keep syncing and the login-page restore still reads Drive. No new Drive destination can be created; the API refuses with an explicit message.

`App folder` scope also means the app can only ever see the directory it created. It cannot read the user's other files even in principle, which makes the consent screen honest.

**Recommend one of each.** They fan out in parallel, and the pair covers both the failure that happens most often and the one that ends a school. A folder on its own is not off-site — a fire takes the computer and the USB drive in the drawer with it — and a cloud on its own is slower to restore from.

Everything else sits behind **Autres options**, for a school that already has an account somewhere:

| Destination | Cost | Note |
|---|---|---|
| **Backblaze B2** | 10 GB free | Bucket + application key, about 3 minutes |
| **Cloudflare R2** | 10 GB free | Cloudflare requires a payment card to enable R2 |
| **Nextcloud / WebDAV** | Free if self-hosted | URL, user, app password |
| **Autre service S3** | Varies | The escape hatch: MinIO, AWS, Wasabi, anything S3 |

Dropbox appears on the first screen **only when this server has app credentials configured** (`DROPBOX_APP_KEY`). Without them the connect button can only return an error, so it drops into *Autres options* with a note explaining that the missing step belongs to the publisher, not the school.

Wasabi had its own entry and lost it: no free tier, only a 30-day trial. It is still reachable through the generic S3 entry for anyone who pays for it deliberately.

Two questions the wizard no longer asks. The **school id** is derived from the name the install already has (`system_settings.system_name` → `iq-academy`) and shown filled in, editable — it used to be a free-text field with namespace rules. And the S3 entries no longer ask for an endpoint URL, a region format or an addressing style: those are constants per provider that a school administrator cannot answer, and getting one wrong surfaced as a connection error that read like a network fault.

The S3 entries are one driver with the endpoint, region and addressing style supplied by the app. Those three questions are constants per provider and unanswerable by a school administrator, and getting any of them wrong surfaces as a connection error that reads like a network fault. Adding a provider is one entry in `drivers/s3-presets.ts` — no driver code, no UI change.

Everything written to a folder is byte-identical to what goes to S3: same envelope, same AES-256-GCM, same recovery phrase. A lost USB drive is ciphertext.

### Google Drive (existing installs only)

Google Drive no longer appears in the setup wizard: its consent page refuses most schools (`access_denied` — Google gates unreviewed apps behind test users). Installs configured before the retirement keep working untouched — existing Drive targets keep syncing, and the login-page restore still connects a Drive account the same copy-code way described for Dropbox. No *new* Drive destination can be created.

The technical notes below stay for those installs: the app ships its own Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, a **Desktop app** client at console.cloud.google.com → APIs & Services → Credentials), requests only the `drive.file` scope (sees nothing but files it created), and accepts the loopback redirect on any computer via the copied code. Leave both variables blank and the app falls back to asking each install for its own OAuth client.

### Running in a container

The wrapped master key is bound to a machine identity: the Windows MachineGuid, or `/etc/machine-id` on Linux. A container has neither — `node:22-alpine` ships no machine-id and no `hostid` — so one is generated on first run and stored at `/app/.cloud-creds/machine-key`.

**That path must live on a persistent volume.** If it is lost, the locally wrapped key can no longer be unwrapped. The cloud data is unaffected, but recovering it means running the restore flow with the recovery phrase rather than simply restarting. `.cloud-creds/` is git- and docker-ignored, so it never travels with a clone or an image.

---

## 2. Object format

Every stored object (snapshot, event batch, check file, manifest) has the same envelope:

```
[u32 header_length][header JSON (plaintext)][GCM frames (ciphertext)]
```

The header is deliberately plaintext: it must be readable *before* decryption so a future version of the app can open old backups. It contains nothing secret:

```json
{
  "format_version": 1,
  "kind": "snapshot | event_batch | check | manifest",
  "school_id": "…",
  "object_key": "…",
  "compression": "zstd | gzip",
  "kdf": { "alg": "argon2id", "salt": "…", "memoryCost": 65536, "timeCost": 3, "parallelism": 1, "keyLen": 32 },
  "cipher": { "alg": "AES-256-GCM", "nonce_base": "…base64, 8 bytes…" },
  "uncompressed_bytes": 123,
  "uncompressed_sha256": "hex…",
  "stored_bytes": 456,
  "created_at": "2026-08-21T02:00:00.000Z",
  "seq_from": 1, "seq_to": 500,
  "app_version": "0.x.y"
}
```

### Compression layer

Plaintext is split into fixed **1 MiB blocks**, each compressed independently (zstd level 15 when the native binding loads, gzip level 6 otherwise — the algorithm used is recorded in the header). Each block becomes a record:

```
[u32 uncompressed_len][u32 compressed_len][compressed bytes]
```

Compression happens **before** encryption (ciphertext is incompressible).

### Encryption layer

AES-256-GCM with per-object random 8-byte nonce base; frame *n* uses nonce = base ‖ counter(n) (12 bytes total). Each frame:

```
[u32 frame_length][ciphertext][16-byte GCM tag]
```

Any tampering fails the GCM tag; any truncation fails the SHA-256 verification. Restore aborts loudly — never a silent partial result.

### Key derivation

The 32-byte master key = Argon2id (m=64 MiB, t=3, p=1) or scrypt fallback over the recovery phrase with a per-school random salt. Salt + parameters travel in the header and in `meta/salt.json`, so the phrase alone is enough on new hardware.

On the machine that *created* the backup, the derived key is immediately wrapped with a machine-bound key (Windows MachineGuid / `/etc/machine-id`) and stored as `cloud_state.wrapped_key` — the phrase itself is never persisted anywhere.

---

## 3. Cloud layout

All keys are prefixed by `school_id`:

```
{school_id}/meta/salt.json          KDF parameters (plaintext)
{school_id}/meta/instances.json     instance registry (plaintext, append-only)
{school_id}/meta/check.json.enc     known-plaintext probe to verify the phrase
{school_id}/snapshots/{iso}_{seq}_{hhmmss}_{rand}.sql.zst.enc
{school_id}/exports/{iso}_{seq}_{hhmmss}_{rand}.json.zst.enc   Importer-compatible copy (same envelope, same phrase)
{school_id}/events/{iso}/{from}-{to}.jsonl.zst.enc
{school_id}/manifests/{iso}.json.enc
```

Objects are **never deleted** by the app — ransomware-style rollback through the app is impossible — and snapshots/exports **never reuse a key**: every run mints `{date}_{seq}_{time}_{random}`, so a new copy is always a new file and a backend refusing overwrites (Dropbox 409) can never wedge the sync. Two deliberate exceptions, both same-content rewrites rather than history changes: an event batch re-uploads its exact sequence range until acknowledged (idempotent — the retry carries the same events), and the daily manifest is a rewritten pointer to the newest objects. Prune old objects manually at the provider if cost matters (keep at least the newest snapshot + its manifest).

---

## 4. Setting up (Settings → Data safety)

A four-step wizard, with only two decisions. The administrator chooses a destination, then writes down the recovery phrase; verification and the first snapshot start on their own and move on when done:

1. **Choose a destination** — Dropbox or an external disk / network folder. Test the connection.
2. **Generate the recovery phrase** — 12 words, shown once. Print the recovery sheet. There is no way to recover data without it.
3. **Verify** — automatic: the app uploads an encrypted probe and decrypts it back with your phrase.
4. **Activate** — automatic: first snapshot runs immediately; continuous sync starts.

## 5. Restoring

### Via "Importer des données" (Dropbox copy — instance lost or deleted)

Each snapshot leaves `{school_id}/exports/{iso}_{seq}.json.zst.enc` in Dropbox: the full data export, encrypted with the same 12-word phrase. To recover on a fresh install:

1. Download the newest `exports/*.json.zst.enc` from Dropbox (web or app).
2. Log in as the new admin → Settings → **Données** → **Importer des données**.
3. Drop the `.enc` file, type the 12-word phrase, preview, then confirm with `IMPORTER`.

Unlike the login-page restore it works on a live database (tables in the file replace current rows, original ids preserved) and needs no school id, no OAuth handshake, no empty database. The cloud still only ever sees ciphertext — the phrase never leaves the server.

### In-app (new machine, full fidelity)

On the login page: **"Restaurer une sauvegarde"**. Enter the connection details of the same cloud destination + the 12-word phrase. The app verifies the phrase against `check.json.enc`, downloads the newest snapshot, loads it via `psql`, replays event batches up to the manifest's sequence, and drops you straight into the dashboard. The target database must be empty/fresh — restore refuses to run on a school that already has data.

### Manual fallback

```bash
# 1. Download the objects (any S3/GDrive/WebDAV client), e.g.:
#    {school_id}/snapshots/<newest>.sql.zst.enc
# 2. Decode with the app's format (see §2) — or restore inside the app,
#    which handles decode + verify automatically.
# 3. Load the decrypted SQL dump:
psql -U postgres -h localhost -d school_db -v ON_ERROR_STOP=1 -f snapshot.sql
```

The SQL dump is a plain `pg_dump` (custom-format-free, plain SQL) once decoded.

---

## 6. Per-provider notes & least-privilege policies

| Provider | Setup | Recommended policy |
|---|---|---|
| AWS S3 | Access key ID + secret, region, bucket | Dedicated IAM user with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` scoped to one bucket/prefix. No delete permissions. |
| Cloudflare R2 | Account ID + access key + secret, bucket | R2 API token with Object Read & Write on a single bucket only. |
| Backblaze B2 | keyID + applicationKey, bucket | Application key limited to one bucket, type *read/write* (no deleteNativeFiles). |
| Google Drive (existing installs only, no new setups) | OAuth consent in-app (refresh token stored locally) | Use a dedicated Google account for backups; the app only touches files it created under its own folder. |
| WebDAV | Base URL, username, password (or app password) | Create a dedicated account whose home is the backup directory; disable overwrite/delete rights if your server supports per-method ACLs. |

Credentials are stored with OS-level protection (Windows Credential Manager / DPAPI; keychain-equivalent elsewhere) — never in the database, never in the cloud.

## 7. Troubleshooting

- **Indicator shows "attention"** — open Settings → Data safety; the status panel names the failing target and the exact provider error (secrets redacted).
- **"Another installation is active"** — two machines are syncing to the same school. Shut down the old one and retire it from its Data safety page.
- **Restore says the phrase is wrong** — check word order and spelling; normalization tolerates case and extra whitespace but not wrong words. Three failed verifications lock the form for a minute.
- **Sync stopped after a migration** — a schema change forces a fresh snapshot before events resume; this is intentional and takes a few minutes.
