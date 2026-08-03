"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "./theme-script";

type Theme = "dark" | "light";

/*
 * Sun and moon SVGs are both rendered; chrome.css shows whichever
 * matches the current body class (body.theme-dark .icon-sun, etc). That
 * is v1's approach and it means the icon is correct on first paint,
 * before this component has hydrated and learned the theme.
 */
export function ThemeToggle({ labelToLight, labelToDark }: {
  labelToLight: string;
  labelToDark: string;
}) {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Read what the inline script already applied, rather than reading
  // localStorage again — one source of truth for the current theme.
  useEffect(() => {
    setTheme(document.body.classList.contains("theme-light") ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.classList.add(`theme-${next}`);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the toggle still works for this page view.
    }
    setTheme(next);
  }

  // Until hydration the label is unknown; `theme` is null and we show the
  // dark-mode label, matching the server-rendered body class.
  const label = theme === "light" ? labelToDark : labelToLight;

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label}>
      <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
