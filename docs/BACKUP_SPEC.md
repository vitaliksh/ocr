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

## Transfer file (sidebar item "העברה לקובץ")

Use case: one owner checks a client's invoices on his PC and hands the result to the other PC, or a whole client moves between the
PCs. One file, `<client>_<MM-YYYY|all>.annateria`, goes by USB drive, e-mail or any folder (a shared Drive folder was tried first and
dropped as impractical). `transfer-store.js` (no DOM) and `transfer-ui.js` (`#transfer-dialog`).

- **Format:** `ANNATERIA-TRANSFER-1
` + sealed (the same AES-GCM sealing and **key** as the backup, so both PCs need the same recovery
  code: "כבר יש לך קוד שחזור" in the backup dialog) of `[4-byte length][JSON meta][image bytes in meta order]`. Meta: kind (`month` or
  `client`), client name/activity/kind, and per month the `declaration.json`, the draft rows, the history lines of a locked month and
  the image list. Without the key nothing is readable; a wrong key, a foreign file and a damaged file give different messages.
- **Export:** choose client and month (or "all months") in the dialog; the entry points preselect them: the "⋯" of a client in the
  sidebar ("ייצוא לקוח לקובץ…"), the "ייצוא" button of a month on the client card, and "ייצוא הצהרה לקובץ…" in the journal's "⋯". Images
  are a checkbox (on for one month, off for all months) with the size shown first; above ~20 MB it warns that e-mail will not take
  it (Gmail sends up to 25 MB, larger files go as a Drive link). The save dialog opens first (it needs the click), then the open
  table is saved if it belongs to the export, then the file is built.
- **Import:** "בחירת קובץ…" reads and decrypts it and shows client, months (open/locked) and counts. The client with the same name is
  preselected; with no match the default is to create the client (after a confirmation). Import only **adds**:
  - a month this PC lacks: an open one is created, a locked one is copied exactly as it was (same declaration id, rows, images and
    its history lines; the history of a declaration is never written twice);
  - an open month here: only rows whose `documentId` is not there yet are appended, their images get the next free numbers
    (`003.jpg` ...), nothing existing is touched; rows whose image was not in the file lose the image reference;
  - a locked month here is never changed (reported as skipped).
  Importing the same file again therefore adds nothing. This is an add-only merge, not a sync: an edit of an existing row does not
  travel. The result lists every month (`created`, `appended`, `copied-locked`, `skipped-locked`). The open table is detached before
  the import and the result opened afterwards (a month, or the client card for a whole client).

## Still to do

Manual, confirmed clean-up of old snapshots and unreferenced packs; rollout on the real PC with a restore drill (restore into an
empty folder, open it in the app, report totals match) and the first real transfer between the two PCs.
