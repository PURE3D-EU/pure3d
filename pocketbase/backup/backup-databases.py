#!/usr/bin/env python3
"""Take verified, database-only PocketBase snapshots on the production host."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime, timedelta, timezone


SOURCE = Path('/opt/pure3d-archive/platform/pocketbase/pb_data')
DESTINATION = Path('/var/backups/pure3d-database')
DATABASES = ('data.db', 'auxiliary.db')
SNAPSHOT_NAME = re.compile(r'^nightly-\d{8}T\d{6}Z$')


def main():
    os.umask(0o077)
    DESTINATION.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (DESTINATION / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        started = datetime.now(timezone.utc)
        target = DESTINATION / started.strftime('nightly-%Y%m%dT%H%M%SZ')
        staging = Path(tempfile.mkdtemp(prefix='.incomplete-', dir=DESTINATION))
        try:
            manifest = {'createdAt': started.isoformat(), 'databases': {}}
            for name in DATABASES:
                source = SOURCE / name
                if not source.is_file():
                    raise RuntimeError(f'Missing source database: {name}')
                output = staging / name
                deadline = time.monotonic() + 600

                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise TimeoutError(f'Backup deadline exceeded: {name}')

                # SQLite's online backup API includes committed WAL contents;
                # copying live .db files directly would not be safe.
                reader = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
                writer = sqlite3.connect(output)
                try:
                    reader.backup(writer, pages=256, progress=progress)
                    # Keep recovery copies self-contained, without WAL sidecars.
                    writer.execute('PRAGMA journal_mode=DELETE')
                    result = writer.execute('PRAGMA integrity_check').fetchall()
                    if result != [('ok',)]:
                        raise RuntimeError(f'Integrity check failed: {name}')
                finally:
                    writer.close()
                    reader.close()
                with output.open('rb') as handle:
                    digest = hashlib.file_digest(handle, 'sha256').hexdigest()
                    os.fsync(handle.fileno())
                manifest['databases'][name] = {
                    'bytes': output.stat().st_size,
                    'sha256': digest,
                    'integrity': 'ok'
                }
            with (staging / 'manifest.json').open('x') as handle:
                json.dump(manifest, handle, indent=2)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
            directory_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            staging.rename(target)
            directory_fd = os.open(DESTINATION, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if staging.exists():
                shutil.rmtree(staging)

        # Prune only this job's completed snapshots, after a successful backup.
        cutoff = started - timedelta(days=30)
        for entry in DESTINATION.iterdir():
            if entry.is_symlink() or not entry.is_dir() or not SNAPSHOT_NAME.fullmatch(entry.name):
                continue
            created = datetime.strptime(entry.name, 'nightly-%Y%m%dT%H%M%SZ').replace(
                tzinfo=timezone.utc
            )
            if created < cutoff:
                shutil.rmtree(entry)
        print(f'Verified database backup: {target}; retention: 30 days', flush=True)


if __name__ == '__main__':
    main()
