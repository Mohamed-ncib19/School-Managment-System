# Backup & Disaster Recovery (BACKUP.md)

Zero-knowledge, versioned cloud backup for the School Management System.

- **Export-only** — every backup is one full Importer-compatible JSON file (`iq-data-export`: all 25 school-data tables, system settings and the audit trail included), compressed + encrypted with the admin's secret password, uploaded to your cloud storage. One file per school, replaced on every run.
- **Encrypted end-to-end** — the cloud only ever sees ciphertext. The sole secret is an admin-chosen password, set while connecting Dropbox or the external disk. Importing an encrypted copy always requires typing that password — the app never silently decrypts with a locally stored key.
- **Self-restoring** — any computer with the file + the password rebuilds the school data via Settings → Données → "Importer des données".
- **Worst case data loss**: since the previous export (automatic ~10 s after changes, plus on demand and after migrations).

## Sharing data between two installs (same version)

Two machines running the same release can pass data through each other with the file itself:

1. On machine A (e.g. the director's self-hosted PC): export — either **Settings → Données → "Télécharger l'export"** for a plain `.json`, or let the cloud backup write the encrypted `latest.json.zst.enc` to Dropbox.
2. Send the file to machine B (e.g. the administration computer) — download from Dropbox, or any channel you trust; the `.enc` file stays encrypted in transit and at rest.
3. On machine B: **Settings → Données → "Importer des données"** — drop the file. A plain `.json` (from "Télécharger l'export") previews directly, no password. A `.enc` Dropbox copy **always asks for the secret password** — the password that was set when the cloud destination was connected (the KDF parameters travel in the file header, so either install's password works as long as it is the one used at encryption).

The import replaces the tables present in the file with the file's contents (original ids preserved, so linked records stay consistent). Only the login session of the importing admin is preserved. Machines on **different** versions also work: columns travel with their names and any missing ones are flagged in the preview before anything is written.

---

## 1. How it works

```
DataTransfer exportAll (full iq-data-export JSON)
        │
        AES-256-GCM encrypt ──► upload to targets (versioned file per run)
```

1. **Export** — the app dumps every table (levels, users, fields, professors, groups, students, payments, payroll, schedule, attendance, whiteboards, counters, financial + system settings) into one `iq-data-export` JSON document.
2. **Encrypt + upload** — the JSON is compressed (zstd when the native binding loads, gzip otherwise) and encrypted with the secret password, then uploaded to every enabled destination as `{school_id}/exports/latest.json.zst.enc`, replacing the previous file.
3. **Runs** — automatically ~10 seconds after changes land (when the *Export automatique* switch is on in Data safety), on demand (`POST /api/cloud-backup/backup/now`, "Capture complète maintenant" — one click, loader + done message in the component), and at boot when a schema migration is detected. Flip the switch off for manual-only exports.
4. **Queue trim** — local change-capture rows covered by a landed export are deleted afterwards, so the local buffer stays bounded between exports. While events are still waiting, the header pill turns orange ("attention") across all linked destinations until the next export lands them.

There are no event batches, no snapshots and no cloud manifests. The per-school folder holds exactly that one JSON file and nothing else:

```
{school_id}/exports/latest.json.zst.enc
{school_id}/meta/salt.json          KDF parameters (plaintext)
{school_id}/meta/instances.json     instance registry (plaintext, append-only)
{school_id}/meta/check.json.enc     known-plaintext probe to verify the password
```

Legacy `snapshots/`, `events/` and `manifests/` prefixes written by earlier builds are deleted from each target automatically after the first successful export (`meta/` stays). Objects are otherwise never deleted by the app.

### Multi-instance safety (split-brain)

Each backend install registers itself in `meta/instances.json` (append-only). If two installs claim to be active simultaneously, exports pause and a conflict is shown in Settings → Data safety rather than forking the version history. Retire the old machine to clear it.

A claim with no heartbeat for three hours is treated as a dead machine and no longer blocks a replacement.

### Choosing a destination

The wizard shows **two** destinations. Both are free, neither needs a payment card, and either is done in under a minute:

| Destination | What the administrator provides | Cost |
|---|---|---|
| **Dropbox** | One click on "Se connecter avec Dropbox" — no vendor validation, no test list, works from any computer | 2 GB free |
| **Disque externe ou dossier réseau** | A path — a USB disk, a NAS, a mapped drive | Free |

**Connecting from another computer (no need to sit at the server).** Under the Dropbox connect button, **« Sur un autre poste ? »** shows a link: open it on any device (phone included), approve, then copy the `code` out of the address bar — that page never needs to load — and paste it back. The server swaps the code for its credential itself, so the secret never crosses the browser.

**Why these two, in this order.** Dropbox leads because its consent never shows a validation wall: App-folder registration needs no review and has no test-user list, so login-and-link works for every school on day one. The external disk covers the offline case. The copy-code flow above removes the old loopback restriction — any computer on the network connects the account in two pastes.

**Google Drive is retired from new setups** (its consent page refuses with `access_denied` for most schools: Google gates unreviewed apps behind test users). Installs that already back up to Drive are unaffected — their targets keep syncing and restores still read Drive. No new Drive destination can be created; the API refuses with an explicit message.

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

Google Drive no longer appears in the setup wizard: its consent page refuses most schools (`access_denied` — Google gates unreviewed apps behind test users). Installs configured before the retirement keep working untouched — existing Drive targets keep syncing, and restores still connect a Drive account the same copy-code way described for Dropbox. No *new* Drive destination can be created.

The technical notes below stay for those installs: the app ships its own Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, a **Desktop app** client at console.cloud.google.com → APIs & Services → Credentials), requests only the `drive.file` scope (sees nothing but files it created), and accepts the loopback redirect on any computer via the copied code. Leave both variables blank and the app falls back to asking each install for its own OAuth client.

### Running in a container

The wrapped master key is bound to a machine identity: the Windows MachineGuid, or `/etc/machine-id` on Linux. A container has neither — `node:22-alpine` ships no machine-id and no `hostid` — so one is generated on first run and stored at `/app/.cloud-creds/machine-key`.

**That path must live on a persistent volume.** If it is lost, the locally wrapped key can no longer be unwrapped. The cloud data is unaffected, but recovering it means running the import flow with the recovery phrase rather than simply restarting. `.cloud-creds/` is git- and docker-ignored, so it never travels with a clone or an image.

---

## 2. Object format

Every stored object (export, check file) has the same envelope:

```
[u32 header_length][header JSON (plaintext)][GCM frames (ciphertext)]
```

The header is deliberately plaintext: it must be readable *before* decryption so a future version of the app can open old backups. It contains nothing secret:

```json
{
  "format_version": 1,
  "kind": "data_export | check",
  "school_id": "…",
  "object_key": "…",
  "compression": "zstd | gzip",
  "kdf": { "alg": "argon2id", "salt": "…", "memoryCost": 65536, "timeCost": 3, "parallelism": 1, "keyLen": 32 },
  "cipher": { "alg": "AES-256-GCM", "nonce_base": "…base64, 8 bytes…" },
  "uncompressed_bytes": 123,
  "uncompressed_sha256": "hex…",
  "stored_bytes": 456,
  "created_at": "2026-08-21T02:00:00.000Z",
  "seq_from": 0, "seq_to": 500,
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

The 32-byte master key = Argon2id (m=64 MiB, t=3, p=1) or scrypt fallback over the secret password with a per-school random salt. Salt + parameters travel in the header and in `meta/salt.json`, so the password alone is enough on new hardware.

On the machine that *created* the backup, the derived key is immediately wrapped with a machine-bound key (Windows MachineGuid / `/etc/machine-id`) and stored as `cloud_state.wrapped_key` — the password itself is never persisted anywhere.

---

## 3. Cloud layout

All keys are prefixed by `school_id` — one folder per school, one JSON file per run, nothing else:

```
{school_id}/exports/{date}_{seq}_{time}_{rand}.json.zst.enc
{school_id}/meta/salt.json          KDF parameters (plaintext)
{school_id}/meta/instances.json     instance registry (plaintext, append-only)
{school_id}/meta/check.json.enc     known-plaintext probe to verify the password
```

Exports **reuse one key** (`latest.json.zst.enc`): every run replaces the file, so a backend refusing overwrites would wedge the sync — the upload therefore passes overwrite explicitly on all drivers. Prune old exports manually at the provider if cost matters (keep at least the newest). To import one, download it and open it in Settings → Données → "Importer des données" with the secret password.

---

## 4. Setting up (Settings → Data safety)

A four-step wizard, with only two decisions. The administrator chooses a destination and sets a secret password while connecting it (a further destination can reuse the same password); verification and the first export start on their own and move on when done:

1. **Choose a destination** — Dropbox or an external disk / network folder. Set the secret password, then test the connection.
2. **School id + secret password** — confirm the storage namespace and the password (8 characters minimum). There is no way to recover data without it.
3. **Verify** — automatic: the app uploads an encrypted probe and decrypts it back with your password.
4. **Activate** — automatic: first export runs immediately; automatic exports start (or stay manual if the switch is off).

## 5. Restoring

### Via "Importer des données" (the only restore path)

Each run leaves `{school_id}/exports/latest.json.zst.enc` on every destination: the full data export, encrypted with the same secret password. To recover (new machine, or after data loss):

1. Download `exports/latest.json.zst.enc` from the destination (Dropbox web/app, USB disk, …).
2. Log in as the admin on a fresh install → Settings → **Données** → **Importer des données**.
3. Drop the `.enc` file, type the secret password, preview, then confirm with `IMPORTER`.

It works on a live database (tables in the file replace current rows, original ids preserved) and needs no school id handshake and no empty database. The cloud still only ever sees ciphertext — the password never leaves the server.

### Manual fallback

```bash
# 1. Download exports/latest.json.zst.enc (any S3/Dropbox/WebDAV client)
# 2. Decode with the app's format (see §2) — or import inside the app,
#    which handles decode + verify automatically.
```

---

## 6. Per-provider notes & least-privilege policies

| Provider | Setup | Recommended policy |
|---|---|---|
| AWS S3 | Access key ID + secret, region, bucket | Dedicated IAM user with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject` scoped to one bucket/prefix. Delete rights are needed only for the one-time legacy cleanup. |
| Cloudflare R2 | Account ID + access key + secret, bucket | R2 API token with Object Read & Write on a single bucket only. |
| Backblaze B2 | keyID + applicationKey, bucket | Application key limited to one bucket, type *read/write*. |
| Google Drive (existing installs only, no new setups) | OAuth consent in-app (refresh token stored locally) | Use a dedicated Google account for backups; the app only touches files it created under its own folder. |
| WebDAV | Base URL, username, password (or app password) | Create a dedicated account whose home is the backup directory. |

Credentials are stored with OS-level protection (Windows Credential Manager / DPAPI; keychain-equivalent elsewhere) — never in the database, never in the cloud.

## 7. Update data-safety guarantees (self-hosted updates)

An in-app update (`Mettre à jour maintenant`) is guarded so a school's data can never be damaged by updating:

1. **Verified safety backup before any schema work.** The update engine stops the servers, then `backup-before-schema.ps1` / `.sh` takes a `pg_dump` (custom format) into `backups/pre-schema-<stamp>.dump`. The dump must exist and exceed 1 KB or the **update aborts before touching the schema**. Result is machine-readable in `logs/pre-schema-result.json`. Support emergency override: `SKIP_PRESCHEMA_GUARD=1` in `apps/backend/.env` (logged, never silent). The 5 most recent dumps are kept.
2. **Destructive schema changes are blocked, not force-applied.** The engines run `drizzle-kit push` **without `--force`**: with a non-interactive session, drizzle-kit itself refuses data-loss statements and exits without executing them (verified against the pinned drizzle-kit version). The engine detects this, reports `destructive: true` in the progress journal, shows it in the app, and **pauses the update with zero changes applied** — a human decides, never `--force`. Additive changes (new tables/columns) apply automatically, exit 0.
3. **Post-restart health verification.** After restarting, the engine waits up to 90 s for the API to accept connections on :3001 and reports `healthOk` in the journal. A red restart is surfaced in the app with the recovery step — never a green panel over a dead system.
4. **A failed update never leaves the school dark.** If the update fails after the servers were stopped, the engine restarts them automatically (restarter, never starter — a system that was shut down stays down).

The progress journal (`logs/update-progress.json` → `GET /api/updates/progress`) carries `backupPath`, `destructive` and `healthOk` for the in-app tracker.

## 8. Troubleshooting

- **Indicator shows "attention" (orange)** — either a target is failing (the status panel names it with the exact provider error, secrets redacted) or events are still waiting for the next export to land them on every destination.
- **"Another installation is active"** — two machines export to the same school. Shut down the old one and retire it from its Data safety page.
- **Import says the password is wrong** — retype it exactly (8 characters minimum); three failed verifications lock the form for a minute.
- **Update paused: "schema change needs a decision"** — the new version contains a destructive database change. Nothing was applied; your data and a verified backup are intact. Contact support, or if you manage the release branch yourself, replace the dropped column with a proper additive migration.
- **Pending events keep growing** — normal between exports: they are trimmed automatically after each landed export. They only matter if no export has succeeded for days — check the target errors.
- **"La restauration n'est possible que depuis l'ordinateur du serveur"** — the login-screen recovery flow only accepts requests made on the server machine itself (an unauthenticated door into the database must not sit on the school wifi). Sit at the server to restore, or set `RESTORE_ALLOW_REMOTE=true` in `apps/backend/.env` if a restore genuinely has to be driven from another computer.
