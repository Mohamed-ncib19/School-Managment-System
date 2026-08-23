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
3. **Snapshots** — a full `pg_dump` runs daily during quiet hours, immediately after a schema migration is detected, or on demand (`POST /api/cloud-backup/backup/now`). Snapshots make restores fast; event batches cover the gap between snapshots.
4. **Manifests** — after each upload the worker writes an encrypted manifest recording the latest contiguous sequence and the newest snapshot key. Restore reads the manifest first, so it knows exactly what to pull.

### Multi-instance safety (split-brain)

Each backend install registers itself in `meta/instances.json` (append-only). If two installs claim to be active simultaneously, the worker **stops syncing and raises a conflict** shown in Settings → Data safety rather than writing divergent history. Retire the old machine ("This is the only copy" / uninstall) to clear it.

The sync worker re-asserts its claim on every drain cycle. A claim with no heartbeat for three hours is treated as a dead machine and no longer blocks a replacement — otherwise a machine that died mid-term would block the very restore the phrase exists for.

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
{school_id}/snapshots/{iso}_{seq}.sql.zst.enc
{school_id}/events/{iso}/{from}-{to}.jsonl.zst.enc
{school_id}/manifests/{iso}.json.enc
```

Objects are **never deleted or overwritten** by the app — ransomware-style rollback through the app is impossible. Prune old objects manually at the provider if cost matters (keep at least the newest snapshot + its manifest).

---

## 4. Setting up (Settings → Data safety)

A four-step wizard:

1. **Choose a destination** — S3-compatible (AWS S3, Cloudflare R2, Backblaze B2), Google Drive, or WebDAV. Test the connection.
2. **Generate the recovery phrase** — 12 words, shown once. Print the recovery sheet. There is no way to recover data without it.
3. **Verify** — the app uploads an encrypted probe and decrypts it back with your phrase.
4. **Activate** — first snapshot runs immediately; continuous sync starts.

## 5. Restoring

### In-app (new machine)

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
| Google Drive | OAuth consent in-app (refresh token stored locally) | Use a dedicated Google account for backups; the app only touches files it created under its own folder. |
| WebDAV | Base URL, username, password (or app password) | Create a dedicated account whose home is the backup directory; disable overwrite/delete rights if your server supports per-method ACLs. |

Credentials are stored with OS-level protection (Windows Credential Manager / DPAPI; keychain-equivalent elsewhere) — never in the database, never in the cloud.

## 7. Troubleshooting

- **Indicator shows "attention"** — open Settings → Data safety; the status panel names the failing target and the exact provider error (secrets redacted).
- **"Another installation is active"** — two machines are syncing to the same school. Shut down the old one and retire it from its Data safety page.
- **Restore says the phrase is wrong** — check word order and spelling; normalization tolerates case and extra whitespace but not wrong words. Three failed verifications lock the form for a minute.
- **Sync stopped after a migration** — a schema change forces a fresh snapshot before events resume; this is intentional and takes a few minutes.
