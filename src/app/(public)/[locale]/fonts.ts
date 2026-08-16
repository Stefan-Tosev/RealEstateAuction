/*
 * The three families, self-hosted.
 *
 * This used next/font/google, which downloads the woff2 files during
 * `next build`. On 2026-08-15 that failed a CI run outright —
 * `NextFontError: Failed to fetch 'Inter' from Google Fonts` — and
 * passed on a re-run with no change to anything.
 *
 * CI flaking was the mild version. deploy/deploy.sh runs `npm run build`
 * ON THE PRODUCTION SERVER, after `git pull` has already moved the
 * working tree, so an unreachable font CDN fails a deploy half way
 * through. docs/open-items.md §3.7.
 *
 * The files now live in public/fonts and the @font-face rules in
 * src/styles/fonts.css, both produced by scripts/fetch-fonts.mjs. The
 * build needs no network for fonts at all.
 *
 * The old comment here promised that swapping to local files would touch
 * only this file, because the CSS variable names would not change. That
 * held: --font-playfair, --font-inter and --font-plex-mono mean the same
 * things, and tokens.css still reads them the same way.
 *
 * Cyrillic subsets remain mandatory rather than incidental. v1 loaded
 * these through a plain <link> with no subset parameter and got Cyrillic
 * by luck of the default; for a site whose default language is
 * Bulgarian, that should be explicit. Playfair Display replaces v1's
 * Fraunces for headings because Fraunces ships no Cyrillic at all, so
 * every Bulgarian heading was silently falling back to Georgia.
 */

/**
 * Applied to the public <html>. Defined in tokens.css.
 *
 * A class rather than :root, matching the shape next/font produced: the
 * admin does not apply it and has never used these families, and
 * defining them globally would have restyled the admin as a side effect.
 */
export const fontVariables = "fonts";
