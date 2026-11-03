# Nightly production database backups

The production host runs `pure3d-database-backup.timer` daily at **02:00 UTC**.
`Persistent=true` runs a missed backup when the timer becomes active again.
The job takes online SQLite snapshots of `data.db` (records, schema, settings and
accounts) and `auxiliary.db` (PocketBase auxiliary data). Uploaded files, 3D assets,
R2/MinIO objects and hooks are **not** included. No application restart is needed.

Snapshots are stored in `/var/backups/pure3d-database/nightly-YYYYMMDDTHHMMSSZ/`
on the existing production server. The directory is root-only; each snapshot has
both databases and a manifest with SHA-256 hashes and successful SQLite integrity
checks. The SQLite online backup API captures committed WAL contents. Each database
is consistent independently; the pair is not a cross-database atomic transaction.
Incomplete snapshots are not published. Only completed snapshots created by this
job older than 30 days are removed, and only after a successful new backup.
Existing manual PocketBase ZIP backups are left untouched.

**These are same-server recovery copies, not off-server disaster recovery.** Loss
of the server/disk can lose these copies too. No external failure notification is
configured: inspect systemd status/journal and backup freshness. Host snapshots or
an independent encrypted storage destination remain separate work.

## Installation

Production installation requires explicit authorisation. Use the verified SSH
host and strict host-key checking from `AGENTS.md`. Confirm the live PocketBase
data mount first. Source files are under `pocketbase/backup/`:

- Install `backup-databases.py` as root-owned
  `/usr/local/sbin/pure3d-database-backup` with mode `0700`.
- Create `/var/backups/pure3d-database` as root-owned with mode `0700`.
- Install the service and timer in `/etc/systemd/system/` with mode `0644`.
- Run `systemd-analyze verify` on the units, then `systemctl daemon-reload`.
- Run `systemctl start pure3d-database-backup.service` and confirm success, hashes
  and database integrity before enabling the timer with
  `systemctl enable --now pure3d-database-backup.timer`.

No credentials, production content, schema changes or PocketBase hook deployments
are needed. A read-only source database must already exist; missing databases fail
the job rather than silently creating empty backups.

Installed and enabled on 3 November 2026. The initial service run succeeded; both
database copies passed independent hash, integrity, table-presence and private-file
permission checks. The next scheduled run was 4 November 2026 at 02:00 UTC.
This verifies the initial run and timer configuration, not future nightly executions.

## Operations

Run on the production host with `sudo -n`:

```sh
systemctl list-timers --all pure3d-database-backup.timer
systemctl status pure3d-database-backup.service --no-pager
journalctl -u pure3d-database-backup.service --since '2 days ago' --no-pager
ls -ld /var/backups/pure3d-database/nightly-*
```

The timer being enabled alone is not evidence of successful nightly backups:
check that the latest completed snapshot is less than 26 hours old and the last
service result is `success`. Failed jobs are recorded in the systemd journal.

For a recovery, obtain separate authorisation and stop PocketBase before replacing
database files, preserving its current database/WAL files and ownership first.
Never replace a live SQLite database. Verify the manifest hashes and run
`PRAGMA integrity_check` on recovery copies. These raw snapshots are not PocketBase
ZIP archives and must not be passed to its ZIP restore API. Restoring databases
cannot recover excluded uploads or assets. A live production restore has not been
performed merely by verifying the snapshots.
