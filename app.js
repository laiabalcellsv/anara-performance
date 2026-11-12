/* Your Anara performance: creators see their own numbers and their team; leads see their own team in detail;
   anyone with an @anara.com email sees every team. Logging in = a 6-digit code we email, once per device.
   The numbers come from the login server (worker/worker.js) only after the code is checked. Keep this file ASCII-only. */
(() => {
  'use strict';
  const API = 'https://script.google.com/macros/s/AKfycbzeQk-7q6dgsY630cCQjir0CPqDs0bleHCHOI_wHXnnixnHizJhozAnJp9mawWt7igt/exec';                  // the login server, filled in by make_github_page.py
  const BUILD = '202611121407';              // this version of the page, filled in by make_github_page.py
  const app = document.getElementById('app');
  const KEY = 'yap-login-v2';                 // {email, token} on this device
  const OLD_KEYS = ['yap-session-v1'];        // the old email-only login: cleared on every visit
  const DOT = ' \u00b7 ';
  const PLAT = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook', snapchat: 'Snapchat' };
  const STATUS = {
    'On track': ['ok', 'On track'],
    'Missed last week': ['warn', 'Missed last week'],
    'Under 2 weeks in a row': ['bad', 'Under 2 weeks in a row'],
    'Starts this week': ['accent', 'Target starts this week'],
    'Paused last week': ['muted', 'Paused last week'],
    'New': ['muted', 'New, no weekly target yet'],
  };
  // What creators read about their own last week: [colour, tag, line]. Friendly, never threatening (Lucas + Laia,
  // 12 Nov 2026, after a Champion left over the higher targets: "convince creators the expectations are very doable and
  // help them get there"). Amber, not red. Leads keep the plain STATUS labels above in their team tables.
  // The line gets the lead's first name (ln), or '' for leads themselves and creators without a lead (former leads).
  const ME_STATUS = {
    'On track': ['ok', 'On track', () => 'You hit your target last week. Great work, keep it going!'],
    'Missed last week': ['warn', 'Under target last week', (ln) => 'One good week gets you right back on track' + (ln ? ', and ' + ln + ' can help with ideas.' : '.')],
    'Under 2 weeks in a row': ['warn', 'Under target 2 weeks', (ln) => ln ? ln + ' will check in to help you plan this week and get back on track.' : 'One good week gets you right back on track.'],
    'Starts this week': ['accent', 'Target starts this week', () => "Your weekly target starts this week. You've got this!"],
    'Paused last week': ['muted', 'Paused last week', () => "You took last week off, so it doesn't count against you. Your target is back on this week."],
    'New': ['muted', 'New, no weekly target yet', () => 'No weekly target in your first 4 weeks. Use them to find the formats that work for you.'],
  };
  const leadFirst = (m) => (m.lead ? '' : (m.team_lead || '').replace(/^Fred \(.*$/, 'Fred').split(' ')[0]);
  const S = { email: null, token: null, keep: true, p: null, full: null, f: { q: '', team: '', status: '' }, open: new Set(),
    as: null, staffP: null, people: null };   // as = name shown in "View as" (@anara.com only)

  /* ---------- small helpers */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      e.append(k.nodeType ? k : String(k));
    }
    return e;
  }
  function fmt(n) {
    if (n == null || isNaN(n)) return '\u2013';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return s + String(Math.round(a));
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function daysUntil(iso) {
    const p = String(iso).split('-').map(Number);
    const now = new Date();
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  }
  function inDays(d) { return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days'; }
  function timeLeft(endMs) {
    const ms = endMs - Date.now();
    if (ms <= 0) return 'week closed, new numbers tomorrow';
    const d = Math.floor(ms / 864e5);
    if (d >= 1) return d === 1 ? '1 day left' : d + ' days left';
    const hrs = Math.max(1, Math.round(ms / 36e5));
    return hrs === 1 ? '1 hour left' : hrs + ' hours left';
  }
  function pill(kind, text) { return h('span', { class: 'yap-pill yap-pill--' + kind, text }); }
  function vid(x) {
    const label = (x.who ? x.who + ': ' : '') + fmt(x.views) + ' on ' + (PLAT[x.platform] || x.platform || 'video');
    const link = /^https:\/\//i.test(String(x.link || '')) ? String(x.link) : '';
    if (!link) return h('span', { class: 'yap-vid', text: label });
    return h('a', { class: 'yap-vid', href: link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label + ', opens the video' }, label);
  }
  function showErr(el, text) { el.textContent = text; el.hidden = false; }
  function v50State(v) {
    if (!v.due || v.state === 'done' || v.state === 'none') return v.state;
    return daysUntil(v.due) < 0 ? 'overdue' : v.state;
  }
  const isOverdue = (v) => { const s = v50State(v); return s === 'overdue' || s === 'none'; };
  function shortWeek(label) {
    const m = String(label).match(/^(\d+)\s*([A-Z][a-z]{2})?/);
    const mon = String(label).match(/([A-Z][a-z]{2})\s*$/);
    return m ? m[1] + ' ' + (m[2] || (mon ? mon[1] : '')) : label;
  }

  /* ---------- talking to the login server */
  const NET = "We couldn't reach the server. Check your internet connection and try again.";
  // One address (a Google Apps Script web app on Laia's Anara account). Plain-text POST, so browsers send it
  // without an extra permission check; the answer always carries "status" because Apps Script can't set HTTP codes.
  // Google hands each answer back once, through a redirect, and only for a few seconds. A slow or repeated read gets
  // a stand-in reply ({"status":200,"ok":true}) or an error page instead (seen 11 Nov 2026), so ask() checks that the
  // answer has what we asked for and asks once more if not.
  async function call(action, data, ms) {
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 20000) : 0;
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, data || {})), cache: 'no-store', credentials: 'omit', redirect: 'follow',
        referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined });
      let body = {};
      try { body = (await r.json()) || {}; } catch (e) { body = {}; }
      if (typeof body !== 'object') body = {};
      const status = Number(body.status) || 500;
      return { status, ok: status === 200, body };
    } finally { clearTimeout(timer); }
  }
  // Up to two tries. Returns the first answer that has what we need (good) or is a clear "no" from the server (it has
  // an error); after two lost answers returns { lost: true }. Throws only when neither try reached the server.
  async function ask(action, data, good, ms) {
    let lost = false, failed = null;
    for (let i = 0; i < 2; i++) {
      if (i) await wait(1500);
      let r;
      try { r = await call(action, data, ms); } catch (e) { failed = e; continue; }
      if (r.ok ? good(r.body) : !!r.body.error) return r;
      lost = true;
    }
    if (lost) return { status: 0, ok: false, lost: true, body: {} };
    throw failed || new Error('network');
  }
  // Wakes the login script up while the person types their email, so the code goes out faster. Answer ignored.
  let warmed = false;
  function warmUp() {
    if (warmed) return;
    warmed = true;
    try { fetch(API, { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' }).catch(() => {}); } catch (e) { /* fine */ }
  }
  const hasNumbers = (b) => (b.kind === 'staff' && !!b.full) || (b.kind === 'person' && !!b.p);
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /* ---------- staying logged in (this device only) */
  function store(keep) { try { return keep ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
  function readSession() {
    for (const keep of [true, false]) {
      try {
        const st = store(keep);
        const s = JSON.parse((st && st.getItem(KEY)) || 'null');
        if (s && s.email && s.token) return { email: s.email, token: s.token, keep };
      } catch (e) { /* nothing usable stored */ }
    }
    return null;
  }
  function dropSession() {
    for (const keep of [true, false]) { try { const st = store(keep); if (st) st.removeItem(KEY); } catch (e) { /* nothing stored */ } }
  }
  function writeSession(email, token, keep) {
    dropSession();
    try { const st = store(keep); if (st) st.setItem(KEY, JSON.stringify({ email, token })); } catch (e) { /* storage blocked: logged in for this visit only */ }
  }
  function logout() {
    dropSession();
    Object.assign(S, { email: null, token: null, p: null, full: null });
    viewLogin();
  }

  function mount(cls, ...nodes) {
    app.className = 'yap' + (cls ? ' ' + cls : '');
    app.replaceChildren(...nodes.flat().filter(Boolean));   // sections with nothing to show are skipped
  }
  function render(top) {
    if (S.p && S.p.staff && S.full) viewAll();
    else if (S.p && S.p.me) viewMe();
    else if (S.p && S.p.team) viewTeamOnly();
    else if (S.as) { backToAll(); return; }
    else { dropSession(); viewLogin("We couldn't find your numbers. Ask your team lead."); return; }
    if (S.as) app.prepend(h('div', { class: 'yap-asbar', role: 'status' },
      h('span', null, 'Viewing as ', h('b', { text: S.as }), ', exactly what they see'),
      h('button', { type: 'button', class: 'yap-link', onclick: backToAll, text: 'Back to every team' })));
    if (top) window.scrollTo(0, 0);
  }

  /* ---------- "View as" (@anara.com only; the login script checks that too) */
  async function fillPeople(sel) {
    if (!S.people) {
      let r;
      try { r = await ask('data', { token: S.token, as: 'list' }, (b) => Array.isArray(b.people)); } catch (e) { return; }
      if (!r.ok) return;
      S.people = r.body.people;
    }
    const groups = {};
    S.people.forEach((x) => { const t = x.team || 'Other'; (groups[t] = groups[t] || []).push(x); });
    Object.keys(groups).sort().forEach((t) => {
      const list = groups[t].sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.name.localeCompare(b.name));
      sel.append(h('optgroup', { label: t }, ...list.map((x) => h('option', { value: x.key, text: x.name + (x.lead ? ' (lead)' : '') }))));
    });
    sel.disabled = false;
  }
  async function viewAs(key, name) {
    mount('', h('p', { class: 'yap-loading', text: 'Opening ' + name + '\u2019s page\u2026' }));
    let r;
    try { r = await ask('data', { token: S.token, as: key }, hasNumbers); } catch (e) { r = null; }
    if (!r || !r.ok || r.body.kind !== 'person') { render(true); return; }   // stay on every team
    if (!S.as) S.staffP = S.p;
    S.as = name; S.p = r.body.p;
    render(true);
  }
  function backToAll() {
    if (S.staffP) S.p = S.staffP;
    S.staffP = null; S.as = null;
    render(true);
  }

  async function loadNumbers(email, token, keep) {
    mount('', h('p', { class: 'yap-loading', text: 'Opening your numbers\u2026' }));
    let r;
    try { r = await ask('data', { token }, hasNumbers, 25000); } catch (e) { viewProblem(NET); return; }
    if (r.lost) { viewProblem("We couldn't open your numbers just now. Try again in a minute."); return; }
    if (r.status === 401) { dropSession(); viewLogin('Please log in again.'); return; }
    if (r.status === 403) { dropSession(); viewLogin("We can't find your email on the Creators Tracker any more. If that's wrong, ask your team lead."); return; }
    if (!r.ok) { viewProblem('The numbers are being updated right now. Try again in a few minutes.'); return; }
    useNumbers(email, token, keep, r.body);
  }
  function useNumbers(email, token, keep, b) {
    if (b.token && b.token !== token) { token = b.token; writeSession(email, token, keep); }   // a refreshed login
    Object.assign(S, { email, token, keep });
    if (b.kind === 'staff' && b.full) { S.full = b.full; S.p = { staff: true, who: b.who || '' }; }
    else { S.full = null; S.p = b.p || {}; }
    render(true);
  }

  // GitHub Pages lets browsers keep the page for 10 minutes. If a newer version is out, load it right away
  // (Laia, 11 Nov 2026: "the switch is not working" was her browser's saved copy). One try per version, no loops.
  function checkVersion() {
    if (!window.fetch || !/^\d{12}$/.test(BUILD)) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
      .then((r) => r.json())
      .then((j) => {
        const v = String((j && j.v) || '');
        if (!/^\d{12}$/.test(v) || v === BUILD) return;
        if (new URLSearchParams(window.location.search).get('v') === v) return;   // already reloaded for this one
        window.location.replace(window.location.pathname + '?v=' + v + window.location.hash);
      })
      .catch(() => { /* offline or blocked: keep this version */ });
  }

  function boot() {
    checkVersion();
    try { OLD_KEYS.forEach((k) => window.localStorage.removeItem(k)); } catch (e) { /* nothing stored */ }
    if (!window.fetch || !/^https?:\/\//.test(API)) { viewProblem('Something went wrong. Refresh the page.'); return; }
    const s = readSession();
    if (!s) { viewLogin(); return; }
    loadNumbers(normEmail(s.email), s.token, s.keep);
  }

  /* ---------- log in: your email, then the 6-digit code we email you */
  function shell(...card) {
    return h('main', { class: 'yap-login' },
      h('p', { class: 'yap-eyebrow', text: 'Anara creator program' }),
      h('h1', { class: 'yap-title', text: 'Your Anara performance' }),
      h('p', { class: 'yap-lede', text: 'Your weekly views, your 50K videos and your team, all in one place.' }),
      h('section', { class: 'yap-card yap-card--form' }, ...card),
      h('p', { class: 'yap-foot', text: 'The first time you log in on a phone or computer, we email you a 6-digit code. After that you stay logged in. The numbers update every morning.' }));
  }

  function viewProblem(msg) {
    mount('', shell(
      h('p', { class: 'yap-err', role: 'alert', text: msg }),
      h('p', { class: 'yap-actions' },
        h('button', { class: 'yap-btn', type: 'button', onclick: () => window.location.reload(), text: 'Try again' }),
        h('button', { class: 'yap-link', type: 'button', onclick: logout, text: 'Log out' }))));
  }

  const CODE_ERR = {
    bad_email: 'Type the email you use with Anara.',
    slow_down: 'Too many codes for now. Wait an hour, or use the last code we sent you.',
    send_failed: "We couldn't send the email just now. Try again in a few minutes.",
    busy: 'The server is busy. Try again in a minute.',
  };
  async function askCode(email) {
    let r;
    try { r = await ask('code', { email }, () => true, 15000); } catch (e) { return { err: NET }; }
    if (r.ok) return { ok: true };
    // both answers got lost on the way back, but the email has usually gone out
    if (r.lost) return { ok: true, note: 'If no email comes in a few minutes, ask for a new code below.' };
    if (r.body.error === 'wait') return { ok: true, note: 'We just sent you a code. You can ask for a new one in ' + (r.body.wait || 30) + ' seconds.' };
    return { err: CODE_ERR[r.body.error] || 'Something went wrong. Try again in a few minutes.', haveCode: r.body.error === 'slow_down' };
  }

  function viewLogin(msg, prefill) {
    const input = h('input', { id: 'yap-email', class: 'yap-input', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: 'you@example.com' });
    if (prefill) input.value = prefill;
    const keep = h('input', { id: 'yap-keep', type: 'checkbox', checked: true });
    const err = h('p', { class: 'yap-err', role: 'alert', hidden: !msg, text: msg || '' });
    const btn = h('button', { class: 'yap-btn', type: 'submit', text: 'Email me a code' });
    const form = h('form', { class: 'yap-form', novalidate: true },
      h('label', { class: 'yap-label', for: 'yap-email', text: 'Your email' }), input,
      h('label', { class: 'yap-check', for: 'yap-keep' }, keep, h('span', { text: 'Keep me logged in on this device' })),
      btn, err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const email = normEmail(input.value);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showErr(err, 'Type the email you use with Anara.'); return; }
      // straight to the code box: the email goes out meanwhile and any problem shows up there
      viewCodeStep(email, keep.checked, askCode(email));
    });
    mount('', shell(form));
    warmUp();
  }

  function viewCodeStep(email, keep, pending) {
    let sentAt = Date.now();
    const errMsg = '', note = '';
    const input = h('input', { id: 'yap-code', class: 'yap-input yap-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '12', spellcheck: 'false', placeholder: '123456', 'aria-describedby': 'yap-code-help' });
    const err = h('p', { class: 'yap-err', role: 'alert', hidden: !errMsg, text: errMsg || '' });
    const info = h('p', { class: 'yap-info', role: 'status', hidden: !note, text: note || '' });
    const btn = h('button', { class: 'yap-btn', type: 'submit', text: 'Log in' });
    const again = h('button', { class: 'yap-link', type: 'button', text: 'Email me a new code' });
    const other = h('button', { class: 'yap-link', type: 'button', text: 'Use a different email', onclick: () => viewLogin('', email) });
    let busy = false;
    async function check() {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { showErr(err, 'Type the 6 digits from the email.'); return; }
      if (busy) return;
      busy = true; btn.disabled = true; btn.textContent = 'Checking\u2026'; err.hidden = true; info.hidden = true;
      let r = null;
      for (let i = 0; i < 3; i++) {
        // a lost answer is asked again: the script accepts the same right code for 2 more minutes
        try { r = await ask('verify', { email, code }, (b) => typeof b.token === 'string' && b.token.length > 20, 15000); } catch (e) { r = null; break; }
        if (r.lost) break;
        // a code sent a moment ago can take a few seconds to reach every server
        if (r.body.error === 'expired' && Date.now() - sentAt < 120000 && i < 2) { await wait(2500); continue; }
        break;
      }
      busy = false; btn.disabled = false; btn.textContent = 'Log in';
      if (!r) { showErr(err, NET); return; }
      if (r.lost) { showErr(err, "We couldn't check the code just now. Try again in a minute."); return; }
      if (r.ok && r.body.token) {
        writeSession(email, r.body.token, keep);
        if (hasNumbers(r.body)) useNumbers(email, r.body.token, keep, r.body);   // the numbers came with the login
        else loadNumbers(email, r.body.token, keep);
        return;
      }
      const e = r.body.error;
      if (e === 'wrong') showErr(err, "That code isn't right. " + (r.body.left === 1 ? '1 try left.' : r.body.left + ' tries left.'));
      else if (e === 'locked') showErr(err, 'Too many wrong tries. Ask for a new code.');
      else if (e === 'expired') showErr(err, 'That code has expired or was already used. Ask for a new one.');
      else showErr(err, 'Type the 6 digits from the email.');
      try { input.select(); } catch (x) { /* fine */ }
    }
    const form = h('form', { class: 'yap-form', novalidate: true },
      h('p', null, 'If ', h('b', { text: email }), ' is on our list, a 6-digit code is on its way. It can take a minute, so check your spam folder too.'),
      h('label', { class: 'yap-label', for: 'yap-code', text: 'Code from the email' }), input, btn, err, info,
      h('p', { class: 'yap-actions' }, again, other),
      h('p', { id: 'yap-code-help', class: 'yap-foot', text: 'Nothing after 5 minutes? Use the email from your contract, or ask your team lead.' }));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); check(); });
    input.addEventListener('input', () => { if (input.value.replace(/\D/g, '').length === 6) check(); });
    again.addEventListener('click', async () => {
      again.disabled = true; err.hidden = true;
      const res = await askCode(email);
      if (res.err) showErr(err, res.err);
      else { sentAt = Date.now(); info.textContent = res.note || 'We sent a new code. Use the one in the newest email.'; info.hidden = false; }
      setTimeout(() => { again.disabled = false; }, 30000);
    });
    mount('', shell(form));
    try { input.focus(); } catch (e) { /* fine */ }
    // the first code may still be on its way out: show any problem once the server answers
    if (pending) pending.then((res) => {
      if (res.err) showErr(err, res.err);
      else if (res.note) { info.textContent = res.note; info.hidden = false; }
    });
  }

  function topbar(title, meta) {
    return h('header', { class: 'yap-top' },
      h('div', { class: 'yap-top-l' }, h('p', { class: 'yap-eyebrow', text: 'Your Anara performance' }), h('h1', { class: 'yap-hi', text: title }),
        meta ? h('p', { class: 'yap-meta', text: meta }) : null),
      h('button', { type: 'button', class: 'yap-link', onclick: logout, text: 'Log out' }));
  }

  /* ---------- 50K videos block (creator card and team details) */
  function v50Block(m, mine) {
    const v = m.v50, st = v50State(v);
    const dl = h('dl', { class: 'yap-kv' });
    const row = (k, ...vals) => dl.append(h('dt', { text: k }), h('dd', null, ...vals));
    if (m.level === 'New') {
      row('First video over 50K', ...(v.first ? [h('b', { text: v.first.date_label }), vid(v.first)] : [h('span', { text: 'Not yet' })]));
    } else {
      row('Last video over 50K', ...(v.last50 ? [h('b', { text: v.last50.date_label }), vid(v.last50)] : [h('span', { text: 'None yet' })]));
      if (m.level === 'Champion') row('Last video over 100K', ...(v.last100 ? [h('b', { text: v.last100.date_label }), vid(v.last100)] : [h('span', { text: 'None yet' })]));
    }
    // creators read "goal" and "focus this week" in amber; leads keep "due" and "Overdue" in red (12 Nov 2026)
    const dueKey = mine ? (m.level === 'New' ? 'First goal' : 'Next goal') : (m.level === 'New' ? 'First one due' : 'Next one due');
    const help = m.plan ? ' Your plan above can help.' : leadFirst(m) ? ' ' + leadFirst(m) + ' can help you pick formats that go viral.' : '';
    if (st === 'done') {
      row('Next step', h('span', { text: mine ? 'Done, great work! From week 5, the goal is one video over 50K every 3 weeks.' : 'Done. From week 5: one video over 50K every 3 weeks.' }));
    } else if (st === 'none') {
      if (mine) row(dueKey, pill('warn', 'Focus this week'), h('span', { text: cap(v.need || 'one video over 50K') + '.' + help }));
      else row(dueKey, pill('bad', 'Overdue'), h('span', { text: 'No video over 50K yet. Needs ' + (v.need || 'one') + '.' }));
    } else if (st === 'overdue') {
      if (mine) row(dueKey, pill('warn', 'Focus this week'), h('span', { text: cap(v.need) + ' (it was due ' + v.due_label + ').' + help }));
      else row(dueKey, pill('bad', 'Overdue since ' + v.due_label), h('span', { text: 'Needs ' + v.need + '.' }));
    } else {
      const d = daysUntil(v.due);
      row(dueKey, h('b', { text: 'By ' + v.due_label }), pill(st === 'soon' ? 'warn' : 'ok', inDays(d)), h('span', { class: 'yap-sub', text: cap(v.need) }));
    }
    const out = [dl];
    if (v.not_counted) {
      out.push(h('p', { class: 'yap-warnline' }, (mine ? 'Your ' : 'Their ') + fmt(v.not_counted.views) + ' video from ' + v.not_counted.date_label +
        " doesn't count as a 50K video because " + v.not_counted.why + '. ', vid(v.not_counted)));
    }
    if (v.paused_ext && st !== 'done') {
      out.push(h('p', { class: 'yap-sub', text: 'Due date moved back ' + v.paused_ext + (v.paused_ext === 1 ? ' week' : ' weeks') + ' because of ' + (v.paused_ext === 1 ? 'a paused week' : 'paused weeks') + '.' }));
    }
    const rule = String(v.rule || '');
    if (rule) out.push(h('p', { class: 'yap-rule', text: mine ? 'The goal: ' + rule.charAt(0).toLowerCase() + rule.slice(1) : 'Rule: ' + rule }));
    return out;
  }

  /* ---------- my numbers (every creator; leads also get their team in detail) */
  function viewMe() {
    const m = S.p.me;
    const lvl = m.level === 'New' ? 'New creator' : m.level;
    // leads (Laia, 11 Nov 2026): their own best videos above "Your team", the team's best videos at the bottom
    const rest = S.p.team ? [cardTop(m), teamCard(S.p.team, 'Your team'), cardTeamTop(S.p.team)] : [cardTeam(m), cardTop(m)];
    mount(S.p.team ? 'is-mid' : '',
      topbar('Hi ' + m.first, lvl + DOT + m.team_label + DOT + 'updated ' + m.asof_label),
      cardPlan(m), cardThisWeek(m), card50(m), cardWeeks(m), rest, howItWorks(!!S.p.team));
  }

  function viewTeamOnly() {
    const t = S.p.team;
    mount('is-mid', topbar('Hi ' + S.p.who, t.label + DOT + 'updated ' + t.asof_label), teamCard(t, 'Your team'), cardTeamTop(t), howItWorks(true));
  }

  function cardThisWeek(m) {
    const c = m.cur, t = c.target;
    const parts = [h('div', { class: 'yap-card-h' }, h('h2', { text: 'This week' }), h('span', { class: 'yap-sub', text: c.label + DOT + timeLeft(c.end_ms) }))];
    if (t) {
      const done = c.views >= t;
      parts.push(h('p', { class: 'yap-big' }, h('b', { text: fmt(c.views) }), h('span', { text: 'of ' + fmt(t) + ' views' })));
      const fill = h('i', { class: done ? 'is-done' : null });
      fill.style.width = (c.views > 0 ? Math.max(2, Math.min(100, (c.views / t) * 100)) : 0) + '%';
      parts.push(h('div', { class: 'yap-meter', role: 'meter', 'aria-label': 'Views this week', 'aria-valuemin': '0', 'aria-valuemax': String(t), 'aria-valuenow': String(c.views) }, fill));
      // no "45.6K to go by Mon 16 Nov at midnight Los Angeles time" line (Lucas, 12 Nov 2026: "intense and stressful")
      const note = done ? 'Target hit for this week. Amazing work!' : c.views >= t / 2 ? 'Over halfway there, keep going!' : '';
      if (note) parts.push(h('p', { class: 'yap-note', text: note }));
      if (m.moved_up) {
        parts.push(h('p', { class: 'yap-flag', text: m.status === 'Starts this week'
          ? 'Your weekly target starts this week: ' + fmt(t) + ' views.'
          : 'Congrats on moving up to ' + m.level + '! Your target is now ' + fmt(t) + ' views a week' + (leadFirst(m) ? ', and ' + leadFirst(m) + ' is here to help you get there.' : '.') }));
      }
    } else {
      parts.push(h('p', { class: 'yap-big' }, h('b', { text: fmt(c.views) }), h('span', { text: 'views so far' })));
      parts.push(h('p', { class: 'yap-note', text: m.next_target
        ? 'No weekly target yet. Your ' + fmt(m.next_target.target) + '-a-week target starts ' + m.next_target.date_label + '.'
        : 'No weekly target yet.' }));
    }
    if (c.started !== 'before') {
      const allow = c.allowance || 15;
      const daysTxt = c.days_of > 0 && c.days >= c.days_of ? ' You have posted every day so far.'
        : ' You posted on ' + c.days + ' of the ' + c.days_of + (c.days_of === 1 ? ' day' : ' days') + ' so far.';
      parts.push(h('p', { class: 'yap-note', text: (c.videos >= allow ? 'Videos so far: ' + c.videos + ', so your ' + allow + ' for this week are done. Nice!'
        : 'Videos so far: ' + c.videos + ' of your ' + allow + ' this week.') + daysTxt + (allow > 15 ? ' Because you got over 100K views last week, you can post up to ' + allow + ' this week, all paid.' : '') }));
    }
    parts.push(h('p', { class: 'yap-hint', text: 'Weekly views = all the views on the videos you post this week, Tuesday to Monday, on every platform. Videos can take a day to show up here.' }));
    return h('section', { class: 'yap-card', id: 'this-week' }, ...parts);
  }

  function card50(m) {
    return h('section', { class: 'yap-card', id: 'videos-50k' }, h('div', { class: 'yap-card-h' }, h('h2', { text: '50K videos' })), ...v50Block(m, true));
  }

  function cardWeeks(m) {
    const tiles = m.weeks.map((w) => {
      if (w.started === 'before') {
        return h('li', { class: 'yap-wk is-none' }, h('span', { class: 'yap-wk-l', text: w.label }), h('b', { class: 'yap-wk-v', text: '\u2013' }),
          h('span', { class: 'yap-wk-t', text: 'Before you started' }));
      }
      if (w.paused) {
        return h('li', { class: 'yap-wk is-paused' }, h('span', { class: 'yap-wk-l', text: w.label }), h('b', { class: 'yap-wk-v', text: 'Paused' }),
          h('span', { class: 'yap-wk-t', text: 'Not counted' }));
      }
      const kind = w.target == null ? 'none' : w.hit ? 'ok' : 'warn';   // a missed week is amber on the creator's own page
      return h('li', { class: 'yap-wk is-' + kind },
        h('span', { class: 'yap-wk-l', text: w.label }),
        h('b', { class: 'yap-wk-v', text: fmt(w.views) }),
        h('span', { class: 'yap-wk-t', text: w.target == null ? 'No target' : (w.hit ? 'Hit ' : 'Under ') + fmt(w.target) }),
        h('span', { class: 'yap-wk-n' + (w.low || w.days_low ? ' is-low' : ''), text: w.videos + (w.videos === 1 ? ' video' : ' videos') + ', ' + w.days + '/7 days' }));
    });
    const st = ME_STATUS[m.status] || ['muted', m.status, () => ''];
    return h('section', { class: 'yap-card', id: 'last-4-weeks' },
      h('div', { class: 'yap-card-h' }, h('h2', { text: 'Last 4 weeks' }),
        h('span', { class: 'yap-sub', text: m.counted ? 'Target hit ' + m.hit + ' of ' + m.counted + ' weeks' : 'No target in these weeks' })),
      h('ol', { class: 'yap-weeks' }, ...tiles),
      h('p', { class: 'yap-statusline' }, pill(st[0], st[1]), h('span', { text: st[2](leadFirst(m)) })),
      warnPosting(m));
  }

  function warnPosting(m) {
    const lowV = m.weeks.filter((w) => w.low).length, lowD = m.weeks.filter((w) => w.days_low).length;
    if (!lowV && !lowD) return null;
    const bits = [];
    if (lowV) bits.push('fewer than 10 videos in ' + lowV + (lowV === 1 ? ' week' : ' weeks'));
    if (lowD) bits.push('on fewer than 6 days in ' + lowD + (lowD === 1 ? ' week' : ' weeks'));
    return h('p', { class: 'yap-warnline', text: 'Heads up: you posted ' + bits.join(', and ') + '. Aim for at least 10 videos a week, on 6 of the 7 days, since more videos means more chances to go viral.' });
  }

  function cardTeam(m) {
    const list = h('ol', { class: 'yap-team' },
      h('li', { class: 'yap-team-h', 'aria-hidden': 'true' }, h('span'), h('span', { text: 'Creator' }), h('span', { class: 'yap-num', text: 'Weeks hit' }),
        h('span', { class: 'yap-num', text: 'Last wk' }), h('span', { class: 'yap-num', text: 'This wk' })));
    m.team_rows.forEach((r, i) => {
      const lastCls = r.last_target != null && r.last >= r.last_target ? ' is-hit' : '';   // no red for teammates who missed
      list.append(h('li', { class: r.you ? 'is-you' : null, 'aria-label': r.name + (r.you ? ' (you)' : '') + ': ' + (r.counted ? r.hit + ' of ' + r.counted + ' weeks hit' : 'new') + ', ' + Math.round(r.last).toLocaleString('en-US') + ' views last week, ' + Math.round(r.cur).toLocaleString('en-US') + ' so far this week' },
        h('span', { class: 'yap-rank', text: String(i + 1) }),
        h('span', { class: 'yap-tname', text: r.you ? r.name + ' (you)' : r.name }),
        h('span', { class: 'yap-num', text: r.counted ? r.hit + ' of ' + r.counted : r.status === 'Starts this week' ? 'Starts now' : 'New' }),
        h('span', { class: 'yap-num' + (r.last_paused ? '' : lastCls), text: r.last_paused ? 'Paused' : fmt(r.last) }),
        h('span', { class: 'yap-num', text: fmt(r.cur) })));
    });
    return h('section', { class: 'yap-card', id: 'your-team' },
      h('div', { class: 'yap-card-h' }, h('h2', { text: 'Your team' }), h('span', { class: 'yap-sub', text: m.team_label + DOT + m.team_rows.length + ' creators' })),
      list,
      h('p', { class: 'yap-hint', text: "Ranked by weeks hit in the last 4 weeks, then last week's views. Green = hit their target last week." }));
  }

  /* ---------- 50K plan (Laia, 11 Nov 2026): creators whose 50K was overdue when the week started (Tuesday) */
  function planVid(x) {
    const label = (x.who ? x.who + ': ' : '') + fmt(x.views) + ' on ' + (PLAT[x.platform] || x.platform || 'video') + (x.date_label ? DOT + x.date_label : '');
    const link = /^https:\/\//i.test(String(x.link || '')) ? String(x.link) : '';
    if (!link) return h('span', { class: 'yap-vid', text: label });
    return h('a', { class: 'yap-vid', href: link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label + ', opens the video' }, label);
  }
  function planIntro(p, mine) {
    // creators: a goal and a plan, no "overdue", "make up for it" or midnight deadline (12 Nov 2026). Leads keep the exact deadline.
    if (mine) return "This week's goal: " + p.need + (p.reason === 'overdue' ? ' (it was due ' + p.due_label + ')' : '') + ". Here's a plan to help you get there.";
    const by = (String(p.need).indexOf(',') >= 0 ? ', by ' : ' by ') + p.ends_label + ', midnight Los Angeles time.';
    if (p.reason === 'overdue') return 'Their 50K video is overdue (it was due ' + p.due_label + '). This week they need ' + p.need + by;
    return 'This week they need ' + p.need + by;
  }
  function planStep(n, title, text, vids) {
    return h('div', { class: 'yap-step' },
      h('p', { class: 'yap-step-h' }, h('span', { class: 'yap-step-n', text: n }), h('b', { text: title })),
      Array.isArray(text) ? h('ul', { class: 'yap-step-list' }, ...text.map((t) => h('li', { text: t })))
        : text ? h('p', { class: 'yap-sub', text: text }) : null,
      vids ? (vids.length ? h('div', { class: 'yap-vids' }, ...vids.map(planVid)) : h('p', { class: 'yap-sub', text: 'No videos tracked yet.' })) : null);
  }
  function cardPlan(m) {
    const p = m.plan;
    if (!p) return null;
    const lead = leadFirst(m);
    return h('section', { class: 'yap-card yap-plan', id: 'plan' },
      h('div', { class: 'yap-card-h' }, h('h2', { text: 'Your plan for this week' }), h('span', { class: 'yap-sub', text: p.week })),
      h('p', { class: 'yap-plan-intro', text: planIntro(p, true) }),
      planStep('1', 'Remake your best formats', '', p.own),
      // Laia, 12 Nov 2026: other creators' videos are only a starting point; mainly they should talk to their lead
      planStep('2', 'Formats from other creators', (lead ? 'Ask ' + lead + ' which formats from other creators to try this week. ' : '') +
        'As a starting point, these went viral in the program in the last 3 weeks with the same audience as you' +
        (p.lang && p.lang !== 'English' ? ', in ' + p.lang + ' or English (make the English ones in ' + p.lang + ')' : '') + '.', p.picks),
      // Laia, 12 Nov 2026: "film every video believing it will get to 1M, be engaging, high energy". Her edits: no "hi guys"
      // line, no likes-rule line, add the "comment 'literature review'" example. Plan card only (her pick).
      planStep('3', 'The essentials', [
        "Film every video like it's going to hit 1M. Before you post, ask yourself: would I stop scrolling for this?",
        'Hook people in the first 2 seconds with one bold, confident line.',
        "Keep it high energy: talk like you're telling a friend something exciting, and cut every pause.",
        "Give people a reason to like and comment, for example by ending on a question or with \"comment 'literature review' and I'll share more details\".",
        'Subtitles on every video, and a one-line caption with 4 or 5 hashtags for your audience (no AI hashtags).',
        'Post ' + (m.cur.allowance || 15) + ' videos on at least 6 of the 7 days, on TikTok, Instagram, YouTube, Facebook and Snapchat.',
      ], null));
  }
  // what a lead (or @anara.com) sees when they open that creator's row: the same plan plus more options
  function planDetail(r) {
    const p = r.plan;
    return h('div', { class: 'yt-plan' },
      h('p', { class: 'yap-dh', text: '50K plan this week' }),
      h('p', { class: 'yap-sub', text: planIntro(p, false) + ' Their page shows their best formats and these 4 videos as a starting point, and asks them to check with you which other creators\u2019 formats to make.' }),
      h('p', { class: 'yap-dh', text: 'Their best videos' }),
      p.own && p.own.length ? h('div', { class: 'yap-vids' }, ...p.own.map(planVid)) : h('p', { class: 'yap-sub', text: 'No videos tracked yet.' }),
      h('p', { class: 'yap-dh', text: 'Picked for them (same audience, last 3 weeks)' }),
      h('div', { class: 'yap-vids' }, ...(p.picks || []).map(planVid)),
      p.more && p.more.length ? h('p', { class: 'yap-dh', text: 'More options to suggest' }) : null,
      p.more && p.more.length ? h('div', { class: 'yap-vids' }, ...p.more.map(planVid)) : null);
  }

  // Leads (Laia, 11 Nov 2026): the team's 5 best videos last week, below the team table. Built from each row's top 3.
  function cardTeamTop(t) {
    const all = [];
    t.rows.forEach((r) => (r.top || []).forEach((x) => all.push(Object.assign({ who: r.name }, x))));
    const best = all.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
    if (!best.length) return null;
    return h('section', { class: 'yap-card', id: 'team-best-videos' },
      h('div', { class: 'yap-card-h' }, h('h2', { text: "Your team's best videos last week" }), h('span', { class: 'yap-sub', text: t.week_labels[3] })),
      h('div', { class: 'yap-vids' }, ...best.map(vid)));
  }

  function cardTop(m) {
    if (!m.top || !m.top.length) return null;
    return h('section', { class: 'yap-card', id: 'best-videos' },
      h('div', { class: 'yap-card-h' }, h('h2', { text: 'Your best videos last week' }), h('span', { class: 'yap-sub', text: m.weeks[3].label })),
      h('div', { class: 'yap-vids' }, ...m.top.map(vid)));
  }

  function howItWorks(lead) {
    return h('details', { class: 'yap-how', id: 'how' }, h('summary', { text: 'How we count' }), h('ul', null,
      h('li', { text: 'Weekly views are all the views on the videos posted that week, on TikTok, Instagram, YouTube, Facebook and Snapchat. It is the same number as the ranking on the Tuesday sync page.' }),
      h('li', { text: 'Weeks run Tuesday to Monday and close at Monday midnight Los Angeles time, the same as payments.' }),
      h('li', { text: 'Weekly targets: Experienced creators (1 to 3 months with us) 50K views, Champions (3+ months) 100K views. New creators have no weekly target in their first 4 weeks. Time with us counts from your first video.' }),
      h('li', { text: '50K videos: new creators need their first video over 50K within 2 weeks of starting, after their trial week. Experienced creators need one every 3 weeks. Champions need one video over 100K, or two over 50K, every 4 weeks.' }),
      h('li', { text: "From 10 Nov, a video needs likes equal to at least 0.3% of its views to count as a 50K video (150 likes at 50K). Facebook isn't checked for now." }),
      h('li', { text: 'Each week counts at the level for that week. After moving up, the new target starts that week.' }),
      h('li', { text: 'Aim for 15 videos a week, and never fewer than 10. Champions who got over 100K views the week before can post up to 20 that week, and all 20 are paid. We count videos like payments: the higher of your TikTok and Instagram videos that week. Weeks with fewer than 10 are marked.' }),
      h('li', { text: 'Post on at least 6 of the 7 days of the week. Each week shows how many days you posted, in Los Angeles time like the pay weeks.' }),
      h('li', { text: "A week with no videos at all shows as Paused. It doesn't count toward your weekly target, and it moves your next 50K due date back a week." }),
      h('li', { text: 'The numbers update every morning. Views keep growing after a week ends, so older weeks can be a bit higher here than on the sync page.' }),
      lead ? h('li', { text: 'Tap a creator to see their 50K videos, best videos and how many videos they posted. Trials and the green screen, reposting and industry teams are not on this page.' }) : null));
  }

  /* ---------- compact team table: one line per creator, tap for details */
  function legend() {
    return h('p', { class: 'yt-legend' },
      ...[['ok', 'On track'], ['warn', 'Missed last week'], ['bad', 'Under 2 weeks in a row'], ['accent', 'Target starts this week'], ['muted', 'New']]
        .map(([k, l]) => h('span', null, h('span', { class: 'yt-dot yt-dot--' + k }), l)),
      h('span', { text: 'Green number = hit the target that week, red = under it. Small line = videos and days posted (12v \u00b7 6/7d), amber when under 10 videos or 6 days. Paused = no videos, not counted.' }));
  }

  function teamStats(rows) {
    const counted = rows.filter((r) => r.weeks[3].target != null);
    return {
      counted: counted.length,
      hit: counted.filter((r) => r.weeks[3].hit).length,
      under2: rows.filter((r) => r.status === 'Under 2 weeks in a row').length,
      over: rows.filter((r) => isOverdue(r.v50)).length,
    };
  }

  function teamCard(t, title, rows) {
    rows = rows || t.rows;
    const s = teamStats(t.rows);
    return h('section', { class: 'yap-card', id: 'team-' + norm(t.team).replace(/[^a-z0-9]+/g, '-') },
      h('div', { class: 'yt-teamh' }, h('h2', { text: title || t.label }),
        h('span', { class: 'yap-sub', text: (t.lead ? 'Lead: ' + t.lead + DOT : '') + t.rows.length + ' creators' })),
      h('p', { class: 'yap-sub', text: s.hit + ' of ' + s.counted + ' hit their target last week' + DOT + s.under2 + ' under it 2 weeks in a row' + DOT + s.over + ' overdue on 50K' }),
      title ? legend() : null,
      teamTable(t, rows));
  }

  function teamTable(t, rows) {
    const head = h('div', { class: 'yt-row yt-head', 'aria-hidden': 'true' },
      h('span', { class: 'yt-who', text: 'Creator' }),
      ...t.week_labels.map((l, i) => h('span', { class: 'yt-c yt-c' + (i + 1) }, h('span', { class: 'yt-full', text: l }), h('span', { class: 'yt-short', text: shortWeek(l) }))),
      h('span', { class: 'yt-c yt-c5', text: 'This week' }),
      h('span', { class: 'yt-due', text: 'Next 50K' }));
    return h('div', { class: 'yt' }, head, ...rows.map((r) => teamRow(r, t)));
  }

  function due50(v) {
    const st = v50State(v);
    if (st === 'done') return pill('ok', 'Done');
    if (st === 'none') return pill('bad', 'None yet');
    if (st === 'overdue') return pill('bad', 'Overdue');
    const d = daysUntil(v.due);
    if (st === 'soon') return pill('warn', d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days');
    return pill('ok', String(v.due_label).replace(/^[A-Za-z]+\s/, ''));
  }

  function teamRow(r, t) {
    const det = h('details', { class: 'yt-item' });
    const key = t.team + '|' + r.name;
    if (S.open.has(key)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) S.open.add(key); else S.open.delete(key); });
    const st = STATUS[r.status] || ['muted', r.status];
    let sub = r.counted ? r.level + DOT + r.hit + ' of ' + r.counted + ' weeks hit'
      : r.status === 'Starts this week' ? r.level + DOT + 'target starts this week' : 'New' + DOT + 'no target yet';
    if (r.paused_weeks) sub += DOT + r.paused_weeks + ' wk paused';
    const who = h('span', { class: 'yt-who' },
      h('span', { class: 'yt-name' }, h('span', { class: 'yt-dot yt-dot--' + st[0], title: st[1] }), h('span', { class: 'yt-n', text: r.name }),
        r.lead ? h('span', { class: 'yap-tag', text: 'Lead' }) : null,
        r.plan ? h('span', { class: 'yap-tag yap-tag--plan', title: 'Has a 50K plan this week', text: '50K plan' }) : null),
      h('span', { class: 'yt-sub', text: sub }));
    const cells = r.weeks.map((w, i) => {
      const cls = 'yt-c yt-c' + (i + 1);
      if (w.started === 'before') return h('span', { class: cls + ' is-none', title: 'Before they started' }, '\u2013');
      if (w.paused) return h('span', { class: cls + ' is-paused', title: "No videos posted, so this week doesn't count" }, 'Paused');
      return h('span', { class: cls + ' is-' + (w.target == null ? 'none' : w.hit ? 'ok' : 'bad'),
        title: (w.target == null ? 'No target' : 'Target ' + fmt(w.target)) + DOT + w.videos + ' videos on ' + w.days + ' of 7 days' }, fmt(w.views),
        h('small', { class: w.low || w.days_low ? 'is-low' : null, text: w.videos + 'v' + DOT + w.days + '/7d' }));
    });
    const c = r.cur;
    const cur = h('span', { class: 'yt-c yt-c5 is-' + (c.target == null ? 'none' : c.views >= c.target ? 'ok' : 'cur'),
      title: (c.target == null ? 'No target this week' : 'Target ' + fmt(c.target)) + DOT + c.videos + ' of ' + (c.allowance || 15) + ' videos so far, on ' + c.days + ' of ' + c.days_of + ' days' }, fmt(c.views),
      c.started !== 'before' ? h('small', { text: c.videos + '/' + (c.allowance || 15) + 'v' + DOT + c.days + 'd' }) : null);
    const label = r.name + ', ' + st[1] + ', ' + sub + '. This week ' + Math.round(c.views).toLocaleString('en-US') + ' views.';
    det.append(h('summary', { class: 'yt-row', 'aria-label': label }, who, ...cells, cur, h('span', { class: 'yt-due' }, due50(r.v50))), rowDetail(r, t));
    return det;
  }

  function rowDetail(r, t) {
    const st = STATUS[r.status] || ['muted', r.status];
    const target = r.cur.target ? 'Target this week: ' + fmt(r.cur.target) + ' views.'
      : r.next_target ? 'Weekly target starts ' + r.next_target.date_label + '.' : 'No weekly target yet.';
    const posted = r.weeks.map((w, i) => t.week_labels[i] + ': ' + (w.started === 'before' ? 'not started' : w.paused ? 'paused'
      : w.videos + ' videos on ' + w.days + '/7 days')).concat(['this week so far: ' + r.cur.videos + ' of ' + (r.cur.allowance || 15) + ' on ' + r.cur.days + '/' + r.cur.days_of + ' days']);
    return h('div', { class: 'yt-detail' },
      h('div', { class: 'yt-dcol' }, h('p', { class: 'yap-dh', text: '50K videos' }), ...v50Block(r, false)),
      h('div', { class: 'yt-dcol' },
        h('p', { class: 'yap-dh', text: 'Weekly views' }),
        h('p', { class: 'yap-statusline' }, pill(st[0], st[1]), h('span', { class: 'yap-sub', text: target })),
        h('p', { class: 'yap-dh', text: 'Best videos last week' }),
        r.top && r.top.length ? h('div', { class: 'yap-vids' }, ...r.top.map(vid)) : h('span', { class: 'yap-sub', text: 'No videos tracked last week' }),
        h('p', { class: 'yap-dh', text: 'Videos posted' }),
        h('p', { class: 'yap-sub', text: posted.join(DOT) })),
      r.plan ? planDetail(r) : null);
  }

  /* ---------- every team (Laia, Alba) */
  function viewAll() {
    const F = S.full;
    const all = F.teams.flatMap((t) => t.rows);
    const s = teamStats(all);
    const summary = h('p', { class: 'yap-summary' }, 'Last week (' + F.week_labels[3] + '), ', h('b', { text: String(s.hit) }), ' of ',
      h('b', { text: String(s.counted) }), ' creators with a target hit it. ', h('b', { text: String(s.under2) }),
      ' have been under it 2 weeks in a row, and ', h('b', { text: String(s.over) }), ' are overdue for a 50K video.');
    const search = h('input', { id: 'yap-q', class: 'yap-input yap-search', type: 'search', placeholder: 'Find a creator', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find a creator' });
    search.value = S.f.q;
    const team = h('select', { id: 'yap-team', class: 'yap-select', 'aria-label': 'Team' }, h('option', { value: '', text: 'All teams' }),
      ...F.teams.map((t) => h('option', { value: t.team, text: t.label })));
    const CHIPS = [['', 'Everyone'], ['Under 2 weeks in a row', 'Under 2 weeks in a row'], ['Missed last week', 'Missed last week'], ['50k', '50K overdue'],
      ['low', 'Under 10 videos last week'], ['Paused last week', 'Paused last week']];
    const chips = h('div', { class: 'yap-chips', role: 'group', 'aria-label': 'Filter creators' },
      ...CHIPS.map(([v, l]) => h('button', { type: 'button', class: 'yap-chip', 'data-v': v, onclick: () => { S.f.status = v; update(); } }, l)));
    const box = h('div', { class: 'yap-groups' });
    const empty = h('p', { class: 'yap-empty', hidden: true, text: 'No creators match. Clear the search, or pick "All teams" and "Everyone".' });
    const asSel = h('select', { id: 'yap-as', class: 'yap-select', 'aria-label': 'View the page as a creator or lead', disabled: true },
      h('option', { value: '', text: 'View as\u2026' }));
    asSel.addEventListener('change', () => { if (asSel.value) viewAs(asSel.value, asSel.options[asSel.selectedIndex].text.replace(/ \(lead\)$/, '')); });
    fillPeople(asSel);
    search.addEventListener('input', () => { S.f.q = search.value; update(); });
    team.addEventListener('change', () => { S.f.team = team.value; update(); });
    function update() {
      chips.querySelectorAll('.yap-chip').forEach((b) => b.setAttribute('aria-pressed', String(S.f.status === b.getAttribute('data-v'))));
      team.value = S.f.team;
      const q = norm(S.f.q).trim();
      const keep = (r) => (!S.f.status || (S.f.status === '50k' ? isOverdue(r.v50) : S.f.status === 'low' ? r.weeks[3].low : r.status === S.f.status))
        && (!q || norm(r.name).includes(q));
      const cards = F.teams.filter((t) => !S.f.team || t.team === S.f.team).map((t) => {
        const rows = t.rows.filter(keep);
        return rows.length ? teamCard(Object.assign({}, F, t), null, rows) : null;
      }).filter(Boolean);
      box.replaceChildren(...cards);
      empty.hidden = cards.length > 0;
    }
    mount('is-mid', topbar('Every team', all.length + ' creators' + DOT + 'updated ' + F.asof_label),
      summary, h('div', { class: 'yap-controls' }, search, team, asSel), chips, legend(), empty, box, howItWorks(true));
    update();
  }

  boot();
})();
