# Backup store — format and decisions

**Status (3 October 2026):** core module `telegram-web/backup-store.js` and the dialog (`backup-ui.js`, state in `backup-state.js`) are done and tested (17 + 18 tests) and ran end to end in a real browser on an origin-private folder; not yet run against Google Drive or a flash drive through the UI. Owner approval and the
product-boundary exception are in `AGENTS.md` and `HANDOFF.md`. Background: the data root is the only copy of the data, the PC of the
user sleeps except 15:00–19:00, and she already has Google Drive for desktop (mirroring) and copies to a USB flash drive by hand
once a month. The app writes **encrypted files into a folder the user picks**; the sync client or the USB drive carries them away.
The app makes no network call.

## What is backed up

Everything under the data root except `clients/<client>/declarations/<month>/images/` and `.../exports/` (heavy, and the paper
originals exist). `createBackup({ images: true, exports: true })` includes them. The store folder itself is never backed up.
Result of a run: `{ name, files, bytes, newBlobs, newBytes, packs, skipped }`; a file that cannot be read goes to `skipped` and
into the snapshot, never silently dropped.

## Layout (inside the picked folder)

~~~text
annateria-backup/
├─ store.json                      plain JSON: format, storeId, keyCheck (a sealed constant that proves the key)
├─ packs/pack-<stamp>-<rand>.bin   sealed blobs back to back (~16 MB each)
├─ packs/pack-<stamp>-<rand>.idx   sealed JSON { blobs: { <sha256>: [offset, length] } }
└─ snapshots/snap-<stamp>-<rand>.bin   sealed JSON { createdAt, options, files: { <path>: { h, s } }, skipped }
~~~

- **Sealed** = `iv (12 bytes) || AES-GCM-256 ciphertext+tag`. Additional data binds a purpose: `annateria-key`, `annateria-index`,
  `annateria-snapshot`, and for a blob its own SHA-256 (a blob moved to another hash fails authentication).
- **Content-addressed:** a blob is named by the SHA-256 of the plain file, so unchanged files are stored once across snapshots.
  File names in the store reveal only backup time; paths and sizes are inside sealed snapshots.
- **Write-once:** no file is ever overwritten or deleted by the app. Order inside a run: pack, its index, then the snapshot file
  (the commit point). An interrupted run leaves unreferenced packs, which are harmless.
- Every write is read back and compared by SHA-256; `InvalidStateError` / `NoModificationAllowedError` are retried (5 times,
  growing pause).
- Key: 256 random bits shown once as the **recovery code** (Crockford base32, 4 check characters, 14 groups of four, e.g.
  `XXXX-…`). `keyFromRecoveryCode` returns a non-extractable `CryptoKey` that the UI can keep in IndexedDB; the code is kept
  on paper by the owners. Lose the code and the backups are unreadable. The snapshot name carries the time, so the last backup
  time is known without the key.

## Operations

`createBackup`, `listSnapshots` (no key needed), `readSnapshot`, `verifyStore({ deep })` (every snapshot opens, every needed blob
exists; deep also decrypts and re-hashes), `restoreSnapshot` (into an **empty** folder, each file checked against its hash),
`snapshotsToKeep` (pure retention list: last 30 days, then the newest of each month for 5 years, newest always kept).
Deleting old snapshots or unreferenced packs is a manual, confirmed action still to build.

## Why it looks like this (spike on 3 October, Edge, Google Drive for desktop and a USB flash drive)

- Overwriting an existing file in the Drive folder failed (2 of 25 rewrites, the Windows "cached interface state" error) → write-once.
- 300 small files (~30 MB) took 56 s in the Drive folder, a single 30 MB file 3.2 s on the flash drive → packs of ~16 MB.
- Removing a folder inside Drive partly failed (311 files removed, 2 refused, folder stayed) → no automatic deletion.
- After restarting Edge the saved folder handle asks for permission again (one click); the non-extractable key survived in
  IndexedDB → the UI starts a backup from a button and shows a status plate.
- AES-GCM plus hashing ran at ~330 MB/s, so encryption is not the bottleneck.
- The data root itself must not be inside a synced folder; only backup files are written there.

## The dialog (sidebar item "גיבוי")

- Two slots with their own folder, "גיבוי עכשיו" and "בדיקת תקינות" (deep verify): `cloud` (a folder inside Google Drive for
  desktop) and `usb` (the monthly flash copy). A folder inside the data root is refused.
- Recovery code: created once, shown once; the key is stored in IndexedDB (non-extractable) only after the user ticks that the code is
  written down and confirms. Restore asks for the code when the key is not on this PC.
- Restore: pick the folder that holds `annateria-backup`, pick a snapshot, pick an empty target folder; then switch the data root to it.
- The sidebar item carries a status dot: green when both slots are fresh, red when the cloud copy is older than 2 days or the
  flash copy older than 35 days, yellow when something was never done.
- `common/backup-state.json` (schema 1) only remembers the last success per slot and `includeImages`; it is part of the data and is
  therefore also inside later copies, so after a restore on another PC it can claim a copy that does not exist there until the first run.
- Triggers: `runAuto("start")` when a data root is opened (only if the cloud copy is older than a day) and `runAuto("lock")` after a
  declaration is locked. Both need a saved key, a cloud folder and an already granted permission; they never ask for permission and
  report only real failures in the status bar. After a browser restart the folder permission is "prompt" again, so the first backup
  of a session is the button.

## Hand-off package (sidebar item "העברה")

Use case: one of the owners checks a client's invoices on his PC (import, review), then hands the finished rows to the other PC.
`handoff-store.js` (no DOM) and `handoff-ui.js` (`#handoff-dialog`).

- **Files** in a shared folder both PCs sync (a Google Drive folder): `pkg-<stamp>-<rand>.body` (sealed: 4-byte length, JSON
  `{ rows, images: [{ file, size }] }`, then the image bytes) and `pkg-<stamp>-<rand>.head` (sealed JSON: id, createdAt, clientName,
  month, rows, images, bytes). The body is written first and the head last, so a half-synced package is never listed; a head whose body
  has not arrived yet is reported as "not ready, try again". Write-once, never deleted, sealed with the **same key** as the backup
  (so the other PC enters the same recovery code through "כבר יש לך קוד שחזור" in the backup dialog).
- **Send:** the declaration open in the journal (the open table is saved first) goes out with all its draft rows and the images they use.
- **Receive:** pick a package from the list, the client with the same name is preselected (else it must be chosen), and the rows are
  **appended** to the open declaration of the package month (created if missing; a locked one is refused). Images get the next free
  numbers of the target declaration (`003.jpg` ...) and the rows are rewritten to point at them, so existing files are never touched.
  The dialog says what will happen before the click. What was imported is remembered in `common/handoff-state.json`; importing the same
  package again asks for confirmation. The open table is detached before the import and the declaration reopened after it (as in the
  Excel import). A package from another key is reported as a wrong code.

## Still to do

Manual, confirmed clean-up of old snapshots and unreferenced packs and of old hand-off packages; rollout on the real PC with a restore
drill (restore into an empty folder, open it in the app, report totals match) and the first real hand-off between the two PCs.
