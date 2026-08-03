export const THEME_STORAGE_KEY = "auctionhouse-theme";

/*
 * Runs before first paint, so a visitor who chose light mode never sees
 * a dark flash. The server cannot know the choice — it lives in
 * localStorage — so <body> is rendered with `theme-dark` and this script
 * promotes it. That is why <body> needs suppressHydrationWarning: React
 * would otherwise complain about the class it finds versus the one it
 * rendered.
 *
 * Same storage key as v1, so a returning visitor keeps their preference
 * across the rebuild.
 *
 * Wrapped in try/catch because localStorage throws outright in Safari's
 * private mode — a preference lookup must not be able to blank the page.
 */
const script = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.body.classList.remove('theme-dark','theme-light');
document.body.classList.add('theme-'+t);
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
