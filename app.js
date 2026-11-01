'use strict';

const KEYS = {
  events: 'personal-calendar:events',
  habits: 'personal-calendar:habits',
  habitLog: 'personal-calendar:habit-log',
  todos: 'personal-calendar:todos',
  theme: 'personal-calendar:theme',
  view: 'personal-calendar:view',
};

// Storage keys and type ids used by earlier versions of the app.
const LEGACY_KEYS = {
  events: 'calendario-personal:eventos',
  habits: 'calendario-personal:rutinas',
  habitLog: 'calendario-personal:rutinas-hechas',
};
const LEGACY_TYPES = {
  cita: 'appointment',
  tarea: 'task',
  recordatorio: 'reminder',
  trabajo: 'work',
  deporte: 'sport',
  cumple: 'birthday',
  otro: 'other',
};

const TYPES = {
  appointment: 'Appointment',
  task: 'Task',
  reminder: 'Reminder',
  work: 'Work',
  personal: 'Personal',
  sport: 'Sport',
  birthday: 'Birthday',
  other: 'Other',
};

const REPEATS = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

const VIEWS = ['month', 'week', 'day'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MAX_CHIPS = 3;
const UPCOMING_DAYS = 30;
// Visible hours in week/day views; the grid stretches to fill the screen.
const DAY_START = 7 * 60;
const DAY_END = 23 * 60;
const DAY_SPAN = DAY_END - DAY_START;
const DEFAULT_DURATION = 60;
const MIN_VISUAL_DURATION = 30;

// ---------- Date helpers (always local time) ----------

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const todayKey = () => toKey(new Date());
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

function longDate(key) {
  const d = fromKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function relativeLabel(key) {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === toKey(addDays(fromKey(t), 1))) return 'Tomorrow';
  return longDate(key);
}

// ---------- Storage ----------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

function isValidEvent(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' &&
    typeof e.title === 'string' && isDateKey(e.date);
}

function isValidHabit(h) {
  return h && typeof h === 'object' && typeof h.id === 'string' && typeof h.title === 'string';
}

function isValidTodo(t) {
  return isValidHabit(t) && (!t.due || isDateKey(t.due));
}

function normalizeEvent(e) {
  if (LEGACY_TYPES[e.type]) e.type = LEGACY_TYPES[e.type];
  if (!TYPES[e.type]) e.type = 'other';
  return e;
}

function sanitizeLog(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (isDateKey(k) && Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
  }
  return out;
}

const asArray = (x) => (Array.isArray(x) ? x : []);
const isUuid = (s) => typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// In-memory copy of the signed-in user's data. Empty until someone signs in.
let events = [];
let habits = [];
let habitLog = {};
let todos = [];
let currentUser = null;

// ---------- Supabase ----------
// The URL and anon key come from config.js, generated from repository secrets at deploy
// time. The anon key is public by design: access control is enforced by Row Level
// Security, so each user can only read and write their own rows.

const CONFIG = window.APP_CONFIG || {};
// Read before the client consumes the URL hash of a password-reset link.
const AUTH_HASH = new URLSearchParams(window.location.hash.slice(1));
const sb = window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey
  ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

const T = { events: 'cal_events', habits: 'cal_habits', habitLog: 'cal_habit_log', todos: 'cal_todos' };
const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request.

const eventToRow = (e) => ({
  id: e.id,
  title: e.title,
  type: e.type,
  date: e.date,
  all_day: !!e.allDay,
  start_time: e.start || null,
  end_time: e.end || null,
  repeat: e.repeat || 'none',
  location: e.location || '',
  notes: e.notes || '',
  done: !!e.done,
  done_on: e.doneOn || [],
});
const rowToEvent = (r) => normalizeEvent({
  id: r.id,
  title: r.title,
  type: r.type,
  date: r.date,
  allDay: r.all_day,
  start: r.start_time ? r.start_time.slice(0, 5) : '',
  end: r.end_time ? r.end_time.slice(0, 5) : '',
  repeat: r.repeat || 'none',
  location: r.location || '',
  notes: r.notes || '',
  done: !!r.done,
  doneOn: r.done_on || [],
});
const habitToRow = (h) => ({ id: h.id, title: h.title, since: h.since || null });
const rowToHabit = (r) => ({ id: r.id, title: r.title, since: r.since || '' });
const todoToRow = (t) => ({
  id: t.id,
  title: t.title,
  due: t.due || null,
  done: !!t.done,
  done_at: t.doneAt ? new Date(t.doneAt).toISOString() : null,
  created_at: new Date(t.createdAt || Date.now()).toISOString(),
});
const rowToTodo = (r) => ({
  id: r.id,
  title: r.title,
  due: r.due || '',
  done: !!r.done,
  doneAt: r.done_at ? Date.parse(r.done_at) : null,
  createdAt: Date.parse(r.created_at),
});

async function fetchAll(table, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = sb.from(table).select('*');
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function loadAll() {
  const [ev, hb, lg, td] = await Promise.all([
    fetchAll(T.events, ['id']),
    fetchAll(T.habits, ['id']),
    fetchAll(T.habitLog, ['day', 'habit_id']),
    fetchAll(T.todos, ['id']),
  ]);
  events = ev.map(rowToEvent);
  habits = hb.map(rowToHabit);
  todos = td.map(rowToTodo);
  habitLog = {};
  for (const r of lg) (habitLog[r.day] ||= []).push(r.habit_id);
}

// Changes are applied locally right away; if the server rejects one, reload to stay in sync.
async function persist(request) {
  const { error } = await request;
  if (!error) return;
  console.error(error);
  alert(`Could not save your change: ${error.message}`);
  try {
    await loadAll();
    render();
  } catch (e) {
    console.error(e);
  }
}

// ---------- Events ----------

function occursOn(ev, key) {
  if (key === ev.date) return true;
  if (key < ev.date || !ev.repeat || ev.repeat === 'none') return false;
  const a = fromKey(ev.date);
  const b = fromKey(key);
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekly': return a.getDay() === b.getDay();
    case 'monthly': return a.getDate() === b.getDate();
    case 'yearly': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    default: return false;
  }
}

const isTimed = (ev) => !ev.allDay && !!ev.start;

function compareEvents(a, b) {
  if (isTimed(a) !== isTimed(b)) return isTimed(a) ? 1 : -1;
  return (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title);
}

function eventsOn(key) {
  return events.filter((ev) => occursOn(ev, key)).sort(compareEvents);
}

// Repeating tasks are marked done per day; one-off tasks just once.
function isDone(ev, key) {
  if (!ev.repeat || ev.repeat === 'none') return !!ev.done;
  return (ev.doneOn || []).includes(key);
}

function toggleDone(ev, key) {
  if (!ev.repeat || ev.repeat === 'none') {
    ev.done = !ev.done;
  } else {
    const set = new Set(ev.doneOn || []);
    set.has(key) ? set.delete(key) : set.add(key);
    ev.doneOn = [...set];
  }
  persist(sb.from(T.events).update({ done: !!ev.done, done_on: ev.doneOn || [] }).eq('id', ev.id));
  render();
}

function timeLabel(ev) {
  if (!isTimed(ev)) return 'All day';
  return ev.end ? `${ev.start} – ${ev.end}` : ev.start;
}

// ---------- Daily routine ----------

const habitsOn = (key) => habits.filter((h) => !h.since || key >= h.since);
const habitDone = (h, key) => (habitLog[key] || []).includes(h.id);

function toggleHabit(h, key) {
  const set = new Set(habitLog[key] || []);
  const adding = !set.has(h.id);
  adding ? set.add(h.id) : set.delete(h.id);
  if (set.size) habitLog[key] = [...set];
  else delete habitLog[key];
  persist(adding
    ? sb.from(T.habitLog).insert({ habit_id: h.id, day: key })
    : sb.from(T.habitLog).delete().eq('habit_id', h.id).eq('day', key));
  render();
}

function addHabit(title) {
  const today = todayKey();
  const h = { id: newId(), title, since: selected < today ? selected : today };
  habits.push(h);
  persist(sb.from(T.habits).insert(habitToRow(h)));
  render();
}

function removeHabit(h) {
  if (!confirm(`Remove “${h.title}” from your daily routine? Its history will be deleted too.`)) return;
  habits = habits.filter((x) => x !== h);
  for (const key of Object.keys(habitLog)) {
    habitLog[key] = habitLog[key].filter((id) => id !== h.id);
    if (!habitLog[key].length) delete habitLog[key];
  }
  // Its log rows are removed by the database (on delete cascade).
  persist(sb.from(T.habits).delete().eq('id', h.id));
  render();
}

// ---------- To do ----------
// One-off things to remember, optionally with a due date; separate from the daily routine.

let editingTodo = null;

function addTodo(title, due) {
  const t = { id: newId(), title, due: due || '', done: false, createdAt: Date.now() };
  todos.push(t);
  persist(sb.from(T.todos).insert(todoToRow(t)));
  renderTodos();
}

function toggleTodo(t) {
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  persist(sb.from(T.todos).update({ done: t.done, done_at: t.doneAt ? new Date(t.doneAt).toISOString() : null }).eq('id', t.id));
  renderTodos();
}

function removeTodo(t) {
  todos = todos.filter((x) => x !== t);
  persist(sb.from(T.todos).delete().eq('id', t.id));
  renderTodos();
}

function clearDoneTodos() {
  const ids = todos.filter((t) => t.done).map((t) => t.id);
  if (!ids.length) return;
  todos = todos.filter((t) => !t.done);
  persist(sb.from(T.todos).delete().in('id', ids));
  renderTodos();
}

// Dated items first (overdue at the top), then undated ones in the order they were added.
function compareTodos(a, b) {
  if (!!a.due !== !!b.due) return a.due ? -1 : 1;
  return (a.due || '').localeCompare(b.due || '') || (a.createdAt || 0) - (b.createdAt || 0);
}

function shortDate(key) {
  const d = fromKey(key);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function dueInfo(t) {
  if (!t.due) return null;
  const today = todayKey();
  if (t.due === today) return { text: 'Today', cls: 'today' };
  if (t.due < today && !t.done) return { text: `Overdue · ${shortDate(t.due)}`, cls: 'overdue' };
  if (t.due === toKey(addDays(fromKey(today), 1))) return { text: 'Tomorrow', cls: '' };
  return { text: shortDate(t.due), cls: '' };
}

// ---------- View state ----------

let view = VIEWS.includes(load(KEYS.view, 'month')) ? load(KEYS.view, 'month') : 'month';
let selected = todayKey();
let query = '';

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const isTouch = () => window.matchMedia('(hover: none)').matches;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function render() {
  renderTitle();
  for (const b of document.querySelectorAll('.seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  }
  if (view === 'month') renderMonth();
  else if (view === 'week') {
    const start = weekStart(fromKey(selected));
    renderTimeGrid(Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i))));
  } else renderTimeGrid([selected]);
  renderDay();
  renderTodos();
  renderHabits();
  renderUpcoming();
}

function renderTitle() {
  const d = fromKey(selected);
  let title;
  if (view === 'month') {
    title = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } else if (view === 'day') {
    title = window.matchMedia('(max-width: 600px)').matches
      ? `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
      : `${longDate(selected)}, ${d.getFullYear()}`;
  } else {
    const a = weekStart(d);
    const b = addDays(a, 6);
    title = a.getMonth() === b.getMonth()
      ? `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
      : `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}, ${b.getFullYear()}`;
  }
  $('viewTitle').textContent = title;
}

function makeChip(ev, key, withTime) {
  const chip = el('span', `chip t-${ev.type}`,
    withTime && isTimed(ev) ? `${ev.start} ${ev.title}` : ev.title);
  if (isDone(ev, key)) chip.classList.add('done');
  chip.title = `${ev.title} · ${timeLabel(ev)}`;
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    selectDay(key);
    openForm(ev);
  });
  chip.addEventListener('dblclick', (e) => e.stopPropagation());
  return chip;
}

// ----- Month view -----

function renderMonth() {
  const sel = fromKey(selected);
  const y = sel.getFullYear();
  const m = sel.getMonth();
  const start = weekStart(new Date(y, m, 1));
  const today = todayKey();

  const head = el('div', 'weekdays');
  for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) head.appendChild(el('div', null, name));

  const grid = el('div', 'grid');
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const key = toKey(date);
    const cell = el('div', 'day');
    if (date.getMonth() !== m) cell.classList.add('other');
    if (key === today) cell.classList.add('today');
    if (key === selected) cell.classList.add('selected');
    cell.title = 'Double-click to add';

    const top = el('div', 'day-top');
    const num = el('button', 'num', date.getDate());
    num.title = 'Open day';
    num.addEventListener('click', (e) => {
      e.stopPropagation();
      selected = key;
      setView('day');
    });
    top.appendChild(num);
    const dayHabits = habitsOn(key);
    if (dayHabits.length && dayHabits.every((h) => habitDone(h, key))) {
      top.appendChild(el('span', 'habit-ok', '✓')).title = 'Daily routine completed';
    }
    cell.appendChild(top);

    const list = eventsOn(key);
    for (const ev of list.slice(0, MAX_CHIPS)) cell.appendChild(makeChip(ev, key, true));
    if (list.length > MAX_CHIPS) cell.appendChild(el('span', 'more', `+${list.length - MAX_CHIPS} more`));

    // On touch screens, tapping the selected day again opens it.
    cell.addEventListener('click', () => {
      if (isTouch() && key === selected) setView('day');
      else selectDay(key);
    });
    cell.addEventListener('dblclick', () => openForm(null, key));
    grid.appendChild(cell);
  }
  $('view').replaceChildren(head, grid);
}

// ----- Week and day views (time grid) -----

// Splits overlapping events into side-by-side columns.
function layoutColumns(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = [];
  let cur = [];
  let curEnd = -1;
  for (const it of items) {
    if (cur.length && it.s >= curEnd) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(it);
    curEnd = Math.max(curEnd, it.e);
  }
  if (cur.length) clusters.push(cur);

  for (const cluster of clusters) {
    const colEnds = [];
    for (const it of cluster) {
      let i = colEnds.findIndex((end) => end <= it.s);
      if (i < 0) i = colEnds.push(0) - 1;
      colEnds[i] = it.e;
      it.col = i;
    }
    for (const it of cluster) it.cols = colEnds.length;
  }
}

function renderTimeGrid(keys) {
  const container = $('view');
  const prevScroll = container.querySelector('.tv-scroll')?.scrollTop;
  const today = todayKey();
  const columns = `var(--gutter) repeat(${keys.length}, minmax(0, 1fr))`;
  const pct = (min) => `${((min - DAY_START) / DAY_SPAN) * 100}%`;

  const tv = el('div', `tv ${keys.length > 1 ? 'tv-week' : 'tv-single'}`);
  tv.style.setProperty('--hours', DAY_SPAN / 60);

  const head = el('div', 'tv-row tv-head');
  const allDay = el('div', 'tv-row tv-allday');
  const scroll = el('div', 'tv-scroll');
  const body = el('div', 'tv-row tv-body');
  for (const row of [head, allDay, body]) row.style.gridTemplateColumns = columns;

  head.appendChild(el('div'));
  allDay.appendChild(el('div', 'tv-gutter-label', 'all day'));

  const gutter = el('div', 'tv-gutter');
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const label = el('span', null, toTime(m));
    label.style.top = pct(m);
    gutter.appendChild(label);
  }
  body.appendChild(gutter);

  for (const key of keys) {
    const d = fromKey(key);

    const dayHead = el('button', 'tv-day');
    if (key === today) dayHead.classList.add('today');
    if (key === selected) dayHead.classList.add('selected');
    dayHead.append(el('span', 'wd', WEEKDAYS[d.getDay()].slice(0, 3)), el('span', 'dn', d.getDate()));
    dayHead.title = 'Open day';
    dayHead.addEventListener('click', () => {
      selected = key;
      setView('day');
    });
    head.appendChild(dayHead);

    const allDayCell = el('div', 'tv-allday-cell');
    const col = el('div', 'tv-col');
    if (key === today) col.classList.add('today');

    const timed = [];
    for (const ev of eventsOn(key)) {
      if (!isTimed(ev)) {
        allDayCell.appendChild(makeChip(ev, key, false));
        continue;
      }
      // Items outside the visible hours are pinned to the top or bottom edge.
      const start = toMin(ev.start);
      const realEnd = ev.end ? toMin(ev.end) : start + DEFAULT_DURATION;
      const s = Math.min(Math.max(start, DAY_START), DAY_END - MIN_VISUAL_DURATION);
      const e = Math.min(DAY_END, Math.max(realEnd, s + MIN_VISUAL_DURATION));
      timed.push({ ev, s, e });
    }
    layoutColumns(timed);

    for (const { ev, s, e, col: c, cols } of timed) {
      const box = el('div', `tev t-${ev.type}`);
      if (e - s < 50) box.classList.add('compact');
      if (isDone(ev, key)) box.classList.add('done');
      box.style.top = pct(s);
      box.style.height = `calc(${((e - s) / DAY_SPAN) * 100}% - 2px)`;
      box.style.left = `calc(${(c / cols) * 100}% + 2px)`;
      box.style.width = `calc(${100 / cols}% - 4px)`;
      box.title = `${ev.title} · ${timeLabel(ev)}${ev.location ? ` · ${ev.location}` : ''}`;
      box.appendChild(el('div', 'tev-title', ev.title));
      box.appendChild(el('div', 'tev-time', timeLabel(ev) + (ev.location ? ` · ${ev.location}` : '')));
      box.addEventListener('click', (evt) => {
        evt.stopPropagation();
        selectDay(key);
        openForm(ev);
      });
      box.addEventListener('dblclick', (evt) => evt.stopPropagation());
      col.appendChild(box);
    }

    if (key === today && nowMin() >= DAY_START && nowMin() <= DAY_END) {
      const line = el('div', 'now');
      line.style.top = pct(nowMin());
      col.appendChild(line);
    }

    const slotAt = (evt) => {
      const rect = col.getBoundingClientRect();
      const offset = ((evt.clientY - rect.top) / rect.height) * DAY_SPAN;
      return toTime(Math.min(DAY_END - 30, DAY_START + Math.max(0, Math.floor(offset / 30) * 30)));
    };
    col.title = 'Double-click to add at that time';
    // On touch screens: in day view a tap adds at that time; in week view a second tap opens the day.
    col.addEventListener('click', (evt) => {
      if (isTouch() && view === 'day') openForm(null, key, slotAt(evt));
      else if (isTouch() && key === selected) setView('day');
      else selectDay(key);
    });
    col.addEventListener('dblclick', (evt) => openForm(null, key, slotAt(evt)));

    allDay.appendChild(allDayCell);
    body.appendChild(col);
  }

  scroll.appendChild(body);
  tv.append(head, allDay, scroll);
  container.replaceChildren(tv);
  if (prevScroll) scroll.scrollTop = prevScroll;
}

// ----- Side panel -----

function renderItem(ev, key, showDate) {
  const li = el('li', `item t-${ev.type}`);
  const done = isDone(ev, key);
  if (done) li.classList.add('done');

  if (ev.type === 'task') {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = done;
    cb.title = 'Mark as done';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleDone(ev, key));
    li.appendChild(cb);
  }

  const body = el('div', 'body');
  body.appendChild(el('div', 'title', ev.title));
  const meta = [showDate ? longDate(key) : null, timeLabel(ev), TYPES[ev.type]];
  if (ev.location) meta.push(`📍 ${ev.location}`);
  if (ev.repeat && ev.repeat !== 'none') meta.push(`🔁 ${REPEATS[ev.repeat]}`);
  body.appendChild(el('div', 'meta', meta.filter(Boolean).join(' · ')));
  if (ev.notes) body.appendChild(el('div', 'meta', ev.notes));
  li.appendChild(body);

  li.addEventListener('click', () => {
    selectDay(key);
    openForm(ev);
  });
  return li;
}

function renderDay() {
  const rel = relativeLabel(selected);
  $('dayTitle').textContent = rel === 'Today' || rel === 'Tomorrow' ? `${rel} · ${longDate(selected)}` : rel;
  const list = $('dayList');
  list.replaceChildren();
  const items = eventsOn(selected);
  if (!items.length) {
    list.appendChild(el('li', 'empty', 'Nothing planned. Click “+ Add” or double-click the calendar.'));
    return;
  }
  for (const ev of items) list.appendChild(renderItem(ev, selected, false));
}

function renderHabits() {
  const list = $('habitList');
  list.replaceChildren();
  const items = habitsOn(selected);
  const done = items.filter((h) => habitDone(h, selected)).length;
  $('habitCount').textContent = items.length ? `${done}/${items.length}` : '';
  $('habitBar').style.width = items.length ? `${(done / items.length) * 100}%` : '0';

  if (!items.length) {
    list.appendChild(el('li', 'empty', 'Add things you want to do every day and tick them off as you go.'));
    return;
  }
  for (const h of items) {
    const li = el('li', 'habit');
    if (habitDone(h, selected)) li.classList.add('done');
    const label = el('label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = habitDone(h, selected);
    cb.addEventListener('change', () => toggleHabit(h, selected));
    label.append(cb, el('span', null, h.title));
    const remove = el('button', 'x', '×');
    remove.type = 'button';
    remove.title = 'Remove from routine';
    remove.setAttribute('aria-label', `Remove ${h.title}`);
    remove.addEventListener('click', () => removeHabit(h));
    li.append(label, remove);
    list.appendChild(li);
  }
}

function renderUpcoming() {
  const list = $('upcomingList');
  list.replaceChildren();

  if (query) {
    $('upcomingTitle').textContent = 'Search results';
    const q = query.toLowerCase();
    const found = events
      .filter((ev) => [ev.title, ev.notes, ev.location].some((s) => s && s.toLowerCase().includes(q)))
      .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b));
    if (!found.length) list.appendChild(el('li', 'empty', 'No matches.'));
    for (const ev of found) list.appendChild(renderItem(ev, ev.date, true));
    return;
  }

  $('upcomingTitle').textContent = `Next ${UPCOMING_DAYS} days`;
  const start = fromKey(todayKey());
  let count = 0;
  for (let i = 0; i < UPCOMING_DAYS; i++) {
    const key = toKey(addDays(start, i));
    const items = eventsOn(key);
    if (!items.length) continue;
    list.appendChild(el('li', 'group', relativeLabel(key)));
    for (const ev of items) list.appendChild(renderItem(ev, key, false));
    count += items.length;
  }
  if (!count) list.appendChild(el('li', 'empty', 'Nothing coming up.'));
}

function renderTodoItem(t) {
  const li = el('li', 'todo');
  if (t.done) li.classList.add('done');

  if (editingTodo === t.id) {
    const f = el('form', 'todo-edit');
    const title = el('input');
    title.value = t.title;
    title.maxLength = 160;
    title.setAttribute('aria-label', 'Edit to-do');
    const due = el('input');
    due.type = 'date';
    due.value = t.due || '';
    due.setAttribute('aria-label', 'Due date (optional)');
    const ok = el('button', 'btn small', 'Save');
    f.append(title, due, ok);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = title.value.trim();
      if (value) {
        t.title = value;
        t.due = due.value;
        persist(sb.from(T.todos).update({ title: t.title, due: t.due || null }).eq('id', t.id));
      }
      editingTodo = null;
      renderTodos();
    });
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        editingTodo = null;
        renderTodos();
      }
    });
    li.appendChild(f);
    setTimeout(() => title.focus(), 0);
    return li;
  }

  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!t.done;
  cb.title = 'Mark as done';
  cb.addEventListener('change', () => toggleTodo(t));

  const body = el('div', 'body');
  const title = el('div', 'todo-title', t.title);
  title.title = 'Click to edit';
  title.addEventListener('click', () => {
    editingTodo = t.id;
    renderTodos();
  });
  body.appendChild(title);
  const due = dueInfo(t);
  if (due) body.appendChild(el('div', `due ${due.cls}`.trim(), due.text));

  const remove = el('button', 'x', '×');
  remove.type = 'button';
  remove.title = 'Delete';
  remove.setAttribute('aria-label', `Delete ${t.title}`);
  remove.addEventListener('click', () => removeTodo(t));

  li.append(cb, body, remove);
  return li;
}

function renderTodos() {
  const pending = todos.filter((t) => !t.done).sort(compareTodos);
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  $('todoCount').textContent = pending.length ? String(pending.length) : '';

  const list = $('todoList');
  list.replaceChildren();
  if (!pending.length) list.appendChild(el('li', 'empty', 'Nothing pending. Jot down anything you need to remember.'));
  for (const t of pending) list.appendChild(renderTodoItem(t));

  $('todoDone').hidden = !done.length;
  $('todoDoneSummary').textContent = `Done (${done.length})`;
  const doneList = $('todoDoneList');
  doneList.replaceChildren();
  for (const t of done) doneList.appendChild(renderTodoItem(t));
}

// ----- Navigation -----

function selectDay(key) {
  if (key === selected) return;
  selected = key;
  render();
}

function setView(v) {
  view = v;
  store(KEYS.view, v);
  render();
}

function shift(n) {
  const d = fromKey(selected);
  let next;
  if (view === 'month') {
    const lastDay = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    next = new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), lastDay));
  } else {
    next = addDays(d, view === 'week' ? 7 * n : n);
  }
  selected = toKey(next);
  render();
}

// ---------- Form ----------

const dlg = $('dlg');
const form = $('form');
let editing = null;

function fillSelect(select, options) {
  for (const [value, label] of Object.entries(options)) {
    const opt = el('option', null, label);
    opt.value = value;
    select.appendChild(opt);
  }
}

function syncAllDay() {
  $('timesRow').hidden = form.elements.allDay.checked;
}

function openForm(ev, key = selected, start = '') {
  editing = ev;
  const f = form.elements;
  $('dlgTitle').textContent = ev ? 'Edit' : 'New';
  $('btnDelete').hidden = !ev;
  $('formError').hidden = true;
  f.title.value = ev ? ev.title : '';
  f.type.value = ev ? ev.type : 'appointment';
  f.date.value = ev ? ev.date : key;
  f.allDay.checked = ev ? !!ev.allDay : false;
  f.start.value = ev ? (ev.start || '') : start;
  f.end.value = ev ? (ev.end || '') : (start ? toTime(Math.min(toMin(start) + DEFAULT_DURATION, 23 * 60 + 59)) : '');
  f.repeat.value = ev ? (ev.repeat || 'none') : 'none';
  f.location.value = ev ? (ev.location || '') : '';
  f.notes.value = ev ? (ev.notes || '') : '';
  syncAllDay();
  dlg.showModal();
  f.title.focus();
}

function showError(msg) {
  $('formError').textContent = msg;
  $('formError').hidden = false;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = form.elements;
  const title = f.title.value.trim();
  if (!title) return showError('Please add a title.');
  if (!f.date.value) return showError('Please pick a date.');
  const allDay = f.allDay.checked;
  const start = allDay ? '' : f.start.value;
  const end = allDay || !start ? '' : f.end.value;
  if (start && end && end < start) return showError('The end time is before the start time.');

  const data = {
    title,
    type: f.type.value,
    date: f.date.value,
    allDay: allDay || !start,
    start,
    end,
    repeat: f.repeat.value,
    location: f.location.value.trim(),
    notes: f.notes.value.trim(),
  };

  let target = editing;
  if (target) {
    Object.assign(target, data);
  } else {
    target = { id: newId(), done: false, doneOn: [], ...data };
    events.push(target);
  }
  persist(sb.from(T.events).upsert(eventToRow(target)));
  dlg.close();
  selected = data.date;
  render();
});

form.elements.allDay.addEventListener('change', syncAllDay);
$('btnCancel').addEventListener('click', () => dlg.close());
$('btnDelete').addEventListener('click', () => {
  if (!editing) return;
  const extra = editing.repeat && editing.repeat !== 'none' ? ' (all repetitions will be deleted)' : '';
  if (!confirm(`Delete “${editing.title}”${extra}?`)) return;
  const id = editing.id;
  events = events.filter((ev) => ev !== editing);
  persist(sb.from(T.events).delete().eq('id', id));
  dlg.close();
  render();
});

// ---------- Backups ----------

function exportData() {
  const data = { version: 3, events, habits, habitLog, todos };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calendar-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function parseBackup(src) {
  // The first backup format was a plain list of events.
  if (Array.isArray(src)) src = { events: src };
  if (!src || typeof src !== 'object') src = {};
  return {
    events: asArray(src.events).filter(isValidEvent).map(normalizeEvent),
    habits: asArray(src.habits).filter(isValidHabit),
    habitLog: sanitizeLog(src.habitLog),
    todos: asArray(src.todos).filter(isValidTodo),
  };
}

const backupSize = (b) => b.events.length + b.habits.length + b.todos.length;

// Upserts a backup (or data saved in this browser by older versions) into the account.
async function importIntoAccount(b) {
  // The database uses UUIDs; data from very old versions may have other ids.
  const habitIds = new Map();
  for (const h of b.habits) {
    const id = isUuid(h.id) ? h.id : newId();
    habitIds.set(h.id, id);
    h.id = id;
  }
  for (const x of [...b.events, ...b.todos]) if (!isUuid(x.id)) x.id = newId();

  const writes = [];
  if (b.events.length) writes.push(sb.from(T.events).upsert(b.events.map(eventToRow)));
  if (b.habits.length) writes.push(sb.from(T.habits).upsert(b.habits.map(habitToRow)));
  if (b.todos.length) writes.push(sb.from(T.todos).upsert(b.todos.map(todoToRow)));
  for (const { error } of await Promise.all(writes)) if (error) throw error;

  // Log rows go last: they must point at routine items that already exist.
  const known = new Set([...habits.map((h) => h.id), ...b.habits.map((h) => h.id)]);
  const logRows = Object.entries(b.habitLog).flatMap(([day, ids]) => ids
    .map((id) => habitIds.get(id) || id)
    .filter((id) => known.has(id))
    .map((habit_id) => ({ habit_id, day })));
  if (logRows.length) {
    const { error } = await sb.from(T.habitLog).upsert(logRows, { onConflict: 'habit_id,day', ignoreDuplicates: true });
    if (error) throw error;
  }

  await loadAll();
  render();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let b;
    try {
      b = parseBackup(JSON.parse(reader.result));
    } catch {
      return alert('This file is not a valid backup.');
    }
    if (!backupSize(b)) return alert('This file contains no data.');
    if (!confirm(`Import ${b.events.length} events, ${b.todos.length} to-dos and ${b.habits.length} routine items into your account?`)) return;
    try {
      await importIntoAccount(b);
    } catch (e) {
      console.error(e);
      alert(`The import failed: ${e.message || e}`);
    }
  };
  reader.readAsText(file);
}

// Earlier versions kept everything in this browser. Offer to move it into the account once.
const LOCAL_DATA_KEYS = [KEYS.events, KEYS.habits, KEYS.habitLog, KEYS.todos, ...Object.values(LEGACY_KEYS)];

async function migrateLocalData() {
  const b = parseBackup({
    events: load(KEYS.events, null) ?? load(LEGACY_KEYS.events, []),
    habits: load(KEYS.habits, null) ?? load(LEGACY_KEYS.habits, []),
    habitLog: load(KEYS.habitLog, null) ?? load(LEGACY_KEYS.habitLog, {}),
    todos: load(KEYS.todos, []),
  });
  const n = backupSize(b);
  if (!n) return;
  if (!confirm(`This browser has ${n} items saved before sign-in was added. Upload them to your account?\n\n(Cancel keeps them here and asks again next time.)`)) return;
  await importIntoAccount(b);
  for (const k of LOCAL_DATA_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

// ---------- Theme ----------

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store(KEYS.theme, next);
}

// ---------- Auth ----------

function showScreen(name) {
  $('loading').hidden = name !== 'loading';
  $('auth').hidden = !['login', 'recovery', 'config'].includes(name);
  $('loginForm').hidden = name !== 'login';
  $('recoveryForm').hidden = name !== 'recovery';
  $('configError').hidden = name !== 'config';
  $('app').hidden = name !== 'app';
}

function authMessage(id, text, ok = false) {
  const p = $(id);
  p.textContent = text;
  p.hidden = !text;
  p.classList.toggle('ok', ok);
}

async function startApp(user) {
  if (currentUser && currentUser.id === user.id) return;
  currentUser = user;
  $('menuUser').textContent = user.email || '';
  showScreen('loading');
  try {
    await loadAll();
    await migrateLocalData();
  } catch (e) {
    console.error(e);
    alert(`Could not load your data: ${e.message || e}`);
  }
  selected = todayKey();
  showScreen('app');
  render();
}

function stopApp() {
  currentUser = null;
  events = [];
  habits = [];
  habitLog = {};
  todos = [];
  if (dlg.open) dlg.close();
  render(); // clear what was on screen
  showScreen('login');
}

function initAuth() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const button = e.target.querySelector('[type="submit"]');
    authMessage('loginMsg', '');
    button.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    button.disabled = false;
    if (error) return authMessage('loginMsg', error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    f.password.value = '';
    startApp(data.user);
  });

  $('btnForgot').addEventListener('click', async () => {
    const email = $('loginForm').elements.email.value.trim();
    if (!email) return authMessage('loginMsg', 'Type your email above first.');
    // GitHub Pages serves the app from a sub-path, so redirect back to this exact page.
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) return authMessage('loginMsg', error.message);
    authMessage('loginMsg', 'If that account exists, you\'ll get an email with a link to set a new password.', true);
  });

  $('recoveryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.password.value !== f.confirm.value) return authMessage('recoveryMsg', 'The passwords don\'t match.');
    const { data, error } = await sb.auth.updateUser({ password: f.password.value });
    if (error) return authMessage('recoveryMsg', error.message);
    f.password.value = '';
    f.confirm.value = '';
    history.replaceState(null, '', window.location.pathname);
    startApp(data.user);
  });

  $('btnSignOut').addEventListener('click', async () => {
    await sb.auth.signOut();
    stopApp();
  });

  // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showScreen('recovery');
    else if (event === 'SIGNED_OUT' && currentUser) stopApp();
  });
}

async function boot() {
  init();
  if (!sb) return showScreen('config');
  initAuth();

  if (AUTH_HASH.get('type') === 'recovery') return showScreen('recovery');
  const { data: { session } } = await sb.auth.getSession();
  if (session) return startApp(session.user);
  showScreen('login');
  const linkError = AUTH_HASH.get('error_description');
  if (linkError) {
    authMessage('loginMsg', linkError);
    history.replaceState(null, '', window.location.pathname);
  }
}

// ---------- Startup ----------

function init() {
  fillSelect(form.elements.type, TYPES);
  fillSelect(form.elements.repeat, REPEATS);

  const legend = $('legend');
  for (const [value, label] of Object.entries(TYPES)) legend.appendChild(el('span', `t-${value}`, label));

  $('btnPrev').addEventListener('click', () => shift(-1));
  $('btnNext').addEventListener('click', () => shift(1));
  $('btnToday').addEventListener('click', () => {
    selected = todayKey();
    render();
  });
  $('btnNew').addEventListener('click', () => openForm(null));
  $('fab').addEventListener('click', () => openForm(null));

  // Swipe left/right on the calendar to move to the next/previous period.
  let touchStart = null;
  $('view').addEventListener('touchstart', (e) => {
    touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  $('view').addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  }, { passive: true });
  $('btnAddDay').addEventListener('click', () => openForm(null, selected));
  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    renderUpcoming();
  });

  $('todoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const title = f.title.value.trim();
    if (!title) return;
    addTodo(title, f.due.value);
    f.title.value = '';
    f.due.value = '';
    f.title.focus();
  });
  $('btnClearDone').addEventListener('click', clearDoneTodos);

  $('habitForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.title;
    const title = input.value.trim();
    if (!title) return;
    addHabit(title);
    input.value = '';
  });

  const menu = $('menu');
  $('btnMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('btnExport').addEventListener('click', exportData);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('btnTheme').addEventListener('click', toggleTheme);
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  window.matchMedia('(max-width: 600px)').addEventListener('change', renderTitle);

  document.addEventListener('keydown', (e) => {
    if (!currentUser || dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') shift(-1);
    else if (e.key === 'ArrowRight') shift(1);
    else if (k === 't') { selected = todayKey(); render(); }
    else if (k === 'm') setView('month');
    else if (k === 'w') setView('week');
    else if (k === 'd') setView('day');
    else if (k === 'n') { e.preventDefault(); openForm(null); }
  });

  // Every minute: move the "now" line and refresh "today" after midnight.
  let lastToday = todayKey();
  setInterval(() => {
    if (!currentUser || dlg.open) return;
    if (todayKey() !== lastToday) {
      lastToday = todayKey();
      render();
    } else if (view !== 'month') {
      render();
    }
  }, 60 * 1000);
}

boot();
