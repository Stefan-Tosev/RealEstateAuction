#!/usr/bin/env bash
#
# Deploy: pull, build, migrate, restart — in that order, and the order is
# the whole point.
#
#   1. Build BEFORE stopping anything. The build takes minutes and does
#      not touch the database, so the old version keeps serving
#      throughout. Only the last few seconds are downtime.
#   2. Stop the worker BEFORE migrating. It closes lots inside
#      transactions; a schema change underneath one is the single worst
#      moment to alter a table.
#   3. Migrate, then restart the app. Never the other way round: new code
#      against an old schema fails on every request.
#
# Run as the auction user:  /srv/auction/deploy/deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/srv/auction}"
cd "$APP_DIR"

say() { echo -e "\n\033[1m==> $*\033[0m"; }

# --- Refuse to deploy on top of uncommitted work ----------------------
#
# Editing a file on the server to fix something urgent, then deploying
# over it, silently discards the fix and reintroduces the bug. Better to
# stop and make somebody look.
if [ -n "$(git status --porcelain)" ]; then
	echo "There are uncommitted changes in $APP_DIR. Commit, stash or discard them first." >&2
	git status --short >&2
	exit 1
fi

say "Fetching"
git fetch --prune origin
BEFORE="$(git rev-parse --short HEAD)"
git checkout main
git pull --ff-only origin main
AFTER="$(git rev-parse --short HEAD)"
echo "$BEFORE -> $AFTER"

say "Installing dependencies"
# `ci`, not `install`: it honours the lockfile exactly. Dev dependencies
# are needed — the build uses TypeScript and Prisma's generator.
npm ci

say "Generating the Prisma client"
npm run db:generate

say "Building"
# Before anything stops. NEXT_PUBLIC_* values are read from .env here and
# some are inlined into the bundle, so .env must be correct BEFORE this
# runs, not after.
npm run build

say "Stopping the worker"
# It must not be mid-transaction when the schema changes.
sudo systemctl stop auction-worker

say "Applying migrations"
# `deploy`, never `dev`: dev tries to author migrations and prompts for a
# name, which on a server means it hangs forever.
npx prisma migrate deploy

say "Restarting the application"
sudo systemctl restart auction-app

say "Starting the worker"
sudo systemctl start auction-worker

# --- Prove it actually came back --------------------------------------
#
# systemctl reporting "active" only means the process is running. It says
# nothing about whether the site answers.
say "Checking it responds"
for attempt in $(seq 1 20); do
	if curl -fsS -o /dev/null http://127.0.0.1:3000/api/time; then
		echo "Responding after ${attempt}s."
		break
	fi
	if [ "$attempt" -eq 20 ]; then
		echo "The application is not responding after 20s. Rolling back is:" >&2
		echo "  git checkout $BEFORE && npm ci && npm run build && sudo systemctl restart auction-app" >&2
		echo "Logs: journalctl -u auction-app -n 50" >&2
		exit 1
	fi
	sleep 1
done

say "Deployed: $AFTER"
systemctl is-active auction-app auction-worker
