# Deploying Auction House

From a bare Ubuntu server to a running site. Follow it top to bottom;
every command is meant to be pasted as written, with only the domain and
the passwords changed.

Written for **Ubuntu 24.04 LTS**, 2 vCPU / 4 GB RAM / 40 GB SSD, in the
EU. Everything runs on one machine: the application, PostgreSQL, the
worker and the reverse proxy. At the traffic this will see, splitting
them across servers would add failure modes and no capacity.

**Before you start you need:** the server's IP address, root or sudo
access, and a domain whose DNS you control.

---

## 0. Point the domain at the server first

Do this before anything else, because DNS takes time to propagate and
Caddy cannot obtain a TLS certificate until it has.

At your registrar, create two records:

| Type | Name | Value |
|---|---|---|
| A | `@` | your server's IP |
| A | `www` | your server's IP |

Check it has taken effect — from your own machine:

```bash
dig +short auctionhouse.bg
```

It should print the server's IP. If it prints nothing, wait; some
registrars take an hour.

---

## 1. First login and a user that is not root

```bash
ssh root@YOUR_SERVER_IP

apt update && apt upgrade -y

# The application runs as this user. It has no password and cannot log
# in interactively — nothing should ever be running as root.
adduser --system --group --home /srv/auction --shell /usr/sbin/nologin auction

# And an administrator account for you.
adduser stefan
usermod -aG sudo stefan
```

Copy your SSH key across, then **test it in a second terminal before
closing this one** — locking yourself out of a fresh server is an
irritation; locking yourself out of a running one is an outage:

```bash
ssh-copy-id stefan@YOUR_SERVER_IP
```

Once that works, disable password logins:

```bash
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 2. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

PostgreSQL is deliberately absent from that list. It listens on
localhost only and nothing outside the machine needs to reach it.

---

## 3. Swap — do not skip this on a 4 GB box

`next build` is memory-hungry. On this project, a machine with roughly
1.9 GB free had its build workers killed by the kernel, and the failure
looks like a compiler bug rather than an out-of-memory kill.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## 4. Node.js 22

Ubuntu's own package is too old — the project needs 20.9 or newer.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # expect v22.x
```

---

## 5. PostgreSQL 16

```bash
sudo apt install -y postgresql postgresql-contrib
psql --version

sudo -u postgres psql <<'SQL'
CREATE USER auction WITH PASSWORD 'CHANGE_ME_TO_SOMETHING_LONG';
CREATE DATABASE auction OWNER auction;
SQL
```

The schema uses the `citext` extension. Creating it needs superuser, so
do it now rather than watching the first migration fail:

```bash
sudo -u postgres psql -d auction -c 'CREATE EXTENSION IF NOT EXISTS citext;'
```

Confirm it only listens locally — the default, but worth seeing:

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"   # expect localhost
```

---

## 6. The application

```bash
sudo apt install -y git
sudo mkdir -p /srv/auction
sudo chown stefan:stefan /srv/auction

git clone https://github.com/Stefan-Tosev/RealEstateAuction.git /srv/auction
cd /srv/auction
npm ci
```

### The environment file

This holds every secret. It is not in the repository and must never be.

```bash
nano /srv/auction/.env
```

```ini
# --- Database -------------------------------------------------------
DATABASE_URL="postgresql://auction:THE_PASSWORD_FROM_STEP_5@localhost:5432/auction"

# --- Identity -------------------------------------------------------
# Generate with: openssl rand -base64 48
AUTH_SECRET="PASTE_A_LONG_RANDOM_STRING"

# Both must be the real, public, https URL.
#
# AUTH_URL is not optional in production. Auth.js validates the request
# Host in production and trusts it in development, so getting this wrong
# produces an admin login that worked perfectly in testing and fails on
# the server — this project has already hit exactly that.
AUTH_URL="https://auctionhouse.bg"
NEXT_PUBLIC_SITE_URL="https://auctionhouse.bg"

# --- The first operator ---------------------------------------------
# Used once, by the seed, to create the account you log in with.
ADMIN_EMAIL="you@auctionhouse.bg"
ADMIN_PASSWORD="A_LONG_PASSWORD_YOU_WILL_CHANGE"

# --- The worker -----------------------------------------------------
# Generate with: openssl rand -hex 32
# Without this the closing endpoint refuses every request and no lot
# ever closes. That is deliberate — see the route's comments.
CRON_SECRET="PASTE_ANOTHER_RANDOM_STRING"

# --- Email ----------------------------------------------------------
# Until this is set, every message is queued and logged instead of sent,
# which means verification never arrives and nobody can register.
RESEND_API_KEY=""
MAIL_FROM="Auction House <no-reply@auctionhouse.bg>"

# --- Invoicing ------------------------------------------------------
# Leave demo mode on until the company registration exists. Demo
# invoices are marked SPECIMEN and numbered in a separate DEMO- series,
# so real numbering still starts at 1 when you switch.
INVOICE_DEMO_MODE="true"
INVOICE_ISSUER_NAME=""
INVOICE_ISSUER_EIK=""
INVOICE_ISSUER_VAT=""
INVOICE_ISSUER_ADDRESS=""
INVOICE_ISSUER_IBAN=""

# --- Listing copy drafting (optional) --------------------------------
ANTHROPIC_API_KEY=""
COPY_MODEL="claude-sonnet-5"
```

Lock it down. It contains the database password and every API key:

```bash
sudo chown auction:auction /srv/auction/.env
sudo chmod 600 /srv/auction/.env
```

### Migrate, seed, build

```bash
cd /srv/auction
npm run db:generate
npx prisma migrate deploy
npm run db:seed          # creates the admin account and demo catalogue
npm run build
```

`npm run db:seed` also inserts the seven demo lots. Delete them from the
admin once you have real listings — or before going live.

### Ownership

The app writes uploads to `media/` and `private/`, so it must own them:

```bash
sudo chown -R auction:auction /srv/auction
```

---

## 7. systemd

Two services: the site, and the worker that closes lots and sends
queued email. **Nothing closes a lot without the worker running.**

```bash
sudo cp /srv/auction/deploy/auction-app.service /etc/systemd/system/
sudo cp /srv/auction/deploy/auction-worker.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now auction-app
sudo systemctl enable --now auction-worker

systemctl status auction-app auction-worker
```

Two things about these units that catch people out:

**systemd parses `.env` itself, and not like a shell does.** It strips
surrounding quotes but performs no `$VAR` expansion and no command
substitution. Plain `KEY=value` lines and `#` comments on their own line
are fine — which is all the file above uses. If a service refuses to
start with a message about the environment file, that is a malformed
line, not a code problem.

**The units are hardened**, which means the filesystem is read-only apart
from `media/`, `private/` and `.next/`. If the app fails to start with a
permission error on a path you did not expect, comment out the
`ProtectSystem` and `ReadWritePaths` lines, confirm it starts, and then
add the path back rather than leaving the hardening off.

Check it is actually answering before moving on:

```bash
curl -i http://127.0.0.1:3000/api/time
```

If it is not, the logs say why:

```bash
journalctl -u auction-app -n 50 --no-pager
```

---

## 8. Caddy and TLS

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /srv/auction/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # replace auctionhouse.bg throughout

sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
```

Certificates are obtained automatically within a minute or two, provided
step 0 has propagated. Watch it happen:

```bash
journalctl -u caddy -f
```

Then open `https://auctionhouse.bg` in a browser.

---

## 9. Backups — before you have anything to lose

```bash
sudo chmod +x /srv/auction/deploy/backup.sh
sudo mkdir -p /var/backups/auction
sudo chown auction:auction /var/backups/auction

sudo -u auction crontab -e
```

```cron
15 3 * * * /srv/auction/deploy/backup.sh >> /var/log/auction-backup.log 2>&1
```

Run it once by hand to be sure it works:

```bash
sudo -u auction /srv/auction/deploy/backup.sh
```

**Then read the bottom of `backup.sh` and set up the off-server copy.**
Everything above protects you from deleting a row by mistake. None of it
protects you from losing the server, which is the failure that ends
businesses.

---

## 10. Unattended security updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Deploying a change, afterwards

```bash
cd /srv/auction && ./deploy/deploy.sh
```

It builds before it stops anything, halts the worker before migrating,
and checks the site answers afterwards. Read the comments at the top of
that script before changing the order — each step is where it is for a
reason.

The user running it needs to restart services without a password prompt:

```bash
sudo visudo -f /etc/sudoers.d/auction-deploy
```

```
stefan ALL=(root) NOPASSWD: /bin/systemctl restart auction-app, \
                            /bin/systemctl stop auction-worker, \
                            /bin/systemctl start auction-worker
```

---

## When something is wrong

| Symptom | Where to look |
|---|---|
| Site down | `journalctl -u auction-app -n 100` |
| Lots not closing, no email arriving | `journalctl -u auction-worker -n 100` |
| Certificate problems | `journalctl -u caddy -n 100` |
| Email queued but never sent | `RESEND_API_KEY` empty, or the domain not verified in Resend |
| Admin login fails on the server but worked locally | `AUTH_URL` does not match the real URL |
| Build killed with no error | Out of memory — check swap from step 3 |

Restart everything:

```bash
sudo systemctl restart auction-app auction-worker caddy
```

---

## What this deliberately does not do

**No zero-downtime deploys.** Restarting takes a few seconds and this is
not a site where that matters. Blue-green would add a second copy of the
app, a load balancer and a class of "which version am I talking to?"
bugs, to solve a problem you do not have.

**No Docker.** One machine, one application, one database. Containers
would add a build step, an image registry and a networking layer without
removing anything.

**No monitoring or alerting.** Worth adding once real money moves —
uptime checks and error tracking both have free tiers. Until then,
`journalctl` and a look at `/admin/sales` will tell you more than a
dashboard would.

**No shared cache.** The rate limiter is in Postgres, so it already
survives a restart and would hold across two machines. Nothing else here
keeps state a second process would need.
