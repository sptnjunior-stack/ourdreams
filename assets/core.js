'use strict';
/* =====================================================================
 * core.js — utilities, icons, data model, store and calculations
 * ===================================================================== */

const APP_VERSION = '1.0.0';
const LS = { data: 'cbt.data.v1', cfg: 'cbt.config.v1', ui: 'cbt.ui.v1', sync: 'cbt.sync.v1' };

/* ---------------- utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const stamp = () => new Date().toISOString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);

function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const todayStr = () => toDateStr(new Date());
const thisMonth = () => todayStr().slice(0, 7);
function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  y = Math.floor(idx / 12); m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function monthsBetween(a, b) { const out = []; let c = a; while (c <= b && out.length < 1200) { out.push(c); c = addMonths(c, 1); } return out; }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function endOfMonth(ym) { return `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`; }
function daysBetween(a, b) { return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000); }
function addDays(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return toDateStr(d); }
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(ym, long = false) {
  const [y, m] = ym.split('-').map(Number);
  return long ? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}
function fmtDate(s, withYear = true) {
  if (!s) return '';
  const d = parseDateStr(s);
  return d.toLocaleDateString('en-GB', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
function relTime(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------------- icons (Lucide-style, inline) ---------------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudOff: '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  transfer: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  scale: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="m5 7-3 7a4 4 0 0 0 6 0Z"/><path d="m19 7-3 7a4 4 0 0 0 6 0Z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
};
function icon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

/* ---------------- currency ---------------- */
const CURRENCIES = {
  IDR: { symbol: 'Rp', decimals: 0, locale: 'id-ID', name: 'Indonesian Rupiah' },
  JPY: { symbol: '¥', decimals: 0, locale: 'ja-JP', name: 'Japanese Yen' },
  USD: { symbol: '$', decimals: 2, locale: 'en-US', name: 'US Dollar' },
  SGD: { symbol: 'S$', decimals: 2, locale: 'en-SG', name: 'Singapore Dollar' },
};
const CUR_CODES = Object.keys(CURRENCIES);

function fmt(amount, cur = 'IDR', opts = {}) {
  const c = CURRENCIES[cur] || { symbol: cur, decimals: 2, locale: 'en-US' };
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : (opts.sign && n > 0 ? '+' : '');
  const abs = Math.abs(n);
  if (opts.compact && cur === 'IDR' && abs >= 1e6) {
    let v, suf;
    if (abs >= 1e12) { v = abs / 1e12; suf = ' T'; } else if (abs >= 1e9) { v = abs / 1e9; suf = ' M'; } else { v = abs / 1e6; suf = ' jt'; }
    return `${sign}Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: v < 10 ? 2 : 1 }).format(v)}${suf}`;
  }
  if (opts.compact && cur === 'IDR' && abs >= 1e3 && opts.compact === 'tiny') {
    return `${sign}Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(abs / 1e3)}rb`;
  }
  const s = new Intl.NumberFormat(c.locale, { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals }).format(abs);
  return `${sign}${c.symbol}${cur === 'IDR' ? ' ' : ''}${s}`;
}
const money = (n, o) => fmt(n, 'IDR', o);
const pct = (v, d = 0) => (isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');

/** Parse "50.000", "Rp 1.250.000", "12.50", "1,5jt", "75k", "(20,000)" etc. */
function parseAmount(input, style = 'auto') {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/idr|rp\.?|usd|sgd|jpy|s\$|us\$|\$|¥|￥|yen|\s| /g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  let mult = 1;
  const m = s.match(/(ribu|rb|k|juta|jt)$/);
  if (m) { mult = { k: 1e3, rb: 1e3, ribu: 1e3, jt: 1e6, juta: 1e6 }[m[1]]; s = s.slice(0, -m[1].length); }
  let num;
  if (style === 'id') num = s.replace(/\./g, '').replace(',', '.');
  else if (style === 'us') num = s.replace(/,/g, '');
  else {
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) num = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (hasDot) num = /^\d{1,3}(\.\d{3})+$/.test(s) && mult === 1 ? s.replace(/\./g, '') : s;
    else if (hasComma) num = /^\d{1,3}(,\d{3})+$/.test(s) && mult === 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    else num = s;
  }
  if (!/^\d*\.?\d+$/.test(num)) return NaN;
  const v = parseFloat(num);
  return isFinite(v) ? (neg ? -1 : 1) * v * mult : NaN;
}
function fmtInput(n, cur = 'IDR') {
  if (n === '' || n == null || !isFinite(n)) return '';
  const c = CURRENCIES[cur] || { decimals: 2 };
  return new Intl.NumberFormat(cur === 'IDR' ? 'id-ID' : 'en-US', { maximumFractionDigits: c.decimals, useGrouping: true }).format(n);
}

/* ---------------- defaults ---------------- */
const PERSON_IDS = ['junior', 'sabit', 'shared'];
const GROUPS = ['Needs', 'Wants', 'Savings'];
const GROUP_COLORS = { Needs: '#0ea5e9', Wants: '#f97316', Savings: '#10b981', Income: '#22c55e' };
const ACCOUNT_TYPES = { bank: 'Bank', ewallet: 'E-wallet', cash: 'Cash', credit: 'Credit card', savings: 'Savings', investment: 'Investment', other: 'Other' };

const DEFAULT_CATEGORIES = [
  ['Groceries', 'expense', 'Needs', '#16a34a'],
  ['Dining & Coffee', 'expense', 'Wants', '#f97316'],
  ['Food Delivery', 'expense', 'Wants', '#fb923c'],
  ['Transport', 'expense', 'Needs', '#0ea5e9'],
  ['Housing & Rent', 'expense', 'Needs', '#6366f1'],
  ['Utilities & Bills', 'expense', 'Needs', '#14b8a6'],
  ['Phone & Internet', 'expense', 'Needs', '#06b6d4'],
  ['Health', 'expense', 'Needs', '#ef4444'],
  ['Insurance', 'expense', 'Needs', '#64748b'],
  ['Family', 'expense', 'Needs', '#84cc16'],
  ['Debt & Installments', 'expense', 'Needs', '#78716c'],
  ['Shopping', 'expense', 'Wants', '#ec4899'],
  ['Personal Care', 'expense', 'Wants', '#f43f5e'],
  ['Entertainment', 'expense', 'Wants', '#a855f7'],
  ['Subscriptions', 'expense', 'Wants', '#8b5cf6'],
  ['Travel', 'expense', 'Wants', '#eab308'],
  ['Gifts & Donations', 'expense', 'Wants', '#d946ef'],
  ['Savings & Investment', 'expense', 'Savings', '#10b981'],
  ['Other', 'expense', 'Wants', '#94a3b8'],
  ['Salary', 'income', 'Income', '#22c55e'],
  ['Bonus', 'income', 'Income', '#65a30d'],
  ['Side Income', 'income', 'Income', '#0891b2'],
  ['Other Income', 'income', 'Income', '#94a3b8'],
];

function defaultData() {
  const t = stamp();
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    schema: 1,
    settings: {
      updatedAt: '1970-01-01T00:00:00.000Z', // so any edited remote settings win on first merge
      persons: {
        junior: { name: 'Junior', color: '#2563eb' },
        sabit: { name: 'Sabit', color: '#db2777' },
        shared: { name: 'Shared', color: '#7c3aed' },
      },
      baseCurrency: 'IDR',
      rates: { IDR: 1, JPY: 114.6, USD: 17977, SGD: 14070 },
      ratesDate: '2026-09-28',
    },
    categories: DEFAULT_CATEGORIES.map(([name, type, group, color], i) => ({
      id: `c_${slug(name)}`, name, type, group, color, order: i, updatedAt: '1970-01-01T00:00:00.000Z',
    })),
    accounts: [
      { id: 'a_junior-bank', name: "Junior's Bank", type: 'bank', owner: 'junior', currency: 'IDR', opening: 0, openingDate: '', updatedAt: '1970-01-01T00:00:00.000Z' },
      { id: 'a_sabit-bank', name: "Sabit's Bank", type: 'bank', owner: 'sabit', currency: 'IDR', opening: 0, openingDate: '', updatedAt: '1970-01-01T00:00:00.000Z' },
      { id: 'a_cash', name: 'Cash', type: 'cash', owner: 'shared', currency: 'IDR', opening: 0, openingDate: '', updatedAt: '1970-01-01T00:00:00.000Z' },
    ],
    transactions: [],
    budgets: [],
    goals: [],
    contributions: [],
    createdAt: t,
  };
}
const COLLECTIONS = ['categories', 'accounts', 'transactions', 'budgets', 'goals', 'contributions'];

function normalizeData(d) {
  const base = defaultData();
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...d };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  out.settings.persons = { ...base.settings.persons, ...((d.settings || {}).persons || {}) };
  out.settings.rates = { ...base.settings.rates, ...((d.settings || {}).rates || {}) };
  for (const c of COLLECTIONS) out[c] = Array.isArray(d[c]) ? d[c] : base[c];
  return out;
}

/** Merge two datasets record-by-record: newest `updatedAt` wins; deletions are tombstones. */
function mergeData(a, b) {
  if (!a) return normalizeData(b);
  if (!b) return normalizeData(a);
  const out = { schema: 1, createdAt: a.createdAt || b.createdAt };
  out.settings = (a.settings?.updatedAt || '') >= (b.settings?.updatedAt || '') ? a.settings : b.settings;
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const r of a[c] || []) map.set(r.id, r);
    for (const r of b[c] || []) {
      const e = map.get(r.id);
      if (!e || (r.updatedAt || '') > (e.updatedAt || '')) map.set(r.id, r);
    }
    out[c] = [...map.values()];
  }
  return normalizeData(out);
}

/* ---------------- device config & UI state ---------------- */
const cfg = Object.assign({ me: null, theme: 'auto', github: {} }, lsGet(LS.cfg, {}));
function saveCfg() { lsSet(LS.cfg, cfg); }
function me() { return cfg.me || 'junior'; }

const ui = Object.assign({
  page: 'dashboard',
  filter: { preset: 'thisMonth', from: null, to: null, person: 'all', cats: [] },
  tx: { q: '', type: 'all', account: 'all', sort: 'date', dir: -1, limit: 100 },
  budgetMonth: null,
}, lsGet(LS.ui, {}));
ui.filter = Object.assign({ preset: 'thisMonth', from: null, to: null, person: 'all', cats: [] }, ui.filter);
ui.tx = Object.assign({ q: '', type: 'all', account: 'all', sort: 'date', dir: -1, limit: 100 }, ui.tx);
function saveUI() { lsSet(LS.ui, { page: ui.page, filter: ui.filter, tx: { ...ui.tx, q: '' }, budgetMonth: ui.budgetMonth }); }

/* ---------------- store ---------------- */
const store = {
  data: null,
  version: 0,
  _batch: 0,
  _pending: false,
  load() { this.data = normalizeData(lsGet(LS.data, null)); this.version++; },
  persist() {
    if (!lsSet(LS.data, this.data)) toast('Could not save to this browser (storage full or blocked).', 'bad');
  },
  replace(data) { this.data = normalizeData(data); this.version++; this.persist(); },
  all(c) { return this.data[c].filter((r) => !r.deleted); },
  get(c, id) { return id ? this.data[c].find((r) => r.id === id && !r.deleted) : undefined; },
  upsert(c, rec) {
    rec = { ...rec, updatedAt: stamp(), updatedBy: me() };
    const i = this.data[c].findIndex((r) => r.id === rec.id);
    if (i >= 0) this.data[c][i] = { ...this.data[c][i], ...rec, deleted: undefined };
    else { rec.createdBy = rec.createdBy || me(); this.data[c].push(rec); }
    this.changed();
    return rec;
  },
  remove(c, id) {
    const i = this.data[c].findIndex((r) => r.id === id);
    if (i >= 0) this.data[c][i] = { id, deleted: true, updatedAt: stamp(), updatedBy: me() };
    this.changed();
  },
  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch, updatedAt: stamp() };
    this.changed();
  },
  batch(fn) {
    this._batch++;
    try { fn(); } finally {
      this._batch--;
      if (!this._batch && this._pending) { this._pending = false; this.changed(); }
    }
  },
  changed() {
    if (this._batch) { this._pending = true; return; }
    this.version++;
    this.persist();
    if (typeof sync !== 'undefined') sync.markDirty();
    if (typeof App !== 'undefined') App.render();
  },
  // memoized lookups
  _memo: {},
  memo(key, fn) {
    const m = this._memo[key];
    if (m && m.v === this.version) return m.val;
    const val = fn();
    this._memo[key] = { v: this.version, val };
    return val;
  },
  catMap() { return this.memo('catMap', () => new Map(this.all('categories').map((c) => [c.id, c]))); },
  accMap() { return this.memo('accMap', () => new Map(this.all('accounts').map((a) => [a.id, a]))); },
  activeTx() { return this.memo('tx', () => this.all('transactions')); },
  categories(type) {
    return this.all('categories').filter((c) => !type || c.type === type)
      .sort((a, b) => (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  },
};

const persons = () => store.data.settings.persons;
const pname = (id) => (persons()[id] || {}).name || id || '–';
const pcolor = (id) => (persons()[id] || {}).color || '#94a3b8';
function personChip(id) { return `<span class="chip" style="background:${pcolor(id)}22;color:${pcolor(id)}">${esc(pname(id))}</span>`; }
function catChip(catId) {
  const c = store.catMap().get(catId);
  if (!c) return '<span class="chip">Uncategorized</span>';
  return `<span class="chip"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>`;
}
const rateOf = (cur) => (cur === 'IDR' || !cur ? 1 : Number(store.data.settings.rates[cur]) || 1);

/* ---------------- calculations ---------------- */
function txBase(t) {
  const a = Number(t.amount) || 0;
  if (!t.currency || t.currency === 'IDR') return a;
  return Math.round(a * (Number(t.rate) || rateOf(t.currency)));
}
function convert(amount, from, to, rate) {
  amount = Number(amount) || 0;
  if (from === to) return amount;
  const idr = from === 'IDR' ? amount : amount * (Number(rate) || rateOf(from));
  return to === 'IDR' ? idr : idr / rateOf(to);
}
const catOf = (t) => store.catMap().get(t.categoryId);
const groupOf = (t) => (catOf(t) || {}).group || (t.type === 'income' ? 'Income' : 'Wants');

const PRESETS = [
  ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last30', 'Last 30 days'], ['last3m', 'Last 3 months'],
  ['last6m', 'Last 6 months'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['all', 'All time'], ['custom', 'Custom range'],
];
function presetRange(p) {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const d = (yy, mm, dd) => toDateStr(new Date(yy, mm, dd));
  switch (p) {
    case 'lastMonth': return { from: d(y, m - 1, 1), to: d(y, m, 0) };
    case 'last30': return { from: d(y, m, now.getDate() - 29), to: toDateStr(now) };
    case 'last3m': return { from: d(y, m - 2, 1), to: d(y, m + 1, 0) };
    case 'last6m': return { from: d(y, m - 5, 1), to: d(y, m + 1, 0) };
    case 'thisYear': return { from: d(y, 0, 1), to: d(y, 11, 31) };
    case 'lastYear': return { from: d(y - 1, 0, 1), to: d(y - 1, 11, 31) };
    case 'all': {
      const ds = store.activeTx().map((t) => t.date).filter(Boolean).sort();
      const first = ds[0] ? ds[0].slice(0, 7) + '-01' : d(y, m, 1);
      const last = ds.length && ds[ds.length - 1] > d(y, m + 1, 0) ? ds[ds.length - 1] : d(y, m + 1, 0);
      return { from: first, to: last };
    }
    case 'thisMonth':
    default: return { from: d(y, m, 1), to: d(y, m + 1, 0) };
  }
}
function getFilter() {
  const f = ui.filter;
  let r = f.preset === 'custom' && f.from && f.to ? { from: f.from, to: f.to } : presetRange(f.preset);
  if (r.from > r.to) r = { from: r.to, to: r.from };
  return { ...r, person: f.person || 'all', cats: f.cats && f.cats.length ? new Set(f.cats) : null };
}
function filterLabel(f = getFilter()) {
  const preset = PRESETS.find((p) => p[0] === ui.filter.preset);
  const range = ui.filter.preset === 'custom' || !preset ? `${fmtDate(f.from)} – ${fmtDate(f.to)}` : preset[1];
  const who = f.person === 'all' ? 'Everyone' : pname(f.person);
  const cats = f.cats ? `${f.cats.size} categor${f.cats.size === 1 ? 'y' : 'ies'}` : 'All categories';
  return `${range} · ${who} · ${cats}`;
}
function txMatches(t, f, { ignoreDate = false, ignorePerson = false, ignoreCats = false } = {}) {
  if (t.deleted) return false;
  if (!ignoreDate && (t.date < f.from || t.date > f.to)) return false;
  if (!ignorePerson && f.person !== 'all' && t.person !== f.person) return false;
  if (!ignoreCats && f.cats) {
    if (t.type !== 'expense' && t.type !== 'income') return false;
    if (!f.cats.has(t.categoryId)) return false;
  }
  return true;
}
function filteredTx(f = getFilter(), opts) { return store.activeTx().filter((t) => txMatches(t, f, opts)); }

function summarize(txs) {
  const r = { income: 0, spend: 0, saved: 0, outflow: 0, count: txs.length, byCat: {}, byPerson: { junior: 0, sabit: 0, shared: 0 }, byGroup: { Needs: 0, Wants: 0, Savings: 0 } };
  for (const t of txs) {
    const v = txBase(t);
    if (t.type === 'income') r.income += v;
    else if (t.type === 'expense') {
      const g = groupOf(t);
      r.outflow += v;
      if (g === 'Savings') r.saved += v; else r.spend += v;
      r.byCat[t.categoryId] = (r.byCat[t.categoryId] || 0) + v;
      r.byPerson[t.person] = (r.byPerson[t.person] || 0) + v;
      r.byGroup[g] = (r.byGroup[g] || 0) + v;
    }
  }
  r.net = r.income - r.outflow;
  return r;
}

/* Budgets: stored per month × category × person. A month without its own
 * budget rows inherits the most recent earlier month (rolling budget). */
function budgetMonths() { return store.memo('bMonths', () => [...new Set(store.all('budgets').map((b) => b.month))].sort()); }
function budgetSource(ym) { let src = null; for (const m of budgetMonths()) { if (m <= ym) src = m; else break; } return src; }
function budgetsFor(ym) {
  return store.memo('bFor:' + ym, () => {
    const src = budgetSource(ym);
    return { src, inherited: !!src && src !== ym, list: src ? store.all('budgets').filter((b) => b.month === src) : [] };
  });
}
const budgetId = (ym, catId, person) => `b_${ym}_${catId}_${person}`;
function budgetCell(ym, catId, person) {
  const { list } = budgetsFor(ym);
  return sum(list.filter((b) => b.categoryId === catId && (person === 'all' || b.person === person)), (b) => b.amount);
}
/** Prorated budget for an arbitrary date range. */
function budgetForRange(f, type = 'expense') {
  const res = { total: 0, perCat: {} };
  for (const ym of monthsBetween(f.from.slice(0, 7), f.to.slice(0, 7))) {
    const som = `${ym}-01`, eom = endOfMonth(ym);
    const a = f.from > som ? f.from : som, b = f.to < eom ? f.to : eom;
    const frac = (daysBetween(a, b) + 1) / daysInMonth(ym);
    if (frac <= 0) continue;
    for (const bud of budgetsFor(ym).list) {
      const c = store.catMap().get(bud.categoryId);
      if (!c || c.type !== type) continue;
      if (f.person !== 'all' && bud.person !== f.person) continue;
      if (f.cats && !f.cats.has(bud.categoryId)) continue;
      const v = (Number(bud.amount) || 0) * frac;
      res.total += v;
      res.perCat[bud.categoryId] = (res.perCat[bud.categoryId] || 0) + v;
    }
  }
  return res;
}

/* Accounts */
function accountBalance(acc, asOf = todayStr()) {
  let bal = Number(acc.opening) || 0;
  const start = acc.openingDate || '0000-00-00';
  for (const t of store.activeTx()) {
    if (t.date < start || t.date > asOf) continue;
    if (t.accountId === acc.id) {
      const v = convert(t.amount, t.currency || 'IDR', acc.currency, t.rate);
      if (t.type === 'income' || t.type === 'adjustment') bal += v;
      else if (t.type === 'expense' || t.type === 'transfer') bal -= v;
    }
    if (t.type === 'transfer' && t.toAccountId === acc.id) {
      bal += t.toAmount !== undefined && t.toAmount !== null && t.toAmount !== '' ? Number(t.toAmount) : convert(t.amount, t.currency || 'IDR', acc.currency, t.rate);
    }
  }
  return bal;
}
const accountBalanceIDR = (acc, asOf) => convert(accountBalance(acc, asOf), acc.currency, 'IDR');

/* Goals */
function goalSaved(g, asOf = todayStr()) {
  if (g.accountId) {
    const a = store.get('accounts', g.accountId);
    if (a) return accountBalanceIDR(a, asOf);
  }
  const contrib = sum(store.all('contributions').filter((c) => c.goalId === g.id && c.date <= asOf), (c) => c.amount);
  const fromTx = sum(store.activeTx().filter((t) => t.goalId === g.id && t.date <= asOf && t.type === 'expense'), txBase);
  return contrib + fromTx;
}
function goalSavedBetween(g, from, to) {
  if (g.accountId) {
    const a = store.get('accounts', g.accountId);
    if (a) return accountBalanceIDR(a, to) - accountBalanceIDR(a, addDays(from, -1));
  }
  const contrib = sum(store.all('contributions').filter((c) => c.goalId === g.id && c.date >= from && c.date <= to), (c) => c.amount);
  const fromTx = sum(store.activeTx().filter((t) => t.goalId === g.id && t.type === 'expense' && t.date >= from && t.date <= to), txBase);
  return contrib + fromTx;
}

/* ---------------- toast & modal helpers ---------------- */
function toast(msg, kind = '', action) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3200);
}

const Modal = {
  stack: [],
  open(html, { wide = false, onMount, onClose } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('mousedown', (e) => { if (e.target === back) back._downOnBack = true; });
    back.addEventListener('mouseup', (e) => { if (e.target === back && back._downOnBack) Modal.close(); back._downOnBack = false; });
    back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) Modal.close(); });
    $('#modal-root').appendChild(back);
    this.stack.push({ el: back, onClose });
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(back.querySelector('.modal'));
    const first = back.querySelector('[autofocus]') || back.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first && window.matchMedia('(min-width: 861px)').matches) setTimeout(() => first.focus(), 30);
    return back.querySelector('.modal');
  },
  close() {
    const m = this.stack.pop();
    if (!m) return;
    m.el.remove();
    if (!this.stack.length) document.body.style.overflow = '';
    if (m.onClose) m.onClose();
    if (!this.stack.length && typeof App !== 'undefined' && App._deferred) App.render();
  },
  isOpen() { return this.stack.length > 0; },
  head(title, sub = '') {
    return `<div class="modal-head"><div><h3>${title}</h3>${sub ? `<div class="small muted">${sub}</div>` : ''}</div><button class="btn ghost icon x" data-close aria-label="Close">${icon('x')}</button></div>`;
  },
};
function confirmBox(title, message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = Modal.open(`${Modal.head(esc(title))}<div class="modal-body">${message}</div>
      <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, {
      onClose: () => { if (!answered) resolve(false); },
    });
    m.querySelector('[data-ok]').onclick = () => { answered = true; Modal.close(); resolve(true); };
  });
}

/* ---------------- file helpers ---------------- */
function downloadFile(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function toCSV(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); }
