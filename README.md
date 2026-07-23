# Auctio House

Landing page for **Auctio House**, a luxury real estate auction platform. Properties are
listed as auction "lots" with live countdown timers, fixed close dates, and transparent
public bidding.

## Stack

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
