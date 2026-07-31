(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -------------------------------------------------
     Language toggle (BG default / EN)
     Persisted in localStorage so it carries over
     when navigating between pages.
  ------------------------------------------------- */
  var CLOSED_TEXT = { bg: 'Приключен', en: 'Closed' };
  var LANG_STORAGE_KEY = 'auctionhouse-lang';
  var currentLang = 'bg';

  function setLanguage(lang, persist) {
    if (lang !== 'bg' && lang !== 'en') return;

    currentLang = lang;
    document.body.classList.toggle('lang-bg', lang === 'bg');
    document.body.classList.toggle('lang-en', lang === 'en');
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang') === lang));
    });

    document.querySelectorAll('.lot-countdown[data-closed]').forEach(function (el) {
      el.textContent = CLOSED_TEXT[lang];
    });

    if (persist !== false) {
      try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
      } catch (e) {
        /* localStorage unavailable (e.g. privacy mode) — ignore */
      }
    }
  }

  document.querySelectorAll('.lang-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setLanguage(btn.getAttribute('data-lang'));
    });
  });

  var storedLang = 'bg';
  try {
    storedLang = localStorage.getItem(LANG_STORAGE_KEY) || 'bg';
  } catch (e) {
    /* localStorage unavailable — fall back to default */
  }
  setLanguage(storedLang, false);

  /* -------------------------------------------------
     Light / dark theme toggle
     Defaults to the OS preference on first visit,
     then persists the explicit choice in localStorage.
  ------------------------------------------------- */
  var THEME_STORAGE_KEY = 'auctionhouse-theme';
  var currentTheme = 'dark';

  function setTheme(theme, persist) {
    if (theme !== 'dark' && theme !== 'light') return;

    currentTheme = theme;
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');

    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'light'));
    });

    if (persist !== false) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch (e) {
        /* localStorage unavailable (e.g. privacy mode) — ignore */
      }
    }
  }

  document.querySelectorAll('.theme-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  });

  var storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (e) {
    /* localStorage unavailable — fall back to OS preference */
  }
  if (storedTheme !== 'dark' && storedTheme !== 'light') {
    storedTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  setTheme(storedTheme, false);

  /* -------------------------------------------------
     Mobile nav toggle
  ------------------------------------------------- */
  var header = document.querySelector('.site-header');
  var navToggle = document.querySelector('.nav-toggle');

  if (navToggle && header) {
    navToggle.addEventListener('click', function () {
      var isOpen = header.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.querySelectorAll('.mobile-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        header.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* -------------------------------------------------
     Lot countdown timers
     Reads data-close (ISO date) from each .lot-card
     and updates its .lot-countdown element.
  ------------------------------------------------- */
  var URGENT_THRESHOLD_MS = 48 * 60 * 60 * 1000;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatRemaining(ms) {
    if (ms <= 0) return null;
    var totalSeconds = Math.floor(ms / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return pad(days) + 'd ' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  }

  function initCountdowns(root) {
    var scope = root || document;
    var cards = scope.querySelectorAll('[data-close]');

    cards.forEach(function (card) {
      if (card.hasAttribute('data-countdown-inited')) return;
      card.setAttribute('data-countdown-inited', '');

      var el = card.querySelector('[data-countdown]');
      if (!el) return;

      var closeTime = new Date(card.getAttribute('data-close')).getTime();
      if (isNaN(closeTime)) return;

      function tick() {
        var remaining = closeTime - Date.now();
        var formatted = formatRemaining(remaining);

        if (formatted === null) {
          el.textContent = CLOSED_TEXT[currentLang];
          el.removeAttribute('data-urgent');
          el.setAttribute('data-closed', '');
          return false;
        }

        el.textContent = formatted;
        el.toggleAttribute('data-urgent', remaining <= URGENT_THRESHOLD_MS);
        return true;
      }

      if (!tick()) return;

      var intervalId = setInterval(function () {
        if (!tick()) clearInterval(intervalId);
      }, 1000);
    });
  }

  initCountdowns();

  /* -------------------------------------------------
     Landing-page CTA — hands off to register.html

     Validated here rather than via the `required` attribute:
     native constraint bubbles are rendered in the browser's
     locale, which would ignore the site's BG/EN toggle. Errors
     are injected as paired spans so a language switch is
     handled by CSS alone.
  ------------------------------------------------- */
  var ctaForm = document.getElementById('cta-form');

  if (ctaForm) {
    var ctaEmail = document.getElementById('cta-email');
    var ctaError = document.getElementById('cta-error');
    var CTA_EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

    ctaForm.addEventListener('submit', function (ev) {
      var value = ctaEmail.value.trim();
      var valid = value.length <= 254 && CTA_EMAIL_RE.test(value);

      if (valid) {
        ctaError.hidden = true;
        ctaEmail.removeAttribute('aria-invalid');
        return; // let the GET through to register.html?email=...
      }

      ev.preventDefault();
      ctaError.innerHTML = value
        ? '<span data-bg>Въведете валиден имейл адрес.</span><span data-en>Enter a valid email address.</span>'
        : '<span data-bg>Имейлът е задължителен.</span><span data-en>Email address is required.</span>';
      ctaError.hidden = false;
      ctaEmail.setAttribute('aria-invalid', 'true');
      ctaEmail.focus();
    });
  }

  /* -------------------------------------------------
     Shared namespace for other page scripts
     (e.g. js/property.js re-initializing countdowns
     on dynamically inserted lot cards)
  ------------------------------------------------- */
  window.AuctionHouse = {
    setLanguage: setLanguage,
    initCountdowns: initCountdowns,
    getLanguage: function () { return currentLang; },
    setTheme: setTheme,
    getTheme: function () { return currentTheme; }
  };
})();
