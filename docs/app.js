'use strict';

/* Corpus – practise Latin anatomical terms.
 *
 * Progress lives in localStorage on each device. Scheduling is a small
 * Leitner system: a correct answer moves a word up one box (longer interval),
 * a wrong answer sends it back to box 1 and repeats it a few cards later.
 */

const STORAGE_KEY = 'corpus.v1';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Box 0 = never seen. Box n waits INTERVALS[n] before it is due again.
const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
const LEARNED_BOX = 4;
// How many words may wait for a repeat in the session before new ones are added.
const PACE = { calm: 5, normal: 8, fast: 12 };

const CATEGORY_DA = {
  direction: 'Retning og plan', bone: 'Knogle', joint: 'Led og bånd', muscle: 'Muskel',
  nervous: 'Nervesystem', vessel: 'Hjerte og kar', digestive: 'Fordøjelse', respiratory: 'Luftveje',
  urogenital: 'Urin- og kønsorganer', senses: 'Sanser og hud', region: 'Kropsregion',
  structure: 'Struktur', shape: 'Form og egenskab', general: 'Generelt',
};

const ICONS = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};

let WORDS = [];
const BY_ID = new Map();
let store = loadStore();
let session = null;
const app = document.getElementById('app');

/* ---------- storage ---------- */

function defaultStore() {
  return { v: 1, words: {}, days: {}, settings: { direction: 'la-en', pace: 'normal' }, tipDismissed: false };
}

function loadStore() {
  const base = defaultStore();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return base;
    return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
  } catch {
    return base;
  }
}

function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode or full */ }
}

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9æøå]+/g, ' ').trim();
const randInt = (n) => Math.floor(Math.random() * n);
const randomOf = (arr) => arr[randInt(arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const stateOf = (id) => store.words[id];
const seen = (id) => !!(store.words[id] && store.words[id].n);
function statusOf(id) {
  const s = stateOf(id);
  if (!s || !s.n) return 'new';
  return s.b >= LEARNED_BOX ? 'learned' : 'learning';
}
function isHard(id) {
  const s = stateOf(id);
  return !!s && s.n > 0 && s.bad > 0 && s.b <= 2;
}

function counts() {
  const c = { learned: 0, learning: 0, new: 0, hard: 0, due: 0 };
  const now = Date.now();
  for (const w of WORDS) {
    c[statusOf(w.id)]++;
    if (isHard(w.id)) c.hard++;
    const s = stateOf(w.id);
    if (s && s.n && s.due <= now) c.due++;
  }
  return c;
}

function streak() {
  let n = 0;
  const t = new Date();
  if (!store.days[dayKey(t)]) t.setDate(t.getDate() - 1); // today not practised yet: count up to yesterday
  while (store.days[dayKey(t)]) {
    n++;
    t.setDate(t.getDate() - 1);
  }
  return n;
}

/* ---------- scheduling ---------- */

function pickFromTop(list, n) {
  return list[randInt(Math.min(n, list.length))];
}

function nextWordId() {
  const s = session;
  const now = Date.now();
  const recent = new Set(s.recent.slice(-2));
  s.queue.sort((a, b) => a.at - b.at);

  // 1. Words that were missed (or just introduced) earlier in this session.
  const qi = s.queue.findIndex((q) => q.at <= s.answered && !recent.has(q.id));
  if (qi >= 0) return s.queue.splice(qi, 1)[0].id;

  const queued = new Set(s.queue.map((q) => q.id));
  const free = (id) => !recent.has(id) && !queued.has(id);

  if (s.mode === 'hard') {
    const pool = WORDS.filter((w) => isHard(w.id) && free(w.id) && !s.doneHard.has(w.id));
    if (pool.length) return randomOf(pool).id;
    const q = s.queue.find((x) => !recent.has(x.id));
    if (q) {
      s.queue.splice(s.queue.indexOf(q), 1);
      return q.id;
    }
    return null;
  }

  // Words "in the air" are the ones waiting to be asked again in this session.
  const unseen = WORDS.filter((w) => !seen(w.id) && free(w.id));
  const roomForNew = unseen.length && s.queue.length < (PACE[store.settings.pace] || PACE.normal);

  // 2. Reviews that are due, weakest first – but every 4th card may be a new word,
  //    so a review backlog never stops her from getting through the whole list.
  const due = WORDS.filter((w) => { const x = stateOf(w.id); return x && x.n && x.due <= now && free(w.id); });
  if (due.length && !(roomForNew && s.answered % 4 === 3)) {
    due.sort((a, b) => stateOf(a.id).b - stateOf(b.id).b || stateOf(a.id).due - stateOf(b.id).due);
    return pickFromTop(due, 4).id;
  }

  // 3. A new word, if not too many are being learned right now.
  if (roomForNew) return randomOf(unseen).id;

  // 4. Something queued, a little early.
  const early = s.queue.find((x) => !recent.has(x.id));
  if (early) {
    s.queue.splice(s.queue.indexOf(early), 1);
    return early.id;
  }

  // 5. Extra practice: the words that are due soonest, or a new word now and then.
  const practised = WORDS.filter((w) => seen(w.id) && free(w.id));
  if (unseen.length && (!practised.length || Math.random() < 0.4)) return randomOf(unseen).id;
  practised.sort((a, b) => stateOf(a.id).due - stateOf(b.id).due);
  return practised.length ? pickFromTop(practised, 8).id : null;
}

function enqueue(id, after) {
  session.queue = session.queue.filter((q) => q.id !== id);
  session.queue.push({ id, at: session.answered + after });
}

function recordAnswer(id, correct) {
  const now = Date.now();
  const prev = store.words[id] ? { ...store.words[id] } : null;
  const x = store.words[id] || (store.words[id] = { b: 0, due: 0, n: 0, ok: 0, bad: 0, last: 0 });
  const wasNew = !x.n;
  x.n++;
  x.last = now;
  if (correct) {
    x.ok++;
    x.b = Math.min(x.b + 1, INTERVALS.length - 1);
    x.due = now + INTERVALS[x.b];
    if (x.b === 1) enqueue(id, 7 + randInt(5)); // first time right: check again later today
  } else {
    x.bad++;
    x.b = 1;
    x.due = now + MIN;
    enqueue(id, 3 + randInt(3));
    if (session.mode === 'hard') session.doneHard.delete(id);
  }
  // In "hard words" mode one correct answer is enough for today; spacing does the rest.
  if (session.mode === 'hard' && correct) session.doneHard.add(id);

  const d = dayKey(now);
  const day = store.days[d] || (store.days[d] = { a: 0, c: 0, nw: 0 });
  day.a++;
  if (correct) day.c++;
  if (wasNew) day.nw++;

  session.answered++;
  if (correct) session.correct++;
  saveStore();
  return { prev, wasNew };
}

// "I guessed": undo a correct answer and record it as wrong instead.
function convertToWrong(id, undo) {
  if (undo.prev) store.words[id] = undo.prev; else delete store.words[id];
  session.queue = session.queue.filter((q) => q.id !== id);
  session.answered--;
  session.correct--;
  const day = store.days[dayKey()];
  if (day) {
    day.a--;
    day.c--;
    if (undo.wasNew) day.nw--;
  }
  recordAnswer(id, false);
}

/* ---------- answer options ---------- */

function buildOptions(w, dir) {
  const label = (o) => norm(dir === 'la-en' ? o.english : o.latin);
  const avoid = new Set([w.id, ...w.similar]);
  const used = new Set([label(w)]);
  const picks = [];
  const tryAdd = (o) => {
    if (!o || picks.length >= 3 || avoid.has(o.id) || o.similar.includes(w.id)) return;
    const k = label(o);
    if (used.has(k)) return;
    used.add(k);
    picks.push(o);
  };
  shuffle(w.distractors.map((id) => BY_ID.get(id))).forEach(tryAdd);
  if (picks.length < 3) shuffle(WORDS.filter((o) => o.category === w.category && o.wordType === w.wordType)).forEach(tryAdd);
  if (picks.length < 3) shuffle(WORDS.filter((o) => o.wordType === w.wordType)).forEach(tryAdd);
  if (picks.length < 3) shuffle(WORDS.slice()).forEach(tryAdd);
  return shuffle([w, ...picks]);
}

/* ---------- views ---------- */

function topBar({ left = '', title = '', right = '<span class="spacer"></span>', cls = '' } = {}) {
  return `<header class="top ${cls}">${left}${title ? `<h1>${title}</h1>` : ''}${right}</header>`;
}
const backBtn = (label = 'Tilbage') => `<a class="icon-btn" href="#/" aria-label="${label}">${ICONS.back}</a>`;

function detailsHTML(w, { showHead = true } = {}) {
  const img = w.image
    ? `<figure class="pic"><img src="${esc(w.image.src)}" alt="Illustration: ${esc(w.latin)}" loading="lazy">
         <figcaption>${esc(w.image.credit)}${w.image.license ? ` · ${esc(w.image.license)}` : ''} · <a href="${esc(w.image.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption></figure>`
    : '';
  return `<div class="details">
    ${showHead ? `<div class="head"><p class="latin">${esc(w.latin)}</p><p class="en">${esc(w.english)}</p></div>` : ''}
    ${w.englishTerm && norm(w.englishTerm) !== norm(w.english) ? `<p class="da"><span class="tag">Fagterm</span>${esc(w.englishTerm)}</p>` : ''}
    ${w.danish ? `<p class="da"><span class="tag">Dansk</span>${esc(w.danish)}</p>` : ''}
    ${w.explanation ? `<p class="explain">${esc(w.explanation)}</p>` : ''}
    ${w.mnemonic ? `<div class="tip-box"><span class="tip-title">Husk det</span><p>${esc(w.mnemonic)}</p></div>` : ''}
    ${img}
    ${w.englishOriginal ? `<p class="note">I jeres regneark står der „${esc(w.englishOriginal)}“. Betydningen er rettet her.</p>` : ''}
    <p class="meta">${esc(w.latinFull)}${w.wordTypeDa ? ` · ${esc(w.wordTypeDa)}` : ''} · ${esc(CATEGORY_DA[w.category] || '')}</p>
  </div>`;
}

function renderHome() {
  session = null;
  const c = counts();
  const total = WORDS.length;
  const pct = (n) => `${(100 * n / total).toFixed(2)}%`;
  const today = store.days[dayKey()];
  const st = streak();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const touch = matchMedia('(pointer: coarse)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const showTip = !standalone && touch && !store.tipDismissed;

  app.innerHTML = `
    ${topBar({
      left: '<div class="brand"><b>Corpus</b><span>medicinsk latin</span></div>',
      right: `<a class="icon-btn" href="#/indstillinger" aria-label="Indstillinger">${ICONS.gear}</a>`,
    })}
    <section class="card progress-card" aria-label="Fremskridt">
      <div class="headline"><span class="big">${c.learned}</span><span class="of">af ${total}</span></div>
      <p class="caption">ord lært</p>
      <div class="bar" role="img" aria-label="${c.learned} lært, ${c.learning} i gang, ${c.new} nye">
        <span class="learned" style="width:${pct(c.learned)}"></span><span class="learning" style="width:${pct(c.learning)}"></span>
      </div>
      <ul class="legend">
        <li><i style="background:var(--learned)"></i>Lært <b>${c.learned}</b></li>
        <li><i style="background:var(--learning)"></i>I gang <b>${c.learning}</b></li>
        <li><i style="background:var(--unseen)"></i>Ikke set endnu <b>${c.new}</b></li>
      </ul>
    </section>
    <div class="today">
      <span class="pill">I dag: <b>${today ? today.a : 0}</b> svar${today && today.a ? ` · <b>${Math.round(100 * today.c / today.a)} %</b> rigtige` : ''}</span>
      <span class="pill"><b>${st}</b> ${st === 1 ? 'dag' : 'dage'} i træk</span>
    </div>
    <div class="stack">
      <a class="btn primary" href="#/oev">Start øvelse</a>
      <a class="btn" href="#/svaere" ${c.hard ? '' : 'aria-disabled="true" onclick="return false" style="opacity:.5;cursor:default"'}>Øv svære ord <span class="count">${c.hard}</span></a>
      <a class="btn" href="#/ordliste">Ordliste</a>
    </div>
    <p class="hint">${c.due ? `${c.due} ord er klar til repetition` : c.new === total ? 'Øv så længe du har lyst – appen husker, hvor du er nået til.' : 'Ingen ord venter på repetition lige nu – du kan altid øve videre.'}</p>
    ${showTip ? `<div class="install-tip"><p>${ios ? 'Tip: Tryk på <b>Del</b> og vælg <b>Føj til hjemmeskærm</b>' : 'Tip: Åbn browserens menu og vælg <b>Installer app</b> eller <b>Føj til startskærm</b>'}, så Corpus åbner som en app og dit fremskridt bliver gemt sikkert.</p><button aria-label="Luk tip" data-act="dismiss-tip">×</button></div>` : ''}
  `;
  const tipBtn = app.querySelector('[data-act="dismiss-tip"]');
  if (tipBtn) tipBtn.onclick = () => { store.tipDismissed = true; saveStore(); renderHome(); };
}

function startSession(mode) {
  session = { mode, answered: 0, correct: 0, queue: [], recent: [], doneHard: new Set(), current: null };
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ }
  nextQuestion();
}

function nextQuestion() {
  const id = nextWordId();
  if (!id) return renderSessionDone();
  const w = BY_ID.get(id);
  const pref = store.settings.direction;
  const dir = pref === 'mix' ? (Math.random() < 0.5 ? 'la-en' : 'en-la') : pref;
  session.current = { id, dir, options: buildOptions(w, dir), answered: false, isNew: !seen(id) };
  session.recent.push(id);
  renderQuestion();
}

function quizTop() {
  const s = session;
  return topBar({
    cls: 'quiz-top',
    left: `<a class="icon-btn" href="#/" aria-label="Afslut øvelse">${ICONS.close}</a>`,
    title: `<span class="score"><b>${s.correct}</b> af <b>${s.answered}</b> rigtige</span>`,
  });
}

function renderQuestion() {
  const { id, dir, options, isNew } = session.current;
  const w = BY_ID.get(id);
  const la = dir === 'la-en';
  app.innerHTML = `
    ${quizTop()}
    <section class="card prompt">
      ${isNew ? '<span class="badge">Nyt ord</span>' : session.mode === 'hard' ? '<span class="badge">Svært ord</span>' : ''}
      <p class="ask">${la ? 'Hvad betyder' : 'Hvad hedder det på latin?'}</p>
      <h2 class="word ${la ? '' : 'english'}">${esc(la ? w.latin : w.english)}</h2>
      ${la && w.latinFull !== w.latin ? `<p class="sub">${esc(w.latinFull)}</p>` : ''}
    </section>
    <div class="options" role="group" aria-label="Svarmuligheder">
      ${options.map((o, i) => `
        <button class="option ${la ? '' : 'latin'}" data-id="${o.id}">
          <span class="key">${i + 1}</span><span class="txt">${esc(la ? o.english : o.latin)}</span>
        </button>`).join('')}
    </div>
    <div id="feedback"></div>
  `;
  app.querySelectorAll('.option').forEach((b) => { b.onclick = () => choose(b.dataset.id); });
  window.scrollTo(0, 0);
}

function choose(chosenId) {
  const cur = session.current;
  if (cur.answered) return;
  cur.answered = true;
  const w = BY_ID.get(cur.id);
  const correct = chosenId === cur.id;
  cur.undo = recordAnswer(cur.id, correct);
  cur.correct = correct;
  cur.chosenId = chosenId;

  app.querySelectorAll('.option').forEach((b) => {
    b.disabled = true;
    if (b.dataset.id === cur.id) b.classList.add('correct');
    else if (b.dataset.id === chosenId) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  app.querySelector('.score').innerHTML = `<b>${session.correct}</b> af <b>${session.answered}</b> rigtige`;
  renderFeedback(w);
}

function renderFeedback(w) {
  const cur = session.current;
  const la = cur.dir === 'la-en';
  let chosen = '';
  if (!cur.correct) {
    const o = BY_ID.get(cur.chosenId);
    chosen = la
      ? `<p class="chosen">Du valgte „${esc(o.english)}“ – det er <i>${esc(o.latin)}</i>.</p>`
      : `<p class="chosen">Du valgte <i>${esc(o.latin)}</i> – det betyder „${esc(o.english)}“.</p>`;
  }
  const fb = document.getElementById('feedback');
  fb.innerHTML = `
    <section class="card feedback">
      <p class="verdict ${cur.correct ? 'ok' : 'bad'}">${cur.correct ? ICONS.check + 'Rigtigt!' : ICONS.cross + 'Ikke helt'}</p>
      ${chosen}
      ${cur.correct && !cur.converted ? '<button class="guess-link" data-act="guessed">Jeg gættede – vis ordet igen snart</button>' : ''}
      ${detailsHTML(w)}
    </section>
    <div class="next-bar"><button class="btn primary" data-act="next">Næste</button></div>
  `;
  fb.querySelector('[data-act="next"]').onclick = nextQuestion;
  const g = fb.querySelector('[data-act="guessed"]');
  if (g) g.onclick = () => {
    convertToWrong(cur.id, cur.undo);
    cur.converted = true;
    app.querySelector('.score').innerHTML = `<b>${session.correct}</b> af <b>${session.answered}</b> rigtige`;
    g.replaceWith(Object.assign(document.createElement('p'), { className: 'chosen', textContent: 'Okay – ordet kommer igen om lidt.' }));
  };
  if (matchMedia('(pointer: fine)').matches) fb.querySelector('[data-act="next"]').focus({ preventScroll: true });
  // On small screens the explanation starts below the fold: bring it up.
  const top = fb.getBoundingClientRect().top;
  if (top > window.innerHeight * 0.55) {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: top - 16, behavior: smooth ? 'smooth' : 'auto' });
  }
}

function renderSessionDone() {
  const s = session;
  app.innerHTML = `
    ${quizTop()}
    <section class="card done-card">
      <h2>${s.mode === 'hard' ? 'Ingen svære ord tilbage' : 'Godt arbejde'}</h2>
      <p>${s.mode === 'hard' ? 'Du har svaret rigtigt på alle dine svære ord. De kommer igen til repetition senere.' : 'Der er ikke flere ord at øve lige nu.'}</p>
      <a class="btn primary" href="#/">Til forsiden</a>
    </section>`;
}

/* ---------- word list ---------- */

const FILTERS = [
  ['all', 'Alle'], ['hard', 'Svære'], ['learning', 'I gang'], ['learned', 'Lært'], ['new', 'Ikke set'],
];
let listState = { q: '', filter: 'all', open: null };

function renderList() {
  session = null;
  app.innerHTML = `
    ${topBar({ left: backBtn(), title: 'Ordliste' })}
    <input class="search" type="search" placeholder="Søg på latin, engelsk eller dansk" value="${esc(listState.q)}" aria-label="Søg">
    <div class="chips" role="group" aria-label="Filter">
      ${FILTERS.map(([k, label]) => `<button class="chip" data-f="${k}" aria-pressed="${listState.filter === k}">${label}</button>`).join('')}
    </div>
    <p class="list-count"></p>
    <ul class="word-list"></ul>`;
  const input = app.querySelector('.search');
  input.oninput = () => { listState.q = input.value; fillList(); };
  app.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => {
      listState.filter = b.dataset.f;
      app.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
      fillList();
    };
  });
  app.querySelector('.word-list').onclick = (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    listState.open = listState.open === row.dataset.id ? null : row.dataset.id;
    fillList();
  };
  fillList();
}

function fillList() {
  const q = norm(listState.q);
  const f = listState.filter;
  const items = WORDS.filter((w) => {
    if (f === 'hard' && !isHard(w.id)) return false;
    if (f !== 'all' && f !== 'hard' && statusOf(w.id) !== f) return false;
    if (!q) return true;
    return norm(`${w.latinFull} ${w.latin} ${w.english} ${w.englishTerm} ${w.danish}`).includes(q);
  }).sort((a, b) => a.latin.localeCompare(b.latin, 'la'));
  app.querySelector('.list-count').textContent = `${items.length} ord`;
  app.querySelector('.word-list').innerHTML = items.map((w) => {
    const status = isHard(w.id) ? 'hard' : statusOf(w.id);
    const open = listState.open === w.id;
    return `<li>
      <button class="row" data-id="${w.id}" aria-expanded="${open}">
        <span class="dot ${status}"></span><span class="l">${esc(w.latin)}</span><span class="e">${esc(w.english)}</span>
      </button>
      ${open ? detailsHTML(w, { showHead: false }) : ''}
    </li>`;
  }).join('') || '<li class="empty">Ingen ord matcher.</li>';
}

/* ---------- settings ---------- */

function renderSettings() {
  session = null;
  const s = store.settings;
  const radio = (name, value, title, sub) => `
    <label><input type="radio" name="${name}" value="${value}" ${s[name] === value ? 'checked' : ''}>
      <span>${title}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  app.innerHTML = `
    ${topBar({ left: backBtn(), title: 'Indstillinger' })}
    <section class="group">
      <h2>Retning</h2>
      <div class="seg">
        ${radio('direction', 'la-en', 'Latin → engelsk', 'Se det latinske ord, vælg betydningen')}
        ${radio('direction', 'en-la', 'Engelsk → latin', 'Se betydningen, vælg det latinske ord')}
        ${radio('direction', 'mix', 'Blandet', 'Skifter tilfældigt mellem de to')}
      </div>
    </section>
    <section class="group">
      <h2>Tempo for nye ord</h2>
      <div class="seg">
        ${radio('pace', 'calm', 'Roligt', 'Højst 5 nye ord i spil ad gangen')}
        ${radio('pace', 'normal', 'Normalt', 'Højst 8 nye ord i spil ad gangen')}
        ${radio('pace', 'fast', 'Hurtigt', 'Højst 12 nye ord i spil ad gangen')}
      </div>
    </section>
    <section class="group">
      <h2>Fremskridt</h2>
      <button class="btn danger" data-act="reset">Nulstil fremskridt</button>
    </section>
    <section class="group about">
      <h2>Om Corpus</h2>
      <p>Ordlisten kommer fra jeres regneark. Engelske betydninger, danske forklaringer og huskeråd er skrevet med hjælp fra Claude (AI) og kan indeholde fejl. Tjek med pensum, hvis noget virker forkert. Billeder er fra Wikimedia Commons; ophavsmand og licens står under hvert billede.</p>
      <p>Dit fremskridt gemmes kun på denne enhed.</p>
    </section>`;
  app.querySelectorAll('input[type=radio]').forEach((r) => {
    r.onchange = () => { store.settings[r.name] = r.value; saveStore(); };
  });
  app.querySelector('[data-act="reset"]').onclick = () => {
    if (confirm('Vil du slette alt dit fremskridt på denne enhed? Det kan ikke fortrydes.')) {
      store = { ...defaultStore(), settings: store.settings, tipDismissed: store.tipDismissed };
      saveStore();
      location.hash = '#/';
    }
  };
}

/* ---------- routing & keyboard ---------- */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'oev') startSession('smart');
  else if (h === 'svaere') startSession('hard');
  else if (h === 'ordliste') renderList();
  else if (h === 'indstillinger') renderSettings();
  else renderHome();
}

document.addEventListener('keydown', (e) => {
  if (!session || !session.current || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  const cur = session.current;
  if (!cur.answered && /^[1-4]$/.test(e.key)) {
    const o = cur.options[Number(e.key) - 1];
    if (o) choose(o.id);
  } else if (cur.answered && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    nextQuestion();
  } else if (e.key === 'Escape') {
    location.hash = '#/';
  }
});

async function init() {
  try {
    const res = await fetch('data/words.json');
    WORDS = await res.json();
  } catch {
    app.innerHTML = '<p class="empty">Kunne ikke hente ordlisten. Tjek din internetforbindelse og prøv igen.</p>';
    return;
  }
  WORDS.forEach((w) => BY_ID.set(w.id, w));
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
