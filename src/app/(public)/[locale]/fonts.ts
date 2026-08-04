import { IBM_Plex_Mono, Inter, Playfair_Display } from "next/font/google";

/*
 * Cyrillic subsets are mandatory, not optional. v1 loaded these through
 * a plain Google Fonts <link> with no subset parameter and got Cyrillic
 * by luck of the default — for a site whose default language is
 * Bulgarian, that should be explicit.
 *
 * Playfair Display replaces v1's Fraunces for headings: Fraunces ships
 * no Cyrillic at all (Google Fonts coverage is latin, latin-ext,
 * vietnamese), so every Bulgarian heading was silently falling back to
 * Georgia. Playfair is the same high-contrast display register and does
 * carry Cyrillic.
 *
 * Note next/font/google downloads at build time, so `next build` needs
 * network access. If that becomes a problem, swap to next/font/local
 * with checked-in .woff2 files — the CSS variable names stay the same,
 * so only this file changes.
 */

export const playfair = Playfair_Display({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const fontVariables = `${playfair.variable} ${inter.variable} ${plexMono.variable}`;
