'use strict';

const KEYS = {
  events: 'calendario-personal:eventos',
  habits: 'calendario-personal:rutinas',
  habitLog: 'calendario-personal:rutinas-hechas',
  theme: 'calendario-personal:tema',
  view: 'calendario-personal:vista',
};

const TYPES = {
  cita: 'Cita',
  tarea: 'Tarea',
  recordatorio: 'Recordatorio',
  trabajo: 'Trabajo',
  personal: 'Personal',
  deporte: 'Deporte',
  cumple: 'Cumpleaños',
  otro: 'Otro',
};

const REPEATS = {
  none: 'No se repite',
  daily: 'Cada día',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
  yearly: 'Cada año',
};

const VIEWS = ['month', 'week', 'day'];

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MAX_CHIPS = 3;
const UPCOMING_DAYS = 30;
const HOUR_PX = 48;
const DEFAULT_DURATION = 60;
const MIN_VISUAL_DURATION = 30;

// ---------- Utilidades de fechas (siempre en hora local) ----------

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const todayKey = () => toKey(new Date());
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)); // lunes
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
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

function relativeLabel(key) {
  const t = todayKey();
  if (key === t) return 'Hoy';
  if (key === toKey(addDays(fromKey(t), 1))) return 'Mañana';
  return longDate(key);
}

// ---------- Almacenamiento ----------

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

function sanitizeLog(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (isDateKey(k) && Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
  }
  return out;
}

const asArray = (x) => (Array.isArray(x) ? x : []);

let events = asArray(load(KEYS.events, [])).filter(isValidEvent);
let habits = asArray(load(KEYS.habits, [])).filter(isValidHabit);
let habitLog = sanitizeLog(load(KEYS.habitLog, {}));

function save() {
  const ok = [
    store(KEYS.events, events),
    store(KEYS.habits, habits),
    store(KEYS.habitLog, habitLog),
  ].every(Boolean);
  if (!ok) alert('No se han podido guardar los cambios en este navegador. Exporta una copia de seguridad para no perderlos.');
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ---------- Eventos ----------

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

// Las tareas repetidas se marcan como hechas por día; las normales, una sola vez.
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
  save();
  render();
}

function timeLabel(ev) {
  if (!isTimed(ev)) return 'Todo el día';
  return ev.end ? `${ev.start} – ${ev.end}` : ev.start;
}

// ---------- Rutina diaria ----------

const habitsOn = (key) => habits.filter((h) => !h.since || key >= h.since);
const habitDone = (h, key) => (habitLog[key] || []).includes(h.id);

function toggleHabit(h, key) {
  const set = new Set(habitLog[key] || []);
  set.has(h.id) ? set.delete(h.id) : set.add(h.id);
  if (set.size) habitLog[key] = [...set];
  else delete habitLog[key];
  save();
  render();
}

function addHabit(title) {
  const today = todayKey();
  habits.push({ id: newId(), title, since: selected < today ? selected : today });
  save();
  render();
}

function removeHabit(h) {
  if (!confirm(`¿Quitar “${h.title}” de tu rutina diaria? Se borrará también su historial.`)) return;
  habits = habits.filter((x) => x !== h);
  for (const key of Object.keys(habitLog)) {
    habitLog[key] = habitLog[key].filter((id) => id !== h.id);
    if (!habitLog[key].length) delete habitLog[key];
  }
  save();
  render();
}

// ---------- Estado de la vista ----------

let view = VIEWS.includes(load(KEYS.view, 'month')) ? load(KEYS.view, 'month') : 'month';
let selected = todayKey();
let query = '';

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);

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
  renderHabits();
  renderUpcoming();
}

function renderTitle() {
  const d = fromKey(selected);
  let title;
  if (view === 'month') {
    title = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } else if (view === 'day') {
    title = `${longDate(selected)} de ${d.getFullYear()}`;
  } else {
    const a = weekStart(d);
    const b = addDays(a, 6);
    title = a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} de ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
      : `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
  }
  $('viewTitle').textContent = title;
}

function makeChip(ev, key, withTime) {
  const chip = el('span', `chip t-${ev.type || 'otro'}`,
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

// ----- Vista mes -----

function renderMonth() {
  const sel = fromKey(selected);
  const y = sel.getFullYear();
  const m = sel.getMonth();
  const start = weekStart(new Date(y, m, 1));
  const today = todayKey();

  const head = el('div', 'weekdays');
  for (const name of ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']) head.appendChild(el('div', null, name));

  const grid = el('div', 'grid');
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const key = toKey(date);
    const cell = el('div', 'day');
    if (date.getMonth() !== m) cell.classList.add('other');
    if (key === today) cell.classList.add('today');
    if (key === selected) cell.classList.add('selected');
    cell.title = 'Doble clic para añadir';

    const top = el('div', 'day-top');
    const num = el('button', 'num', date.getDate());
    num.title = 'Ver el día';
    num.addEventListener('click', (e) => {
      e.stopPropagation();
      selected = key;
      setView('day');
    });
    top.appendChild(num);
    const dayHabits = habitsOn(key);
    if (dayHabits.length && dayHabits.every((h) => habitDone(h, key))) {
      top.appendChild(el('span', 'habit-ok', '✓')).title = 'Rutina diaria completada';
    }
    cell.appendChild(top);

    const list = eventsOn(key);
    for (const ev of list.slice(0, MAX_CHIPS)) cell.appendChild(makeChip(ev, key, true));
    if (list.length > MAX_CHIPS) cell.appendChild(el('span', 'more', `+${list.length - MAX_CHIPS} más`));

    cell.addEventListener('click', () => selectDay(key));
    cell.addEventListener('dblclick', () => openForm(null, key));
    grid.appendChild(cell);
  }
  $('view').replaceChildren(head, grid);
}

// ----- Vistas semana y día (rejilla horaria) -----

// Reparte en columnas los eventos que se solapan.
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
  const columns = `56px repeat(${keys.length}, minmax(0, 1fr))`;
  let earliest = 24 * 60;

  const tv = el('div', `tv ${keys.length > 1 ? 'tv-week' : 'tv-single'}`);
  tv.style.setProperty('--hour', `${HOUR_PX}px`);

  const head = el('div', 'tv-row tv-head');
  const allDay = el('div', 'tv-row tv-allday');
  const scroll = el('div', 'tv-scroll');
  const body = el('div', 'tv-row tv-body');
  for (const row of [head, allDay, body]) row.style.gridTemplateColumns = columns;
  body.style.height = `${24 * HOUR_PX}px`;

  head.appendChild(el('div'));
  allDay.appendChild(el('div', 'tv-gutter-label', 'todo el día'));

  const gutter = el('div', 'tv-gutter');
  for (let h = 1; h < 24; h++) {
    const label = el('span', null, `${pad(h)}:00`);
    label.style.top = `${h * HOUR_PX}px`;
    gutter.appendChild(label);
  }
  body.appendChild(gutter);

  for (const key of keys) {
    const d = fromKey(key);

    const dayHead = el('button', 'tv-day');
    if (key === today) dayHead.classList.add('today');
    if (key === selected) dayHead.classList.add('selected');
    dayHead.append(el('span', 'wd', WEEKDAYS[d.getDay()].slice(0, 3)), el('span', 'dn', d.getDate()));
    dayHead.title = 'Ver el día';
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
      const s = toMin(ev.start);
      const realEnd = ev.end ? toMin(ev.end) : s + DEFAULT_DURATION;
      const e = Math.min(24 * 60, Math.max(realEnd, s + MIN_VISUAL_DURATION));
      timed.push({ ev, s, e });
      earliest = Math.min(earliest, s);
    }
    layoutColumns(timed);

    for (const { ev, s, e, col: c, cols } of timed) {
      const height = ((e - s) / 60) * HOUR_PX - 2;
      const box = el('div', `tev t-${ev.type || 'otro'}`);
      if (height < 40) box.classList.add('compact');
      if (isDone(ev, key)) box.classList.add('done');
      box.style.top = `${(s / 60) * HOUR_PX}px`;
      box.style.height = `${height}px`;
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

    if (key === today) {
      const line = el('div', 'now');
      line.style.top = `${(nowMin() / 60) * HOUR_PX}px`;
      col.appendChild(line);
    }

    col.title = 'Doble clic para añadir a esa hora';
    col.addEventListener('click', () => selectDay(key));
    col.addEventListener('dblclick', (evt) => {
      const y = evt.clientY - col.getBoundingClientRect().top;
      const min = Math.min(23 * 60 + 30, Math.max(0, Math.floor((y / HOUR_PX) * 2) * 30));
      openForm(null, key, toTime(min));
    });

    allDay.appendChild(allDayCell);
    body.appendChild(col);
  }

  scroll.appendChild(body);
  tv.append(head, allDay, scroll);
  container.replaceChildren(tv);

  const defaultHour = Math.max(0, Math.min(7, Math.floor(earliest / 60) - 1));
  scroll.scrollTop = prevScroll ?? Math.max(0, defaultHour * HOUR_PX - 12);
}

// ----- Panel lateral -----

function renderItem(ev, key, showDate) {
  const li = el('li', `item t-${ev.type || 'otro'}`);
  const done = isDone(ev, key);
  if (done) li.classList.add('done');

  if (ev.type === 'tarea') {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = done;
    cb.title = 'Marcar como hecha';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleDone(ev, key));
    li.appendChild(cb);
  }

  const body = el('div', 'body');
  body.appendChild(el('div', 'title', ev.title));
  const meta = [showDate ? longDate(key) : null, timeLabel(ev), TYPES[ev.type] || TYPES.otro];
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
  $('dayTitle').textContent = rel === 'Hoy' || rel === 'Mañana' ? `${rel} · ${longDate(selected)}` : rel;
  const list = $('dayList');
  list.replaceChildren();
  const items = eventsOn(selected);
  if (!items.length) {
    list.appendChild(el('li', 'empty', 'Nada apuntado. Pulsa “+ Añadir” o haz doble clic en el calendario.'));
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
    list.appendChild(el('li', 'empty', 'Añade cosas que quieras hacer cada día y márcalas al cumplirlas.'));
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
    remove.title = 'Quitar de la rutina';
    remove.setAttribute('aria-label', `Quitar ${h.title}`);
    remove.addEventListener('click', () => removeHabit(h));
    li.append(label, remove);
    list.appendChild(li);
  }
}

function renderUpcoming() {
  const list = $('upcomingList');
  list.replaceChildren();

  if (query) {
    $('upcomingTitle').textContent = 'Resultados de búsqueda';
    const q = query.toLowerCase();
    const found = events
      .filter((ev) => [ev.title, ev.notes, ev.location].some((s) => s && s.toLowerCase().includes(q)))
      .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b));
    if (!found.length) list.appendChild(el('li', 'empty', 'No hay coincidencias.'));
    for (const ev of found) list.appendChild(renderItem(ev, ev.date, true));
    return;
  }

  $('upcomingTitle').textContent = `Próximos ${UPCOMING_DAYS} días`;
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
  if (!count) list.appendChild(el('li', 'empty', 'No tienes nada en los próximos días.'));
}

// ----- Navegación -----

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

// ---------- Formulario ----------

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
  $('dlgTitle').textContent = ev ? 'Editar' : 'Nuevo';
  $('btnDelete').hidden = !ev;
  $('formError').hidden = true;
  f.title.value = ev ? ev.title : '';
  f.type.value = ev ? (ev.type || 'otro') : 'cita';
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
  if (!title) return showError('Ponle un título.');
  if (!f.date.value) return showError('Elige una fecha.');
  const allDay = f.allDay.checked;
  const start = allDay ? '' : f.start.value;
  const end = allDay || !start ? '' : f.end.value;
  if (start && end && end < start) return showError('La hora de fin es anterior a la de inicio.');

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

  if (editing) {
    Object.assign(editing, data);
  } else {
    events.push({ id: newId(), done: false, doneOn: [], ...data });
  }
  save();
  dlg.close();
  selected = data.date;
  render();
});

form.elements.allDay.addEventListener('change', syncAllDay);
$('btnCancel').addEventListener('click', () => dlg.close());
$('btnDelete').addEventListener('click', () => {
  if (!editing) return;
  const extra = editing.repeat && editing.repeat !== 'none' ? ' (se borrarán todas las repeticiones)' : '';
  if (!confirm(`¿Eliminar “${editing.title}”${extra}?`)) return;
  events = events.filter((ev) => ev !== editing);
  save();
  dlg.close();
  render();
});

// ---------- Copias de seguridad ----------

function exportData() {
  const data = { version: 2, events, habits, habitLog };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calendario-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function mergeById(current, incoming) {
  const byId = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) byId.set(x.id, x);
  return [...byId.values()];
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      return alert('El archivo no es una copia válida.');
    }
    // Las copias antiguas eran solo una lista de eventos.
    const src = Array.isArray(data) ? { events: data } : (data && typeof data === 'object' ? data : {});
    const newEvents = asArray(src.events).filter(isValidEvent);
    const newHabits = asArray(src.habits).filter(isValidHabit);
    const newLog = sanitizeLog(src.habitLog);
    if (!newEvents.length && !newHabits.length) return alert('El archivo no contiene datos.');
    if (!confirm(`Se van a importar ${newEvents.length} eventos y ${newHabits.length} rutinas, combinándolos con lo que ya tienes. ¿Continuar?`)) return;

    events = mergeById(events, newEvents);
    habits = mergeById(habits, newHabits);
    for (const [k, ids] of Object.entries(newLog)) {
      habitLog[k] = [...new Set([...(habitLog[k] || []), ...ids])];
    }
    save();
    render();
  };
  reader.readAsText(file);
}

// ---------- Tema ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function initTheme() {
  const saved = load(KEYS.theme, null);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light'));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store(KEYS.theme, next);
}

// ---------- Arranque ----------

function init() {
  initTheme();
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
  $('btnAddDay').addEventListener('click', () => openForm(null, selected));
  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    renderUpcoming();
  });

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

  document.addEventListener('keydown', (e) => {
    if (dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') shift(-1);
    else if (e.key === 'ArrowRight') shift(1);
    else if (k === 't') { selected = todayKey(); render(); }
    else if (k === 'm') setView('month');
    else if (k === 's') setView('week');
    else if (k === 'd') setView('day');
    else if (k === 'n') { e.preventDefault(); openForm(null); }
  });

  // Cada minuto: mueve la línea de "ahora" y, pasada la medianoche, actualiza "hoy".
  let lastToday = todayKey();
  setInterval(() => {
    if (dlg.open) return;
    if (todayKey() !== lastToday) {
      lastToday = todayKey();
      render();
    } else if (view !== 'month') {
      render();
    }
  }, 60 * 1000);

  render();
}

init();
