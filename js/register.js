/* ---------------------------------------------------
   Registration — Stage 1 (account creation)

   IMPORTANT: this site is static. Everything here is a UX
   control, not a security control — an attacker never runs it.
   Every rule below must be re-run server-side before any of
   it can be trusted, and submission is deliberately stubbed
   until that server exists.

   Deliberately NOT collected at this stage: ЕГН, ID documents
   and proof of funds. Those are step 2 and need a backend that
   can store them lawfully.
--------------------------------------------------- */
(function () {
  'use strict';

  var form = document.getElementById('register-form');
  if (!form) return;

  var summaryEl = document.getElementById('form-summary');
  var noticeEl = document.getElementById('form-notice');
  var companyBlock = document.getElementById('company-block');
  var loadedAt = Date.now();

  /* -------------------------------------------------
     Bilingual helper.

     Injecting BOTH languages as paired spans means a
     language switch is handled entirely by the existing CSS
     (.lang-bg [data-en] { display: none }) — no re-render and
     no stale-language errors. display:none also hides the
     inactive copy from screen readers, so this stays correct
     for assistive tech.
  ------------------------------------------------- */
  function bilingual(bg, en) {
    return '<span data-bg>' + bg + '</span><span data-en>' + en + '</span>';
  }

  /* -------------------------------------------------
     Shared primitives
  ------------------------------------------------- */

  // Control chars, zero-width chars and bidi overrides (U+202E is
  // used to disguise filenames and spoof names).
  var UNSAFE_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

  // Deliberately permissive. Email is validated by delivery, not by
  // regex — an over-strict pattern only produces false rejections.
  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

  // Unicode-aware: must accept Cyrillic and Latin equally.
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /* -------------------------------------------------
     Bulgarian identifiers
  ------------------------------------------------- */

  // BULSTAT / ЕИК — 9 digit base, two-pass mod-11.
  function validEik9(d) {
    var w1 = [1, 2, 3, 4, 5, 6, 7, 8];
    var w2 = [3, 4, 5, 6, 7, 8, 9, 10];
    var sum = 0, i;

    for (i = 0; i < 8; i++) sum += d[i] * w1[i];
    var r = sum % 11;
    if (r < 10) return r === d[8];

    sum = 0;
    for (i = 0; i < 8; i++) sum += d[i] * w2[i];
    r = sum % 11;
    if (r === 10) r = 0;
    return r === d[8];
  }

  // 13-digit branch numbers extend the 9-digit root.
  function validEik13(d) {
    if (!validEik9(d.slice(0, 9))) return false;

    var w1 = [2, 7, 3, 5];
    var w2 = [4, 9, 5, 7];
    var sum = 0, i;

    for (i = 0; i < 4; i++) sum += d[8 + i] * w1[i];
    var r = sum % 11;
    if (r < 10) return r === d[12];

    sum = 0;
    for (i = 0; i < 4; i++) sum += d[8 + i] * w2[i];
    r = sum % 11;
    if (r === 10) r = 0;
    return r === d[12];
  }

  function validEik(raw) {
    if (!/^\d+$/.test(raw)) return false;
    var d = raw.split('').map(Number);
    if (d.length === 9) return validEik9(d);
    if (d.length === 13) return validEik13(d);
    return false;
  }

  /* -------------------------------------------------
     Phone

     BG mobile is +359 8[7-9]XXXXXXX; landlines vary in length
     by city (Sofia 2, Plovdiv 32, Varna 52), so one regex for
     both would reject valid landlines. Foreign bidders are
     expected, so non-BG numbers fall back to generic E.164.
     Real validation is possession — an SMS OTP server-side.
  ------------------------------------------------- */
  function normalizePhone(raw) {
    var s = raw.replace(/[\s()\-.–—]/g, '');
    if (/^00/.test(s)) s = '+' + s.slice(2);
    else if (/^359/.test(s)) s = '+' + s;
    else if (/^0[1-9]/.test(s)) s = '+359' + s.slice(1);
    return s;
  }

  function validPhone(normalized) {
    if (/^\+359/.test(normalized)) return /^\+359[2-9]\d{7,8}$/.test(normalized);
    return /^\+[1-9]\d{7,14}$/.test(normalized);
  }

  /* -------------------------------------------------
     Age

     Parsed from the YYYY-MM-DD parts rather than
     new Date(string), which parses as UTC and shifts the day
     backwards for anyone east of Greenwich — the classic
     off-by-one that lets 17-year-olds through (or blocks
     someone whose 18th birthday is today).
  ------------------------------------------------- */
  function ageFromISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;

    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var birth = new Date(y, mo - 1, d);

    // Rejects 31 Feb and friends, which Date silently rolls over.
    if (birth.getFullYear() !== y || birth.getMonth() !== mo - 1 || birth.getDate() !== d) return null;

    var now = new Date();
    if (birth > now) return -1;

    var age = now.getFullYear() - y;
    var monthDelta = now.getMonth() - (mo - 1);
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d)) age--;
    return age;
  }

  /* -------------------------------------------------
     Password

     NIST SP 800-63B: length over composition. No forced
     uppercase/digit/symbol rules, no rotation, paste allowed.
     The breached-password check that matters (HaveIBeenPwned
     k-anonymity) has to happen server-side; this short list
     only catches the most obvious cases early.
  ------------------------------------------------- */
  var WEAK = [
    'password', 'parola', 'passw0rd', '123456789012', 'qwertyuiop',
    'letmein12345', 'auctionhouse', '111111111111', 'administrator'
  ];

  function passwordProblem(pw, contextValues) {
    if (!pw) return 'empty';
    if (pw.length < 12) return 'short';
    if (pw.length > 128) return 'long';

    var lower = pw.toLowerCase();
    for (var i = 0; i < WEAK.length; i++) {
      if (lower.indexOf(WEAK[i]) !== -1) return 'weak';
    }
    for (var j = 0; j < contextValues.length; j++) {
      var c = contextValues[j];
      if (c && c.length >= 4 && lower.indexOf(c.toLowerCase()) !== -1) return 'personal';
    }
    return null;
  }

  /* -------------------------------------------------
     Error plumbing
  ------------------------------------------------- */
  var errors = [];

  function setError(inputId, messageHtml) {
    var input = document.getElementById(inputId);
    var errEl = document.getElementById('err-' + inputId);
    if (!input || !errEl) return;

    errEl.innerHTML = messageHtml;
    errEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    errors.push({ id: inputId, html: messageHtml });
  }

  function clearError(inputId) {
    var input = document.getElementById(inputId);
    var errEl = document.getElementById('err-' + inputId);
    if (!input || !errEl) return;

    errEl.hidden = true;
    errEl.innerHTML = '';
    input.removeAttribute('aria-invalid');
  }

  var ALL_FIELDS = [
    'reg-first', 'reg-last', 'reg-email', 'reg-phone', 'reg-dob',
    'reg-company', 'reg-eik', 'reg-vat', 'reg-password', 'reg-terms'
  ];

  function isCompany() {
    var checked = form.querySelector('input[name="accountType"]:checked');
    return !!checked && checked.value === 'company';
  }

  /* -------------------------------------------------
     Account type toggle

     Hidden fields are cleared and their errors dropped —
     leaving a hidden field in an invalid state produces a form
     that refuses to submit with no visible reason.
  ------------------------------------------------- */
  function syncAccountType() {
    var company = isCompany();
    companyBlock.hidden = !company;

    if (!company) {
      ['reg-company', 'reg-eik', 'reg-vat'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
        clearError(id);
      });
    }
  }

  form.querySelectorAll('input[name="accountType"]').forEach(function (radio) {
    radio.addEventListener('change', syncAccountType);
  });
  syncAccountType();

  /* -------------------------------------------------
     Validation
  ------------------------------------------------- */
  function validateName(id, bgLabel, enLabel) {
    var v = val(id);
    if (!v) {
      setError(id, bilingual(bgLabel + ' е задължително.', enLabel + ' is required.'));
      return;
    }
    if (v.length > 70 || UNSAFE_RE.test(v) || !NAME_RE.test(v)) {
      setError(id, bilingual(
        'Използвайте букви, интервал, апостроф или тире.',
        'Use letters, spaces, apostrophes or hyphens only.'
      ));
    }
  }

  function validate() {
    errors = [];
    ALL_FIELDS.forEach(clearError);

    validateName('reg-first', 'Името', 'First name');
    validateName('reg-last', 'Фамилията', 'Last name');

    // Email
    var email = val('reg-email');
    if (!email) {
      setError('reg-email', bilingual('Имейлът е задължителен.', 'Email address is required.'));
    } else if (email.length > 254 || UNSAFE_RE.test(email) || !EMAIL_RE.test(email)) {
      setError('reg-email', bilingual(
        'Въведете валиден имейл адрес, напр. ivan@example.bg',
        'Enter a valid email address, e.g. ivan@example.bg'
      ));
    }

    // Phone
    var phoneRaw = val('reg-phone');
    if (!phoneRaw) {
      setError('reg-phone', bilingual('Телефонът е задължителен.', 'Phone number is required.'));
    } else if (!validPhone(normalizePhone(phoneRaw))) {
      setError('reg-phone', bilingual(
        'Проверете номера. Български: 0888 123 456. Международен: +44 20 7946 0958.',
        'Check the number. Bulgarian: 0888 123 456. International: +44 20 7946 0958.'
      ));
    }

    // Date of birth
    var dob = val('reg-dob');
    if (!dob) {
      setError('reg-dob', bilingual('Датата на раждане е задължителна.', 'Date of birth is required.'));
    } else {
      var age = ageFromISO(dob);
      if (age === null) {
        setError('reg-dob', bilingual('Въведете валидна дата.', 'Enter a valid date.'));
      } else if (age < 0) {
        setError('reg-dob', bilingual('Датата не може да е в бъдещето.', 'Date cannot be in the future.'));
      } else if (age < 18) {
        setError('reg-dob', bilingual(
          'Трябва да сте навършили 18 години, за да наддавате.',
          'You must be 18 or older to bid.'
        ));
      } else if (age > 120) {
        setError('reg-dob', bilingual('Проверете годината на раждане.', 'Check the year of birth.'));
      }
    }

    // Company block
    if (isCompany()) {
      var company = val('reg-company');
      if (!company) {
        setError('reg-company', bilingual('Наименованието е задължително.', 'Company name is required.'));
      } else if (company.length > 160 || UNSAFE_RE.test(company)) {
        setError('reg-company', bilingual('Наименованието е невалидно.', 'Company name is not valid.'));
      }

      var eik = val('reg-eik');
      if (!eik) {
        setError('reg-eik', bilingual('ЕИК е задължителен.', 'Company ID is required.'));
      } else if (!/^\d{9}$|^\d{13}$/.test(eik)) {
        setError('reg-eik', bilingual('ЕИК трябва да е 9 или 13 цифри.', 'Company ID must be 9 or 13 digits.'));
      } else if (!validEik(eik)) {
        setError('reg-eik', bilingual(
          'Контролната сума на ЕИК не съвпада. Проверете цифрите.',
          'Company ID checksum does not match. Check the digits.'
        ));
      }

      // Optional — only validated when supplied.
      var vat = val('reg-vat').toUpperCase().replace(/\s/g, '');
      if (vat) {
        if (!/^BG\d{9}$|^BG\d{13}$/.test(vat)) {
          setError('reg-vat', bilingual('Форматът е BG + 9 или 13 цифри.', 'Format is BG followed by 9 or 13 digits.'));
        } else if (!validEik(vat.slice(2))) {
          setError('reg-vat', bilingual('Контролната сума не съвпада.', 'Checksum does not match.'));
        }
      }
    }

    // Password
    var pw = document.getElementById('reg-password').value;
    var problem = passwordProblem(pw, [val('reg-email').split('@')[0], val('reg-first'), val('reg-last')]);
    if (problem === 'empty') {
      setError('reg-password', bilingual('Паролата е задължителна.', 'Password is required.'));
    } else if (problem === 'short') {
      setError('reg-password', bilingual(
        'Паролата трябва да е поне 12 знака.',
        'Password must be at least 12 characters.'
      ));
    } else if (problem === 'long') {
      setError('reg-password', bilingual('Максимум 128 знака.', 'Maximum 128 characters.'));
    } else if (problem === 'weak') {
      setError('reg-password', bilingual(
        'Тази парола е често използвана. Изберете друга.',
        'That password is commonly used. Pick another.'
      ));
    } else if (problem === 'personal') {
      setError('reg-password', bilingual(
        'Паролата не трябва да съдържа името или имейла ви.',
        'Password must not contain your name or email.'
      ));
    }

    // Consent — required, and unticked by default in the markup.
    if (!document.getElementById('reg-terms').checked) {
      setError('reg-terms', bilingual(
        'Трябва да приемете Условията за Продажба и Споразумението за Наддаващи.',
        'You must accept the Terms of Sale and Bidder Agreement.'
      ));
    }

    return errors.length === 0;
  }

  /* -------------------------------------------------
     Summary + focus management
  ------------------------------------------------- */
  function showSummary() {
    var items = errors.map(function (e) {
      return '<li><a href="#' + e.id + '">' + e.html + '</a></li>';
    }).join('');

    summaryEl.innerHTML =
      '<h2>' + bilingual(
        'Моля, коригирайте ' + errors.length + ' ' + (errors.length === 1 ? 'поле' : 'полета') + ':',
        'Please fix ' + errors.length + ' ' + (errors.length === 1 ? 'field' : 'fields') + ':'
      ) + '</h2><ol>' + items + '</ol>';

    summaryEl.hidden = false;
    noticeEl.hidden = true;
    summaryEl.focus();
  }

  summaryEl.addEventListener('click', function (ev) {
    var link = ev.target.closest('a[href^="#"]');
    if (!link) return;
    ev.preventDefault();
    var target = document.getElementById(link.getAttribute('href').slice(1));
    if (target) target.focus();
  });

  /* -------------------------------------------------
     Submit

     Nothing is transmitted and no account is created — saying
     otherwise would be a lie to the user. The notice states
     that plainly rather than faking success.
  ------------------------------------------------- */
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();

    // Bot traps. Silently succeed so a bot learns nothing.
    if (document.getElementById('reg-website').value !== '') return;
    if (Date.now() - loadedAt < 2000) return;

    if (!validate()) {
      showSummary();
      return;
    }

    summaryEl.hidden = true;
    noticeEl.innerHTML =
      '<strong>' + bilingual('Проверката премина успешно.', 'Validation passed.') + '</strong>' +
      bilingual(
        'Формата все още не е свързана със сървър, така че профил не е създаден и нищо не е изпратено. ' +
        'Паролата ви не е запазена никъде.',
        'This form is not connected to a backend yet, so no account was created and nothing was sent. ' +
        'Your password has not been stored anywhere.'
      );
    noticeEl.hidden = false;
    noticeEl.focus();
  });

  /* -------------------------------------------------
     Re-validate a field once it has already errored, so the
     error clears as the user fixes it rather than only on
     the next submit.
  ------------------------------------------------- */
  form.addEventListener('blur', function (ev) {
    var el = ev.target;
    if (!el.id || el.getAttribute('aria-invalid') !== 'true') return;
    validate();
    if (errors.length === 0) summaryEl.hidden = true;
  }, true);

  /* -------------------------------------------------
     Password reveal.

     Paste is deliberately never blocked — blocking it breaks
     password managers and pushes people toward weaker,
     typeable passwords.
  ------------------------------------------------- */
  var pwInput = document.getElementById('reg-password');
  var pwToggle = document.getElementById('password-toggle');

  pwToggle.addEventListener('click', function () {
    var reveal = pwInput.type === 'password';
    pwInput.type = reveal ? 'text' : 'password';
    pwToggle.setAttribute('aria-pressed', String(reveal));
    pwToggle.innerHTML = reveal
      ? bilingual('Скрий', 'Hide')
      : bilingual('Покажи', 'Show');
  });

  /* -------------------------------------------------
     Prefill from the landing-page CTA (?email=...)
  ------------------------------------------------- */
  var params = new URLSearchParams(window.location.search);
  var prefill = params.get('email');
  if (prefill && prefill.length <= 254 && !UNSAFE_RE.test(prefill)) {
    document.getElementById('reg-email').value = prefill;
  }

  // Cap the native date picker at today, so the future-date
  // case is hard to reach in the first place.
  var dobInput = document.getElementById('reg-dob');
  var today = new Date();
  dobInput.max = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
})();
