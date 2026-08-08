#!/usr/bin/env bash
#
# Backup: the database AND the files it points at.
#
# Both, always. Legal packs and property photographs live on disk, not in
# Postgres — deleting a row has never deleted a file in this project, and
# a database-only backup restores a catalogue of documents that are not
# there. Of the two, the files are the ones that cannot be reconstructed:
# a notary's деед is not something you can regenerate.
#
# Run from cron as the auction user:
#   15 3 * * * /srv/auction/deploy/backup.sh >> /var/log/auction-backup.log 2>&1
#
# A backup on the same disk as the thing it is backing up is not a
# backup. See "Getting it off the box" at the bottom — that step is the
# one people skip and the one that matters.

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/auction}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/auction}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# shellcheck disable=SC1091
set -a; source "$APP_DIR/.env"; set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

echo "[$(date -u +%FT%TZ)] backup starting -> $DEST"

# --- Database --------------------------------------------------------
#
# Custom format (-Fc), not plain SQL: it restores selectively with
# pg_restore and compresses as it writes.
echo "  database…"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$DEST/database.dump"

# --- Files -----------------------------------------------------------
#
# private/ first, because it is the irreplaceable one. media/ is
# photography that could in principle be retaken; a legal pack could not.
echo "  private/ (legal packs)…"
if [ -d "$APP_DIR/private" ]; then
	tar -czf "$DEST/private.tar.gz" -C "$APP_DIR" private
else
	echo "    nothing there yet"
fi

echo "  media/ (photographs)…"
if [ -d "$APP_DIR/media" ]; then
	tar -czf "$DEST/media.tar.gz" -C "$APP_DIR" media
else
	echo "    nothing there yet"
fi

# --- Verify ----------------------------------------------------------
#
# An unverified backup is a hope. pg_restore --list fails loudly on a
# truncated or corrupt dump, which is the failure you want to hear about
# now rather than during a restore.
echo "  verifying…"
pg_restore --list "$DEST/database.dump" > /dev/null
for archive in "$DEST"/*.tar.gz; do
	[ -e "$archive" ] || continue
	gzip -t "$archive"
done

# A dump of an empty database succeeds and is worthless. Anything under
# about 20 KB means something went wrong upstream.
SIZE="$(stat -c%s "$DEST/database.dump")"
if [ "$SIZE" -lt 20000 ]; then
	echo "  WARNING: database dump is only ${SIZE} bytes. Check the database is not empty." >&2
fi

# --- Retention -------------------------------------------------------
#
# Applied only after the new backup has been written and verified, so a
# failing backup never deletes the last good one.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +

echo "[$(date -u +%FT%TZ)] backup complete: $(du -sh "$DEST" | cut -f1)"

# --- Getting it off the box ------------------------------------------
#
# THIS IS THE PART THAT MATTERS. Everything above protects you from
# deleting a row by mistake. None of it protects you from losing the
# server, which is the failure that ends businesses.
#
# Pick one and uncomment it:
#
#   # Hetzner Storage Box, or any host over SSH (~€3/month):
#   rsync -az --delete "$BACKUP_DIR/" backup@your-storage-box:/auction/
#
#   # Cloudflare R2 / S3 / Backblaze, via rclone:
#   rclone sync "$BACKUP_DIR" remote:auction-backups
#
# Then, once, prove it works: restore into a scratch database and open
# the site against it. A backup nobody has restored is a backup nobody
# knows the state of.
#
#   createdb auction_restore_test
#   pg_restore --dbname=auction_restore_test /var/backups/auction/<stamp>/database.dump
