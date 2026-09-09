"""Create a consistent SQLite backup without stopping the web application."""

import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3


def backup_database(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.absolute()
    # No silent overwrites; the source must already exist. Use SQLite's backup
    # API instead of copying a live database file mid-transaction.
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    with closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(destination)) as backup:
            original.backup(backup)
            if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Backup verification failed; do not use this backup.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Existing database file")
    parser.add_argument("destination", type=Path, help="New private backup file; must not exist")
    args = parser.parse_args()
    backup_database(args.source, args.destination)
    print(f"Verified backup saved to {args.destination}")
