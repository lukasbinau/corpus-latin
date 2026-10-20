'use strict';

/* Corpus – practise Latin anatomical terms.
 *
 * Progress lives in localStorage on each device. Two ways to practise:
 * - Smart repetition: a small Leitner system. A correct answer moves a word up
 *   one box (longer interval), a wrong answer sends it back to box 1 and repeats
 *   it a few cards later.
 * - Chapters: go through a fixed, mixed group of ~25 words or one topic, every
 *   word exactly once per pass, no repeats; the position is remembered per chapter.
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
let CHAPTERS = [];
const CH_BY_KEY = new Map();
let store = loadStore();
let session = null;
const app = document.getElementById('app');

/* ---------- storage ---------- */

function defaultStore() {
  return {
    v: 1,
    words: {},
    days: {},
    chapters: {}, // key -> { order: [ids], pos, ok, wrong: [ids], last: { ok, total } }
    lastChapter: null,
    settings: { direction: 'la-en', pace: 'normal', mode: 'smart' },
    tipDismissed: false,
  };
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
  if (s.mode === 'chapter') return s.pos < s.ids.length ? s.ids[s.pos] : null;
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
  // Chapters never repeat a word; the answer still counts towards the progress overview.
  const repeat = session.mode !== 'chapter';
  x.n++;
  x.last = now;
  if (correct) {
    x.ok++;
    x.b = Math.min(x.b + 1, INTERVALS.length - 1);
    x.due = now + INTERVALS[x.b];
    if (repeat && x.b === 1) enqueue(id, 7 + randInt(5)); // first time right: check again later today
  } else {
    x.bad++;
    x.b = 1;
    x.due = now + MIN;
    if (repeat) enqueue(id, 3 + randInt(3));
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

/* ---------- chapters ---------- */

const CHAPTER_SIZE = 25;
const CHAPTER_SEED = 20261020;

// Deterministic shuffle (mulberry32), so a chapter holds the same words on every device and visit.
function seededShuffle(arr, seed) {
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Numbered chapters mix the whole alphabet: chapters by first letter would give away the
// answer when choosing between Latin words. Topic chapters use the generated category.
function buildChapters() {
  const list = [];
  const ids = seededShuffle(WORDS.map((w) => w.id).sort(), CHAPTER_SEED);
  const count = Math.ceil(ids.length / CHAPTER_SIZE);
  for (let i = 0; i < count; i++) {
    const part = ids.slice(Math.round((i * ids.length) / count), Math.round(((i + 1) * ids.length) / count));
    list.push({ key: `k${i + 1}`, title: String(i + 1), label: `Kapitel ${i + 1}`, group: 'mixed', ids: part });
  }
  for (const [cat, title] of Object.entries(CATEGORY_DA)) {
    const catIds = WORDS.filter((w) => w.category === cat).map((w) => w.id);
    if (catIds.length) list.push({ key: `emne-${cat}`, title, label: title, group: 'topic', ids: catIds });
  }
  return list;
}

function chapterState(key) {
  const st = store.chapters[key];
  if (st) st.order = st.order.filter((id) => BY_ID.has(id)); // in case the word list changes
  return st;
}

function chapterProgress(ch) {
  const st = chapterState(ch.key);
  if (st && st.pos > 0 && st.pos < st.order.length) {
    return { text: `${st.pos} af ${st.order.length}`, frac: st.pos / st.order.length, state: 'active' };
  }
  if (st && st.last) return { text: `✓ ${st.last.ok} af ${st.last.total}`, frac: 1, state: 'done' };
  return { text: `${ch.ids.length} ord`, frac: 0, state: '' };
}

function startChapter(key, { restart = false } = {}) {
  const ch = CH_BY_KEY.get(key);
  if (!ch) return renderChapters();
  let st = chapterState(key);
  if (!st || restart || st.pos >= st.order.length) {
    st = store.chapters[key] = { order: shuffle(ch.ids.slice()), pos: 0, ok: 0, wrong: [], last: st ? st.last : null };
  }
  store.lastChapter = key;
  saveStore();
  session = newSession('chapter');
  Object.assign(session, { chapter: key, title: ch.label, ids: st.order, pos: st.pos });
  nextQuestion();
}

// Go once through the words answered wrong in a chapter pass (not saved as a chapter).
function startWrongOnes(ids, title) {
  session = newSession('chapter');
  Object.assign(session, { chapter: null, title, ids: shuffle(ids.slice()), pos: 0 });
  nextQuestion();
}

function chapterAnswered(id, correct) {
  session.pos++;
  const st = session.chapter && store.chapters[session.chapter];
  if (!st) return;
  st.pos = session.pos;
  if (correct) st.ok++; else st.wrong.push(id);
  if (st.pos >= st.order.length) st.last = { ok: st.ok, total: st.order.length };
  saveStore();
}

function chapterGuessed(id) {
  const st = session.chapter && store.chapters[session.chapter];
  if (!st) return;
  st.ok--;
  st.wrong.push(id);
  if (st.last && st.pos >= st.order.length) st.last.ok = st.ok;
  saveStore();
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
      ${homeButtons()}
      <a class="btn" href="#/svaere" ${c.hard ? '' : 'aria-disabled="true" onclick="return false" style="opacity:.5;cursor:default"'}>Øv svære ord <span class="count">${c.hard}</span></a>
      <a class="btn" href="#/ordliste">Ordliste</a>
    </div>
    <p class="hint">${store.settings.mode === 'chapters' ? 'Kapitler: hvert ord kommer én gang – ingen gentagelser.' : c.due ? `${c.due} ord er klar til repetition` : c.new === total ? 'Øv så længe du har lyst – appen husker, hvor du er nået til.' : 'Ingen ord venter på repetition lige nu – du kan altid øve videre.'}</p>
    ${showTip ? `<div class="install-tip"><p>${ios ? 'Tip: Tryk på <b>Del</b> og vælg <b>Føj til hjemmeskærm</b>' : 'Tip: Åbn browserens menu og vælg <b>Installer app</b> eller <b>Føj til startskærm</b>'}, så Corpus åbner som en app og dit fremskridt bliver gemt sikkert.</p><button aria-label="Luk tip" data-act="dismiss-tip">×</button></div>` : ''}
  `;
  const tipBtn = app.querySelector('[data-act="dismiss-tip"]');
  if (tipBtn) tipBtn.onclick = () => { store.tipDismissed = true; saveStore(); renderHome(); };
}

// The big button follows the practice mode chosen in settings; the other mode stays one tap away.
function homeButtons() {
  if (store.settings.mode !== 'chapters') {
    return '<a class="btn primary" href="#/oev">Start øvelse</a><a class="btn" href="#/kapitler">Kapitler</a>';
  }
  const ch = store.lastChapter && CH_BY_KEY.get(store.lastChapter);
  const st = ch && chapterState(ch.key);
  if (st && st.pos < st.order.length) {
    return `<a class="btn primary" href="#/kapitel/${ch.key}">Fortsæt: ${esc(ch.label)} · ${st.pos} af ${st.order.length}</a>
      <a class="btn" href="#/kapitler">Vælg et andet kapitel</a>`;
  }
  return '<a class="btn primary" href="#/kapitler">Vælg kapitel</a>';
}

function newSession(mode) {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ }
  return { mode, answered: 0, correct: 0, queue: [], recent: [], doneHard: new Set(), current: null };
}

function startSession(mode) {
  session = newSession(mode);
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
  let title = `<span class="score"><b>${s.correct}</b> af <b>${s.answered}</b> rigtige</span>`;
  let bar = '';
  if (s.mode === 'chapter') {
    const total = s.ids.length;
    const at = Math.min(total, s.current && !s.current.answered ? s.pos + 1 : s.pos);
    title = `<span class="score"><b>${esc(s.title)}</b> · ${at} af ${total}</span>`;
    bar = `<div class="bar thin" aria-hidden="true"><span class="learned" style="width:${(100 * s.pos / total).toFixed(2)}%"></span></div>`;
  }
  return `<div class="quiz-head">${topBar({
    cls: 'quiz-top',
    left: `<a class="icon-btn" href="${s.mode === 'chapter' ? '#/kapitler' : '#/'}" aria-label="Afslut øvelse">${ICONS.close}</a>`,
    title,
  })}${bar}</div>`;
}

function refreshQuizTop() {
  const head = app.querySelector('.quiz-head');
  if (head) head.outerHTML = quizTop();
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
  if (session.mode === 'chapter') chapterAnswered(cur.id, correct);

  app.querySelectorAll('.option').forEach((b) => {
    b.disabled = true;
    if (b.dataset.id === cur.id) b.classList.add('correct');
    else if (b.dataset.id === chosenId) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  refreshQuizTop();
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
  const chapter = session.mode === 'chapter';
  const fb = document.getElementById('feedback');
  fb.innerHTML = `
    <section class="card feedback">
      <p class="verdict ${cur.correct ? 'ok' : 'bad'}">${cur.correct ? ICONS.check + 'Rigtigt!' : ICONS.cross + 'Ikke helt'}</p>
      ${chosen}
      ${cur.correct && !cur.converted ? `<button class="guess-link" data-act="guessed">${chapter ? 'Jeg gættede – tæl det som forkert' : 'Jeg gættede – vis ordet igen snart'}</button>` : ''}
      ${detailsHTML(w)}
    </section>
    <div class="next-bar"><button class="btn primary" data-act="next">${chapter && session.pos >= session.ids.length ? 'Afslut kapitel' : 'Næste'}</button></div>
  `;
  fb.querySelector('[data-act="next"]').onclick = nextQuestion;
  const g = fb.querySelector('[data-act="guessed"]');
  if (g) g.onclick = () => {
    convertToWrong(cur.id, cur.undo);
    if (chapter) chapterGuessed(cur.id);
    cur.converted = true;
    refreshQuizTop();
    g.replaceWith(Object.assign(document.createElement('p'), {
      className: 'chosen',
      textContent: chapter ? 'Okay – det tæller som forkert.' : 'Okay – ordet kommer igen om lidt.',
    }));
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
  if (s.mode === 'chapter') return renderChapterDone();
  app.innerHTML = `
    ${quizTop()}
    <section class="card done-card">
      <h2>${s.mode === 'hard' ? 'Ingen svære ord tilbage' : 'Godt arbejde'}</h2>
      <p>${s.mode === 'hard' ? 'Du har svaret rigtigt på alle dine svære ord. De kommer igen til repetition senere.' : 'Der er ikke flere ord at øve lige nu.'}</p>
      <a class="btn primary" href="#/">Til forsiden</a>
    </section>`;
}

function renderChapterDone() {
  const s = session;
  const ch = s.chapter && CH_BY_KEY.get(s.chapter);
  if (!ch) { // the "wrong ones" round
    app.innerHTML = `
      ${quizTop()}
      <section class="card done-card">
        <h2>Færdig</h2>
        <p>${s.correct} af ${s.ids.length} rigtige denne gang.</p>
        <div class="stack"><a class="btn primary" href="#/kapitler">Til kapitlerne</a></div>
      </section>`;
    return;
  }
  const st = chapterState(ch.key);
  const wrong = [...new Set(st.wrong)];
  const siblings = CHAPTERS.filter((c) => c.group === ch.group);
  const next = siblings[siblings.indexOf(ch) + 1];
  app.innerHTML = `
    ${quizTop()}
    <section class="card done-card">
      <h2>${esc(ch.label)} er gennemgået</h2>
      <p>${st.ok} af ${st.order.length} rigtige.</p>
      <div class="stack">
        ${wrong.length ? `<button class="btn primary" data-act="wrong">Øv de ${wrong.length} forkerte én gang til</button>` : ''}
        ${next ? `<a class="btn ${wrong.length ? '' : 'primary'}" href="#/kapitel/${next.key}">Næste: ${esc(next.label)}</a>` : ''}
        <button class="btn" data-act="again">Tag kapitlet forfra</button>
        <a class="btn" href="#/kapitler">Alle kapitler</a>
      </div>
    </section>`;
  const w = app.querySelector('[data-act="wrong"]');
  if (w) w.onclick = () => startWrongOnes(wrong, `${ch.label}: forkerte`);
  app.querySelector('[data-act="again"]').onclick = () => startChapter(ch.key, { restart: true });
}

function renderChapters() {
  session = null;
  const tile = (ch) => {
    const p = chapterProgress(ch);
    return `<a class="ch-tile ${p.state}" href="#/kapitel/${ch.key}">
      <b>${esc(ch.title)}</b><span>${p.text}</span>
      <span class="mini"><i style="width:${(100 * p.frac).toFixed(1)}%"></i></span></a>`;
  };
  const mixed = CHAPTERS.filter((c) => c.group === 'mixed');
  const topics = CHAPTERS.filter((c) => c.group === 'topic');
  app.innerHTML = `
    ${topBar({ left: backBtn(), title: 'Kapitler' })}
    <p class="lead">Hvert ord kommer én gang pr. gennemgang i tilfældig rækkefølge – ingen gentagelser. Du fortsætter, hvor du slap.</p>
    <h2 class="section-title">Blandede kapitler · ca. ${CHAPTER_SIZE} ord hver</h2>
    <div class="ch-grid numbers">${mixed.map(tile).join('')}</div>
    <h2 class="section-title">Efter emne</h2>
    <div class="ch-grid topics">${topics.map(tile).join('')}</div>`;
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
      <h2>Måde at øve på</h2>
      <div class="seg">
        ${radio('mode', 'smart', 'Smart gentagelse', 'Ord du svarer forkert på, kommer igen. Nye ord blandes løbende ind.')}
        ${radio('mode', 'chapters', 'Kapitler uden gentagelser', 'Vælg et kapitel eller emne. Hvert ord kommer én gang, og du fortsætter, hvor du slap.')}
      </div>
    </section>
    <section class="group">
      <h2>Retning</h2>
      <div class="seg">
        ${radio('direction', 'la-en', 'Latin → engelsk', 'Se det latinske ord, vælg betydningen')}
        ${radio('direction', 'en-la', 'Engelsk → latin', 'Se betydningen, vælg det latinske ord')}
        ${radio('direction', 'mix', 'Blandet', 'Skifter tilfældigt mellem de to')}
      </div>
    </section>
    <section class="group">
      <h2>Tempo for nye ord (smart gentagelse)</h2>
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
      store = { ...defaultStore(), settings: store.settings, tipDismissed: store.tipDismissed }; // also clears chapter positions
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
  else if (h === 'kapitler') renderChapters();
  else if (h.startsWith('kapitel/')) startChapter(decodeURIComponent(h.slice('kapitel/'.length)));
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
    // Only while the "Næste" button is showing, and never instead of another focused button.
    const next = app.querySelector('[data-act="next"]');
    if (!next || (e.target.closest && e.target.closest('a, button') && e.target !== next)) return;
    e.preventDefault();
    nextQuestion();
  } else if (e.key === 'Escape') {
    location.hash = session.mode === 'chapter' ? '#/kapitler' : '#/';
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
  CHAPTERS = buildChapters();
  CHAPTERS.forEach((c) => CH_BY_KEY.set(c.key, c));
  // Drop saved positions of chapters that no longer exist (the old letter chapters).
  for (const key of Object.keys(store.chapters)) if (!CH_BY_KEY.has(key)) delete store.chapters[key];
  if (store.lastChapter && !CH_BY_KEY.has(store.lastChapter)) store.lastChapter = null;
  delete store.settings.order;
  saveStore();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // When a new version is deployed, the new service worker takes over right after
    // the app opens; reload once so she gets the new version straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
