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
          el.setAttribute('data-closed', '');
          return false;
        }

        el.textContent = formatted;
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
     Shared namespace for other page scripts
     (e.g. js/property.js re-initializing countdowns
     on dynamically inserted lot cards)
  ------------------------------------------------- */
  window.AuctionHouse = {
    setLanguage: setLanguage,
    initCountdowns: initCountdowns,
    getLanguage: function () { return currentLang; }
  };
})();
