/*
 * Fetch the exact woff2 subsets Google serves, so the build stops needing
 * to. Run once; the output is committed.
 *
 * Deduplicated by URL: Playfair and Inter are variable fonts, so Google
 * serves ONE file per subset covering every weight and declares a
 * separate @font-face per weight pointing at it. Storing them per weight
 * would have committed 12 identical copies.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* Exactly what src/app/(public)/[locale]/fonts.ts asks for today. */
const FAMILIES = [
  { slug: "playfair", query: "Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600" },
  { slug: "inter", query: "Inter:wght@400;500;600" },
  { slug: "plex-mono", query: "IBM+Plex+Mono:wght@400;500" },
];

/* fonts.ts requests subsets: ["latin", "cyrillic"] — nothing else. */
const WANTED = new Set(["latin", "cyrillic"]);

/** url -> { file, family, subset, style, weights[], range } */
const byUrl = new Map();

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.query}&display=swap`;
  const css = await (await fetch(url, { headers: { "User-Agent": UA } })).text();

  for (const block of css.split("/*").slice(1)) {
    const subset = block.slice(0, block.indexOf("*/")).trim();
    if (!WANTED.has(subset)) continue;

    const src = /src:\s*url\((https:[^)]+\.woff2)\)/.exec(block);
    const weight = /font-weight:\s*([^;]+);/.exec(block);
    const style = /font-style:\s*(\w+);/.exec(block);
    const range = /unicode-range:\s*([^;]+);/.exec(block);
    const name = /font-family:\s*'([^']+)'/.exec(block);
    if (!src || !weight || !style || !range || !name) continue;

    const existing = byUrl.get(src[1]);
    if (existing) {
      existing.weights.push(Number(weight[1].trim()));
      continue;
    }

    byUrl.set(src[1], {
      slug: family.slug,
      family: name[1],
      subset,
      style: style[1],
      weights: [Number(weight[1].trim())],
      range: range[1].trim(),
    });
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const faces = [];
let bytes = 0;

for (const [url, face] of byUrl) {
  const weights = [...new Set(face.weights)].sort((a, b) => a - b);
  // Variable files carry a range; static ones name their single weight.
  const suffix = weights.length > 1 ? "var" : String(weights[0]);
  const file = `${face.slug}-${face.subset}-${suffix}-${face.style}.woff2`;

  const data = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
  await writeFile(path.join(OUT, file), data);
  bytes += data.length;

  faces.push({
    file,
    family: face.family,
    style: face.style,
    weight: weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : String(weights[0]),
    range: face.range,
  });
  console.log(`${file}  ${(data.length / 1024).toFixed(1)}kB  weight ${weights.join("/")}`);
}

console.log(`\n${faces.length} files, ${(bytes / 1024).toFixed(0)}kB total`);

/* The stylesheet, generated so the unicode-ranges cannot drift by hand. */
const css = [
  "/*",
  " * Self-hosted fonts.",
  " *",
  " * GENERATED — see scripts/fetch-fonts.mjs. Do not hand-edit; the",
  " * unicode-ranges must match the subsets the files were cut to, and",
  " * getting one wrong shows up as missing Cyrillic rather than an error.",
  " *",
  " * These were fetched from Google Fonts once and committed, so the build",
  " * needs no network for them. next/font/google downloaded them at BUILD",
  " * time, which failed a CI run outright and would fail a deploy half way",
  " * through — deploy.sh builds on the server after git pull has already",
  " * moved the tree. See docs/open-items.md §3.7.",
  " *",
  " * Playfair Display and Inter are variable: one file per subset covers",
  " * every weight, which is why font-weight is a range.",
  " */",
  "",
]
  .concat(
    faces.map((face) =>
      [
        "@font-face {",
        `  font-family: "${face.family}";`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        "  font-display: swap;",
        `  src: url("/fonts/${face.file}") format("woff2");`,
        `  unicode-range: ${face.range};`,
        "}",
        "",
      ].join("\n"),
    ),
  )
  .join("\n");

await writeFile(process.argv[3], css);
console.log(`wrote ${process.argv[3]}`);
