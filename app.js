'use strict';

const STORAGE_KEY = 'calendario-personal:eventos';
const THEME_KEY = 'calendario-personal:tema';

const TYPES = {
  cita: 'Cita',
  tarea: 'Tarea',
  recordatorio: 'Recordatorio',
  trabajo: 'Trabajo',
  personal: 'Personal',
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

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MAX_CHIPS = 3;
const UPCOMING_DAYS = 30;

// ---------- Utilidades de fechas (siempre en hora local) ----------

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const todayKey = () => toKey(new Date());

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

// ---------- Datos ----------

let events = loadEvents();

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(isValidEvent) : [];
  } catch {
    return [];
  }
}

function saveEvents() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    alert('No se han podido guardar los cambios en este navegador. Exporta una copia de seguridad para no perderlos.');
  }
}

function isValidEvent(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' &&
    typeof e.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
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
  saveEvents();
  render();
}

function timeLabel(ev) {
  if (ev.allDay || !ev.start) return 'Todo el día';
  return ev.end ? `${ev.start} – ${ev.end}` : ev.start;
}

// ---------- Estado de la vista ----------

let selected = todayKey();
let viewMonth = new Date(fromKey(selected).getFullYear(), fromKey(selected).getMonth(), 1);
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
  renderGrid();
  renderDay();
  renderUpcoming();
}

function renderGrid() {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  $('monthTitle').textContent = `${MONTHS[m]} ${y}`;

  const offset = (viewMonth.getDay() + 6) % 7; // semana empieza en lunes
  const start = new Date(y, m, 1 - offset);
  const today = todayKey();
  const grid = $('grid');
  grid.replaceChildren();

  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const key = toKey(date);
    const cell = el('div', 'day');
    if (date.getMonth() !== m) cell.classList.add('other');
    if (key === today) cell.classList.add('today');
    if (key === selected) cell.classList.add('selected');
    cell.title = 'Doble clic para añadir';
    cell.appendChild(el('span', 'num', date.getDate()));

    const list = eventsOn(key);
    for (const ev of list.slice(0, MAX_CHIPS)) {
      const chip = el('span', `chip t-${ev.type || 'otro'}`,
        ev.allDay || !ev.start ? ev.title : `${ev.start} ${ev.title}`);
      if (isDone(ev, key)) chip.classList.add('done');
      chip.title = `${ev.title} · ${timeLabel(ev)}`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDay(key);
        openForm(ev);
      });
      cell.appendChild(chip);
    }
    if (list.length > MAX_CHIPS) cell.appendChild(el('span', 'more', `+${list.length - MAX_CHIPS} más`));

    cell.addEventListener('click', () => selectDay(key));
    cell.addEventListener('dblclick', () => openForm(null, key));
    grid.appendChild(cell);
  }
}

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
  $('dayTitle').textContent = relativeLabel(selected) === 'Hoy' || relativeLabel(selected) === 'Mañana'
    ? `${relativeLabel(selected)} · ${longDate(selected)}`
    : longDate(selected);
  const list = $('dayList');
  list.replaceChildren();
  const items = eventsOn(selected);
  if (!items.length) {
    list.appendChild(el('li', 'empty', 'Nada apuntado. Pulsa “+ Añadir” o haz doble clic en un día.'));
    return;
  }
  for (const ev of items) list.appendChild(renderItem(ev, selected, false));
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

function selectDay(key) {
  selected = key;
  const d = fromKey(key);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  render();
}

function shiftMonth(n) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + n, 1);
  renderGrid();
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
  const allDay = form.elements.allDay.checked;
  $('timesRow').hidden = allDay;
}

function openForm(ev, key = selected) {
  editing = ev;
  const f = form.elements;
  $('dlgTitle').textContent = ev ? 'Editar' : 'Nuevo';
  $('btnDelete').hidden = !ev;
  $('formError').hidden = true;
  f.title.value = ev ? ev.title : '';
  f.type.value = ev ? (ev.type || 'otro') : 'cita';
  f.date.value = ev ? ev.date : key;
  f.allDay.checked = ev ? !!ev.allDay : false;
  f.start.value = ev ? (ev.start || '') : '';
  f.end.value = ev ? (ev.end || '') : '';
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
  saveEvents();
  dlg.close();
  selectDay(data.date);
});

form.elements.allDay.addEventListener('change', syncAllDay);
$('btnCancel').addEventListener('click', () => dlg.close());
$('btnDelete').addEventListener('click', () => {
  if (!editing) return;
  const extra = editing.repeat && editing.repeat !== 'none' ? ' (se borrarán todas las repeticiones)' : '';
  if (!confirm(`¿Eliminar “${editing.title}”${extra}?`)) return;
  events = events.filter((ev) => ev !== editing);
  saveEvents();
  dlg.close();
  render();
});

// ---------- Copias de seguridad ----------

function exportData() {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calendario-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    if (!Array.isArray(data)) return alert('El archivo no es una copia válida.');
    const valid = data.filter(isValidEvent);
    if (!valid.length) return alert('El archivo no contiene ningún evento.');
    if (!confirm(`Se van a importar ${valid.length} elementos y se combinarán con los que ya tienes. ¿Continuar?`)) return;
    const byId = new Map(events.map((ev) => [ev.id, ev]));
    for (const ev of valid) byId.set(ev.id, ev);
    events = [...byId.values()];
    saveEvents();
    render();
  };
  reader.readAsText(file);
}

// ---------- Tema ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* sin almacenamiento */ }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* sin almacenamiento */ }
}

// ---------- Arranque ----------

function init() {
  initTheme();
  fillSelect(form.elements.type, TYPES);
  fillSelect(form.elements.repeat, REPEATS);

  const legend = $('legend');
  for (const [value, label] of Object.entries(TYPES)) legend.appendChild(el('span', `t-${value}`, label));

  $('btnPrev').addEventListener('click', () => shiftMonth(-1));
  $('btnNext').addEventListener('click', () => shiftMonth(1));
  $('btnToday').addEventListener('click', () => selectDay(todayKey()));
  $('btnNew').addEventListener('click', () => openForm(null));
  $('btnAddDay').addEventListener('click', () => openForm(null, selected));
  $('search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    renderUpcoming();
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
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    else if (e.key === 'ArrowRight') shiftMonth(1);
    else if (e.key.toLowerCase() === 't') selectDay(todayKey());
    else if (e.key.toLowerCase() === 'n') { e.preventDefault(); openForm(null); }
  });

  // Si la app se queda abierta pasada la medianoche, refresca "hoy".
  let lastToday = todayKey();
  setInterval(() => {
    if (todayKey() !== lastToday) {
      lastToday = todayKey();
      render();
    }
  }, 60 * 1000);

  render();
}

init();
