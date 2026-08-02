# Auction House

Landing page for **Auction House**, a luxury real estate auction platform. Properties are
listed as auction "lots" with live countdown timers, fixed close dates, and transparent
public bidding.

## v2 app (in progress)

The repo is mid-pivot to a real platform — see `docs/architecture.md` for the full spec.
Phase 0 (schema, auth, admin shell) lives alongside the v1 static files below in `src/`,
`prisma/` and `tests/`.

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL / AUTH_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
docker compose up -d        # local Postgres
npx prisma migrate dev
npm run db:seed             # creates the first admin user from .env
npm run dev                 # http://localhost:3000/admin/login
```

Tests: `npm test` (Vitest, unit) and `npm run test:e2e` (Playwright, needs `npm run dev`
running against a seeded database).

## v1 static prototype — Stack

Plain HTML/CSS/JS — no framework, no build step.

## Project structure

```
/
├── index.html
├── css/
│   └── styles.css
├── js/
│   └── main.js
├── assets/
│   └── images/
└── README.md
```

## Running locally

No build step is required — just serve the directory with any static file server, for example:

```bash
# Python
python3 -m http.server 8000

# Node (via npx)
npx serve .
```

Then open `http://localhost:8000` in your browser.
