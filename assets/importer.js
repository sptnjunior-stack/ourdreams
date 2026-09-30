'use strict';
/* =====================================================================
 * importer.js — import spending history from Google Sheets / CSV / TSV
 * Steps: 1) paste or upload  2) map columns  3) map values  4) review
 * ===================================================================== */

/* ---------- parsing ---------- */
function parseDelimited(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = (text.match(/^[^\r\n]*/) || [''])[0];
  const counts = { '\t': (firstLine.match(/\t/g) || []).length, ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length };
  let delim = ',';
  if (counts['\t'] >= counts[','] && counts['\t'] >= counts[';'] && counts['\t'] > 0) delim = '\t';
  else if (counts[';'] > counts[',']) delim = ';';
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { delim, rows: rows.filter((r) => r.some((c) => String(c).trim() !== '')) };
}

const MONTH_WORDS = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, peb: 2, mar: 3, march: 3, maret: 3, apr: 4, april: 4,
  may: 5, mei: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, agu: 8, agt: 8, ags: 8, agustus: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, nop: 11, nopember: 11,
  dec: 12, december: 12, des: 12, desember: 12,
};
function mkDate(y, m, d) {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= new Date(y, m, 0).getDate()) || y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function cleanDateStr(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)[a-z]*,?\s+/i, '');
  s = s.replace(/[T\s]+\d{1,2}[:.]\d{2}([:.]\d{2})?(\.\d+)?(\s*[ap]\.?m\.?)?(\s*(z|[+-]\d{2}:?\d{2}|wib|wita|wit))?$/i, '');
  return s.trim();
}
function detectDateFormat(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = cleanDateStr(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}
function parseDateAny(raw, fmt = 'dmy') {
  const s = cleanDateStr(raw);
  if (!s) return null;
  let m;
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Google Sheets / Excel serial number
    const n = Math.floor(parseFloat(s));
    if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return mkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    return fmt === 'mdy' ? mkDate(+m[3], +m[1], +m[2]) : mkDate(+m[3], +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})[\s\-/.]+([a-z]+)\.?[\s\-/.,]+(\d{2,4})$/i))) {
    const mon = MONTH_WORDS[m[2].toLowerCase()];
    if (mon) return mkDate(+m[3], mon, +m[1]);
  }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(st|nd|rd|th)?,?\s+(\d{4})$/i))) {
    const mon = MONTH_WORDS[m[1].toLowerCase()];
    if (mon) return mkDate(+m[4], mon, +m[2]);
  }
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) return mkDate(+m[1], +m[2], 1);
  return null;
}

/* ---------- smart matching ---------- */
const DESC_KEYWORDS = [
  [/(gofood|grabfood|shopeefood|go-food|grab food|food delivery)/i, 'Food Delivery'],
  [/(hotel|airbnb|traveloka|tiket\.com|flight|pesawat|garuda|airasia|agoda|booking\.com|\btrip\b|citilink|lion air|jal\b|ana\b|shinkansen|jr pass)/i, 'Travel'],
  [/(indomaret|alfamart|alfamidi|superindo|hypermart|ranch market|grand lucky|lotte mart|transmart|grocer|sayur|pasar|belanja bulanan|supermarket|\bhero\b|aeon|don quijote|seven.?eleven|7-eleven|lawson|family ?mart|fairprice|sembako)/i, 'Groceries'],
  [/(starbucks|kopi|coffee|cafe|caf[eé]|resto|restaurant|makan|lunch|dinner|breakfast|sarapan|mcd|mcdonald|kfc|bakso|sate|warung|janji jiwa|chatime|ramen|sushi|bakmi|nasi|jajan|snack|boba|dining)/i, 'Dining & Coffee'],
  [/(gojek|goride|gocar|\bgrab\b|grabcar|grabbike|bluebird|taxi|taksi|\bmrt\b|\bkrl\b|\blrt\b|transjakarta|busway|bensin|pertamina|\bshell\b|parkir|parking|\btol\b|\btoll\b|train|kereta|\bbus\b|fuel|suica|pasmo|e-?toll|flazz|ojek|ojol|transport)/i, 'Transport'],
  [/(\bpln\b|listrik|pdam|\bair\b|\bgas\b|\bipl\b|electricity|water bill|tagihan|iuran)/i, 'Utilities & Bills'],
  [/(pulsa|paket data|indihome|biznet|first media|myrepublic|telkomsel|\bxl\b|indosat|smartfren|internet|wifi|phone bill)/i, 'Phone & Internet'],
  [/(netflix|spotify|youtube|disney|icloud|google one|chatgpt|claude|subscription|langganan|apple music|vidio|prime video|\bhbo\b)/i, 'Subscriptions'],
  [/(apotek|obat|dokter|doctor|hospital|rumah sakit|klinik|clinic|pharmacy|halodoc|alodokter|vitamin|kesehatan|medical|dentist|gigi)/i, 'Health'],
  [/(tokopedia|shopee|lazada|blibli|zalora|uniqlo|zara|h&m|ikea|shopping|belanja|baju|sepatu|shoes|clothes)/i, 'Shopping'],
  [/(cinema|bioskop|\bxxi\b|\bcgv\b|movie|film|\bgame|steam|concert|konser|karaoke|hiburan|entertainment)/i, 'Entertainment'],
  [/(sewa|\bkos\b|\bkost\b|\brent\b|apartemen|apartment|\bkpr\b|mortgage|rumah|housing)/i, 'Housing & Rent'],
  [/(salon|barber|haircut|potong rambut|skincare|\bspa\b|laundry|perawatan|personal care)/i, 'Personal Care'],
  [/(asuransi|insurance|bpjs|prudential|allianz|\baxa\b)/i, 'Insurance'],
  [/(cicilan|installment|kartu kredit|credit card|paylater|pinjaman|loan|hutang|utang|kredivo|akulaku)/i, 'Debt & Installments'],
  [/(zakat|sedekah|infaq|donasi|donation|\bgift|kado|hadiah|angpao|kondangan|amplop)/i, 'Gifts & Donations'],
  [/(orang ?tua|mama|papa|ibu|bapak|keluarga|family|adik|kakak|parents)/i, 'Family'],
  [/(tabungan|saving|investasi|investment|reksadana|reksa dana|bibit|ajaib|saham|stock|deposito|\bemas\b|\bgold\b|crypto)/i, 'Savings & Investment'],
  [/(gaji|salary|payroll|upah)/i, 'Salary'],
  [/(bonus|\bthr\b)/i, 'Bonus'],
  [/(freelance|side|sampingan|project|proyek|dividen|dividend|cashback|refund|interest|bunga)/i, 'Other Income'],
];
function guessCategoryName(text) {
  const s = String(text || '');
  for (const [re, name] of DESC_KEYWORDS) if (re.test(s)) return name;
  return null;
}
function findCategoryByName(name, type) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const cats = store.categories(type);
  return cats.find((c) => c.name.toLowerCase() === n)
    || cats.find((c) => c.name.toLowerCase().replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, ''))
    || cats.find((c) => n.length >= 4 && (c.name.toLowerCase().startsWith(n) || n.startsWith(c.name.toLowerCase().split(/[ &]/)[0])))
    || null;
}
/** Suggest a category for a description: history first, then keywords. */
function suggestCategory(desc, type = 'expense') {
  const d = String(desc || '').trim().toLowerCase();
  if (!d) return null;
  const hist = store.activeTx().filter((t) => t.type === type && (t.description || '').trim().toLowerCase() === d && t.categoryId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (hist[0] && store.catMap().get(hist[0].categoryId)) return hist[0].categoryId;
  const g = guessCategoryName(d);
  const c = g && findCategoryByName(g, type);
  return c ? c.id : null;
}
function guessPerson(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const P = persons();
  for (const id of ['junior', 'sabit']) {
    const nm = (P[id].name || id).toLowerCase();
    if (s === nm || s === id || (s.length >= 2 && (nm.startsWith(s) || s.startsWith(nm.slice(0, 3)))) || (s.length === 1 && nm[0] === s)) return id;
  }
  if (/(both|shared|bersama|berdua|joint|\bkita\b|\bwe\b|\bus\b|together|household|rumah|couple|keluarga|family|all|semua|\+|&|\band\b|\bdan\b)/.test(s)) return 'shared';
  if (s === (P.shared.name || '').toLowerCase()) return 'shared';
  return null;
}
function guessType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (/(income|pemasukan|masuk|\bin\b|credit|kredit|\bcr\b|gaji|salary|receive|terima|refund|\+)/.test(s)) return 'income';
  if (/(transfer|pindah|tf\b)/.test(s)) return 'transfer';
  if (/(expense|pengeluaran|keluar|\bout\b|debit|\bdb\b|\bdr\b|spend|belanja|bayar|pay|-)/.test(s)) return 'expense';
  return null;
}
function guessCurrency(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return null;
  if (/IDR|RP|RUPIAH/.test(s)) return 'IDR';
  if (/JPY|YEN|¥|￥/.test(s)) return 'JPY';
  if (/SGD|S\$/.test(s)) return 'SGD';
  if (/USD|US\$|^\$$|DOLLAR/.test(s)) return 'USD';
  return null;
}
function detectCurrencyInAmount(v) {
  const s = String(v || '');
  if (/S\$|SGD/i.test(s)) return 'SGD';
  if (/¥|￥|JPY|yen/i.test(s)) return 'JPY';
  if (/US\$|USD|^\s*\$/i.test(s)) return 'USD';
  if (/Rp|IDR/i.test(s)) return 'IDR';
  return null;
}

/* ---------- import fields ---------- */
const IMPORT_FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount', required: true, hint: 'Expense amount, or a signed amount' },
  { key: 'income', label: 'Income amount', hint: 'Only if income sits in its own column' },
  { key: 'category', label: 'Category' },
  { key: 'person', label: 'Person (who)' },
  { key: 'type', label: 'Type (expense / income)' },
  { key: 'currency', label: 'Currency' },
  { key: 'account', label: 'Account / payment method' },
  { key: 'notes', label: 'Notes' },
];
const GUESS_ORDER = [
  ['date', /^(date|tanggal|tgl|transaction date|tanggal transaksi|waktu|day|hari|when|timestamp)\b/i],
  ['type', /^(type|jenis|tipe|kind|in\/out|in-out|flow|jenis transaksi)$/i],
  ['currency', /(currency|mata uang|^curr$|^ccy$|^cur$)/i],
  ['category', /(categor|kategori|^group$|^pos$)/i],
  ['person', /(person|^who|by$|^by|oleh|paid|payer|siapa|^user$|owner|^pic$|spender|pemakai|yang bayar)/i],
  ['account', /(account|akun|rekening|^bank|wallet|payment|metode|method|^source|sumber|card|kartu|pay with|dompet)/i],
  ['notes', /(note|catatan|remark|comment|komentar)/i],
  ['income', /^(income|pemasukan|credit|kredit|masuk|in|cr)$/i],
  ['amount', /(amount|nominal|jumlah|total|harga|price|cost|expense|pengeluaran|debit|spent|^idr|^rp|biaya|nilai|value|keluar|out)/i],
  ['description', /(desc|description|item|keterangan|detail|merchant|name|nama|transaksi|memo|what|barang|untuk|for|purpose|title|judul)/i],
];

const Importer = {
  s: null,
  open() {
    this.s = {
      step: 1, source: 'paste', text: '', rows: [], hasHeader: true, map: {},
      opts: { dateFormat: 'auto', numberStyle: 'auto', defaultPerson: me(), signMode: 'allExpense', defaultCurrency: 'IDR', defaultAccount: '', defaultCategory: '', skipDupes: true },
      values: { category: {}, person: {}, account: {}, type: {} },
    };
    Modal.open('<div id="imp"></div>', { wide: true });
    this.render();
  },
  headers() {
    const s = this.s;
    const width = Math.max(...s.rows.slice(0, 50).map((r) => r.length), 0);
    const hdr = s.hasHeader && s.rows[0] ? s.rows[0] : [];
    return Array.from({ length: width }, (_, i) => (String(hdr[i] || '').trim() || `Column ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`));
  },
  dataRows() { return this.s.hasHeader ? this.s.rows.slice(1) : this.s.rows; },
  col(row, key) { const i = this.s.map[key]; return i === undefined || i === '' || i === null ? '' : String(row[+i] ?? '').trim(); },
  autoMap() {
    const hs = this.headers(); const map = {}; const used = new Set();
    for (const [key, re] of GUESS_ORDER) {
      const i = hs.findIndex((h, idx) => !used.has(idx) && re.test(h.trim()));
      if (i >= 0) { map[key] = String(i); used.add(i); }
    }
    // no header? guess from content
    if (map.date === undefined) {
      const rows = this.dataRows().slice(0, 20);
      for (let i = 0; i < hs.length; i++) {
        if (used.has(i)) continue;
        if (rows.filter((r) => parseDateAny(r[i])).length >= Math.max(1, rows.length * 0.6)) { map.date = String(i); used.add(i); break; }
      }
    }
    if (map.amount === undefined) {
      const rows = this.dataRows().slice(0, 20);
      for (let i = 0; i < hs.length; i++) {
        if (used.has(i)) continue;
        if (rows.filter((r) => isFinite(parseAmount(r[i])) && String(r[i]).trim()).length >= Math.max(1, rows.length * 0.6)) { map.amount = String(i); used.add(i); break; }
      }
    }
    if (map.description === undefined) {
      const i = hs.findIndex((_, idx) => !used.has(idx));
      if (i >= 0 && this.dataRows().slice(0, 10).some((r) => /[a-z]/i.test(r[i] || ''))) map.description = String(i);
    }
    this.s.map = map;
  },
  prepareValues() {
    const s = this.s; const rows = this.dataRows();
    const uniq = (key) => [...new Set(rows.map((r) => this.col(r, key)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const keep = (key, vals, fn) => {
      const cur = s.values[key]; const out = {};
      for (const v of vals) out[v] = cur[v] !== undefined ? cur[v] : fn(v);
      s.values[key] = out;
    };
    keep('type', uniq('type'), (v) => guessType(v) || 'expense');
    keep('person', uniq('person'), (v) => guessPerson(v) || s.opts.defaultPerson);
    keep('account', uniq('account'), (v) => {
      const a = store.all('accounts').find((x) => x.name.toLowerCase() === v.toLowerCase());
      return a ? a.id : '__new__';
    });
    // majority type per category value
    const typeFor = {};
    for (const r of rows) {
      const cv = this.col(r, 'category'); if (!cv) continue;
      const t = this.rowType(r).type;
      typeFor[cv] = typeFor[cv] || { income: 0, expense: 0 };
      typeFor[cv][t === 'income' ? 'income' : 'expense']++;
    }
    keep('category', uniq('category'), (v) => {
      const t = typeFor[v] && typeFor[v].income > typeFor[v].expense ? 'income' : 'expense';
      const any = (name) => (t === 'income' ? findCategoryByName(name, 'income') : findCategoryByName(name, t) || findCategoryByName(name));
      const direct = any(v);
      if (direct) return direct.id;
      const g = guessCategoryName(v); const c = g && any(g);
      if (c) return c.id;
      if (t === 'income' && store.get('categories', 'c_other-income')) return 'c_other-income';
      return '__new__';
    });
    s.catTypes = typeFor;
  },
  rowType(r) {
    const s = this.s; const o = s.opts;
    const style = o.numberStyle;
    const amtRaw = this.col(r, 'amount'); const incRaw = this.col(r, 'income');
    const amt = amtRaw ? parseAmount(amtRaw, style) : NaN;
    const inc = incRaw ? parseAmount(incRaw, style) : NaN;
    if (s.map.income !== undefined && s.map.income !== '' && isFinite(inc) && inc !== 0 && (!isFinite(amt) || amt === 0)) return { type: 'income', amount: Math.abs(inc), raw: incRaw };
    if (s.map.type !== undefined && s.map.type !== '') {
      const tv = this.col(r, 'type');
      const t = (tv && s.values.type[tv]) || guessType(tv) || 'expense';
      return { type: t, amount: Math.abs(amt), raw: amtRaw };
    }
    if (o.signMode === 'negIsExpense') return { type: amt < 0 ? 'expense' : 'income', amount: Math.abs(amt), raw: amtRaw };
    if (o.signMode === 'negIsIncome') return { type: amt < 0 ? 'income' : 'expense', amount: Math.abs(amt), raw: amtRaw };
    return { type: 'expense', amount: amt, raw: amtRaw }; // negative stays negative = refund
  },
  build() {
    const s = this.s; const o = s.opts; const rows = this.dataRows();
    const dateFmt = o.dateFormat === 'auto' ? detectDateFormat(rows.map((r) => this.col(r, 'date'))) : o.dateFormat;
    s.detectedDateFmt = dateFmt;
    const existing = new Set(store.activeTx().map((t) => `${t.date}|${Math.round(txBase(t))}|${(t.description || '').trim().toLowerCase()}`));
    const seen = new Map();
    const out = [];
    rows.forEach((r, idx) => {
      const errs = [];
      const date = parseDateAny(this.col(r, 'date'), dateFmt);
      if (!date) errs.push(`bad date "${this.col(r, 'date')}"`);
      const { type, amount, raw } = this.rowType(r);
      if (!isFinite(amount) || amount === 0) errs.push(raw ? `bad amount "${raw}"` : 'no amount');
      const curRaw = this.col(r, 'currency');
      const currency = guessCurrency(curRaw) || detectCurrencyInAmount(raw) || o.defaultCurrency;
      const description = this.col(r, 'description');
      const catRaw = this.col(r, 'category');
      let categoryId = null;
      if (type !== 'transfer') {
        if (catRaw) categoryId = s.values.category[catRaw];
        else categoryId = suggestCategory(description, type) || o.defaultCategory || (type === 'income' ? 'c_other-income' : 'c_other');
      }
      const personRaw = this.col(r, 'person');
      const person = personRaw ? s.values.person[personRaw] || o.defaultPerson : o.defaultPerson;
      const accRaw = this.col(r, 'account');
      const accountId = accRaw ? s.values.account[accRaw] : o.defaultAccount;
      const rec = {
        _row: idx + (s.hasHeader ? 2 : 1), date, type: type === 'transfer' ? 'expense' : type, amount, currency,
        rate: currency === 'IDR' ? 1 : rateOf(currency), description, categoryId, catRaw, person, accountId: accountId || '', accRaw,
        notes: this.col(r, 'notes'), errs,
      };
      if (!errs.length) {
        const key = `${date}|${Math.round(txBase(rec))}|${description.toLowerCase()}`;
        rec.dupe = existing.has(key);
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      out.push(rec);
    });
    s.built = out;
    return out;
  },
  go(step) {
    const s = this.s;
    if (step === 2) {
      if (s.source === 'paste') s.text = ($('#imp-text') || {}).value || s.text;
      const parsed = parseDelimited(s.text);
      if (parsed.rows.length < 1) { toast('Nothing to import yet — paste your data or choose a file.', 'bad'); return; }
      const changed = parsed.rows.length !== s.rows.length || JSON.stringify(parsed.rows[0]) !== JSON.stringify(s.rows[0]);
      s.rows = parsed.rows; s.delim = parsed.delim;
      if (changed || !Object.keys(s.map).length) this.autoMap();
    }
    if (step === 3) {
      const has = (k) => s.map[k] !== undefined && s.map[k] !== '';
      if (!has('date') || (!has('amount') && !has('income'))) { toast('Please choose the Date and Amount columns.', 'bad'); return; }
      this.prepareValues();
      const hasValues = ['category', 'person', 'account', 'type'].some((k) => Object.keys(s.values[k]).length);
      if (!hasValues) step = 4;
    }
    if (step === 4) this.build();
    s.step = step;
    this.render();
  },
  render() {
    const s = this.s; const el = $('#imp'); if (!el) return;
    const steps = ['Paste / upload', 'Match columns', 'Match values', 'Review & import'];
    const stepsHTML = `<div class="steps">${steps.map((t, i) => `<span class="${s.step === i + 1 ? 'on' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
    let body = '', foot = '';
    if (s.step === 1) {
      body = `
        <div class="banner info">${icon('info')}<div class="grow small">
          <b>From Google Sheets:</b> select your whole table (including the header row), press <b>Ctrl/Cmd + C</b>, then paste below.
          Or use <b>File → Download → Comma-separated values (.csv)</b> and upload the file. Any column layout works — you'll match the columns next.
        </div></div>
        <div class="seg" style="margin-bottom:12px">
          <button class="${s.source === 'paste' ? 'on' : ''}" data-imp-src="paste">Paste from sheet</button>
          <button class="${s.source === 'file' ? 'on' : ''}" data-imp-src="file">Upload CSV / TSV</button>
        </div>
        ${s.source === 'paste'
    ? `<textarea id="imp-text" style="min-height:220px;font-family:ui-monospace,Menlo,monospace;font-size:12px" placeholder="Date\tDescription\tCategory\tAmount\tPerson\n01/08/2026\tIndomaret\tGroceries\t125.000\tJunior">${esc(s.text)}</textarea>`
    : `<input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values">
             <div class="hint" style="margin-top:8px">${s.text ? `Loaded ${s.text.split(/\n/).length} lines.` : 'Choose a .csv file exported from Google Sheets.'}</div>`}
        <div class="small muted" style="margin-top:10px">Need a starting point? <a href="#" data-imp-template>Download the import template</a> (open it in Google Sheets, fill in, re-import).</div>`;
      foot = `<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-imp-go="2">Next ${icon('right')}</button>`;
    }
    if (s.step === 2) {
      const hs = this.headers();
      const opt = (key) => `<select data-imp-map="${key}"><option value="">— not in my sheet —</option>${hs.map((h, i) => `<option value="${i}" ${String(s.map[key]) === String(i) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
      const o = s.opts;
      const sample = this.dataRows().slice(0, 5);
      body = `
        <label class="check" style="margin-bottom:12px"><input type="checkbox" data-imp-opt="hasHeader" ${s.hasHeader ? 'checked' : ''}> First row contains column names</label>
        <div class="map-grid">
          ${IMPORT_FIELDS.map((f) => `<label class="field">${f.label}${f.required ? ' *' : ''}${opt(f.key)}${f.hint ? `<span class="hint">${f.hint}</span>` : ''}</label>`).join('')}
        </div>
        <h4 style="margin:18px 0 8px">Options</h4>
        <div class="map-grid">
          <label class="field">Date format<select data-imp-opt="dateFormat">
            ${[['auto', 'Auto-detect'], ['dmy', 'Day/Month/Year (31/08/2026)'], ['mdy', 'Month/Day/Year (08/31/2026)']].map(([v, l]) => `<option value="${v}" ${o.dateFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Number format<select data-imp-opt="numberStyle">
            ${[['auto', 'Auto-detect'], ['id', 'Indonesian (1.250.000,50)'], ['us', 'English (1,250,000.50)']].map(([v, l]) => `<option value="${v}" ${o.numberStyle === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">If no Type column<select data-imp-opt="signMode">
            ${[['allExpense', 'All rows are spending (negative = refund)'], ['negIsExpense', 'Negative = spending, positive = income'], ['negIsIncome', 'Positive = spending, negative = income']].map(([v, l]) => `<option value="${v}" ${o.signMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Default person<select data-imp-opt="defaultPerson">
            ${PERSON_IDS.map((p) => `<option value="${p}" ${o.defaultPerson === p ? 'selected' : ''}>${esc(pname(p))}</option>`).join('')}</select><span class="hint">Used when the Person column is empty/missing</span></label>
          <label class="field">Default currency<select data-imp-opt="defaultCurrency">
            ${CUR_CODES.map((c) => `<option ${o.defaultCurrency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field">Default account<select data-imp-opt="defaultAccount"><option value="">— none —</option>
            ${store.all('accounts').map((a) => `<option value="${a.id}" ${o.defaultAccount === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        </div>
        <h4 style="margin:18px 0 8px">Your data (first rows)</h4>
        <div class="preview-table"><table class="t"><thead><tr>${hs.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${sample.map((r) => `<tr>${hs.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="hint" style="margin-top:6px">${this.dataRows().length} data rows found · separator: ${s.delim === '\t' ? 'tab' : s.delim}</div>`;
      foot = `<button class="btn" data-imp-go="1">${icon('left')} Back</button><span class="spacer"></span><button class="btn primary" data-imp-go="3">Next ${icon('right')}</button>`;
    }
    if (s.step === 3) {
      const v = s.values;
      const section = (title, key, optionsHTML, help) => {
        const entries = Object.keys(v[key]);
        if (!entries.length) return '';
        return `<h4 style="margin:4px 0 6px">${title}</h4><div class="hint" style="margin-bottom:8px">${help}</div>
          <div class="preview-table" style="max-height:260px;margin-bottom:18px"><table class="t"><thead><tr><th>In your sheet</th><th>Becomes</th></tr></thead><tbody>
          ${entries.map((val) => `<tr><td><b>${esc(val)}</b></td><td><select data-imp-val="${key}" data-val="${esc(val)}">${optionsHTML(v[key][val], val)}</select></td></tr>`).join('')}
          </tbody></table></div>`;
      };
      const catOpts = (sel, val) => {
        const t = s.catTypes[val] && s.catTypes[val].income > s.catTypes[val].expense ? 'income' : 'expense';
        return `<option value="__new__" ${sel === '__new__' ? 'selected' : ''}>+ Create new ${t} category "${esc(val)}"</option>
          <optgroup label="Spending">${store.categories('expense').map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
          <optgroup label="Income">${store.categories('income').map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
      };
      const perOpts = (sel) => PERSON_IDS.map((p) => `<option value="${p}" ${sel === p ? 'selected' : ''}>${esc(pname(p))}</option>`).join('');
      const accOpts = (sel, val) => `<option value="__new__" ${sel === '__new__' ? 'selected' : ''}>+ Create account "${esc(val)}"</option><option value="" ${sel === '' ? 'selected' : ''}>— no account —</option>
        ${store.all('accounts').map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
      const typeOpts = (sel) => [['expense', 'Spending'], ['income', 'Income']].map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');
      body = section('Categories', 'category', catOpts, 'Match each category from your sheet to one in the tracker, or create it.')
        + section('People', 'person', perOpts, `Who each value refers to. Use "${esc(pname('shared'))}" for joint spending.`)
        + section('Accounts / payment methods', 'account', accOpts, 'Used for the Current Balance page. You can set opening balances later.')
        + section('Types', 'type', typeOpts, 'Which values mean income vs. spending.');
      foot = `<button class="btn" data-imp-go="2">${icon('left')} Back</button><span class="spacer"></span><button class="btn primary" data-imp-go="4">Next ${icon('right')}</button>`;
    }
    if (s.step === 4) {
      const b = s.built || [];
      const ok = b.filter((r) => !r.errs.length);
      const bad = b.filter((r) => r.errs.length);
      const dupes = ok.filter((r) => r.dupe);
      const willImport = ok.filter((r) => !(s.opts.skipDupes && r.dupe));
      const dates = ok.map((r) => r.date).sort();
      const exp = sum(willImport.filter((r) => r.type === 'expense'), txBase), inc = sum(willImport.filter((r) => r.type === 'income'), txBase);
      const catName = (r) => {
        if (r.categoryId === '__new__') return `${esc(r.catRaw)} <span class="badge">new</span>`;
        const c = store.catMap().get(r.categoryId); return c ? esc(c.name) : '–';
      };
      body = `
        <div class="grid cols-3" style="margin-bottom:14px">
          <div class="card kpi"><span class="kpi-label">Rows to import</span><span class="kpi-value">${willImport.length}</span><span class="kpi-sub">${dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : ''}</span></div>
          <div class="card kpi"><span class="kpi-label">Spending</span><span class="kpi-value">${money(exp, { compact: true })}</span><span class="kpi-sub">${willImport.filter((r) => r.type === 'expense').length} rows</span></div>
          <div class="card kpi"><span class="kpi-label">Income</span><span class="kpi-value">${money(inc, { compact: true })}</span><span class="kpi-sub">${willImport.filter((r) => r.type === 'income').length} rows</span></div>
        </div>
        ${dupes.length ? `<label class="check" style="margin-bottom:10px"><input type="checkbox" data-imp-opt="skipDupes" ${s.opts.skipDupes ? 'checked' : ''}> Skip ${dupes.length} row(s) that already exist in the tracker (same date, amount and description)</label>` : ''}
        ${bad.length ? `<div class="banner bad">${icon('alert')}<div class="grow small"><b>${bad.length} row(s) will be skipped:</b><br>${bad.slice(0, 8).map((r) => `Row ${r._row}: ${esc(r.errs.join(', '))}`).join('<br>')}${bad.length > 8 ? `<br>…and ${bad.length - 8} more` : ''}</div></div>` : ''}
        <div class="small muted" style="margin-bottom:6px">Dates read as ${s.detectedDateFmt === 'mdy' ? 'Month/Day/Year' : 'Day/Month/Year'} · change on the previous step if wrong. Preview (first 60):</div>
        <div class="preview-table"><table class="t"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Person</th><th>Account</th><th class="r">Amount</th></tr></thead><tbody>
          ${willImport.slice(0, 60).map((r) => `<tr><td class="nowrap">${fmtDate(r.date)}</td><td>${esc(r.description)}</td><td>${catName(r)}</td><td>${esc(pname(r.person))}</td>
            <td>${r.accountId === '__new__' ? `${esc(r.accRaw)} <span class="badge">new</span>` : esc((store.accMap().get(r.accountId) || {}).name || '–')}</td>
            <td class="r nowrap ${r.type === 'income' ? 'amt-in' : ''}">${r.type === 'income' ? '+' : ''}${fmt(r.amount, r.currency)}</td></tr>`).join('')}
        </tbody></table></div>`;
      const back = ['category', 'person', 'account', 'type'].some((k) => Object.keys(s.values[k]).length) ? 3 : 2;
      foot = `<button class="btn" data-imp-go="${back}">${icon('left')} Back</button><span class="spacer"></span>
        <button class="btn primary" data-imp-commit ${willImport.length ? '' : 'disabled'}>${icon('upload')} Import ${willImport.length} transactions</button>`;
    }
    el.innerHTML = `${Modal.head('Import spending history', 'Google Sheets, Excel or any CSV')}<div class="modal-body">${stepsHTML}${body}</div><div class="modal-foot">${foot}</div>`;
    this.bind(el);
  },
  bind(el) {
    const s = this.s;
    el.querySelectorAll('[data-imp-src]').forEach((b) => { b.onclick = () => { if (s.source === 'paste') s.text = ($('#imp-text') || {}).value || s.text; s.source = b.dataset.impSrc; this.render(); }; });
    el.querySelectorAll('[data-imp-go]').forEach((b) => { b.onclick = () => this.go(+b.dataset.impGo); });
    const f = $('#imp-file', el);
    if (f) f.onchange = async () => { const file = f.files[0]; if (!file) return; s.text = await file.text(); this.go(2); };
    const tpl = el.querySelector('[data-imp-template]');
    if (tpl) tpl.onclick = (e) => { e.preventDefault(); downloadFile('budget-import-template.csv', IMPORT_TEMPLATE, 'text/csv'); };
    el.querySelectorAll('[data-imp-map]').forEach((sel) => { sel.onchange = () => { s.map[sel.dataset.impMap] = sel.value; }; });
    el.querySelectorAll('[data-imp-opt]').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.dataset.impOpt;
        if (k === 'hasHeader') { s.hasHeader = inp.checked; this.autoMap(); this.render(); return; }
        s.opts[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (s.step === 4) this.render();
      };
    });
    el.querySelectorAll('[data-imp-val]').forEach((sel) => { sel.onchange = () => { s.values[sel.dataset.impVal][sel.dataset.val] = sel.value; }; });
    const commit = el.querySelector('[data-imp-commit]');
    if (commit) commit.onclick = () => this.commit();
  },
  commit() {
    const s = this.s; const rows = (s.built || []).filter((r) => !r.errs.length && !(s.opts.skipDupes && r.dupe));
    const importId = uid('imp_');
    const newCats = {}; const newAccs = {};
    const colors = ['#0ea5e9', '#f97316', '#a855f7', '#16a34a', '#e11d48', '#eab308', '#14b8a6', '#6366f1', '#84cc16', '#ec4899'];
    let ci = 0;
    store.batch(() => {
      for (const r of rows) {
        let categoryId = r.categoryId;
        if (categoryId === '__new__') {
          const key = `${r.type}|${r.catRaw.toLowerCase()}`;
          if (!newCats[key]) {
            const exists = findCategoryByName(r.catRaw, r.type);
            newCats[key] = exists ? exists.id : store.upsert('categories', { id: uid('c_'), name: r.catRaw, type: r.type, group: r.type === 'income' ? 'Income' : 'Wants', color: colors[ci++ % colors.length], order: 500 }).id;
          }
          categoryId = newCats[key];
        }
        let accountId = r.accountId;
        if (accountId === '__new__') {
          const key = r.accRaw.toLowerCase();
          if (!newAccs[key]) newAccs[key] = store.upsert('accounts', { id: uid('a_'), name: r.accRaw, type: /cash|tunai/i.test(r.accRaw) ? 'cash' : /ovo|gopay|dana|shopeepay|linkaja|wallet/i.test(r.accRaw) ? 'ewallet' : /credit|kartu kredit|cc\b/i.test(r.accRaw) ? 'credit' : 'bank', owner: guessPerson(r.accRaw) || r.person, currency: 'IDR', opening: 0, openingDate: '' }).id;
          accountId = newAccs[key];
        }
        store.upsert('transactions', {
          id: uid('t_'), date: r.date, type: r.type, amount: r.amount, currency: r.currency, rate: r.rate,
          description: r.description, categoryId, person: r.person, accountId: accountId || '', notes: r.notes, importId,
        });
      }
    });
    Modal.close();
    // show the imported period
    const dates = rows.map((r) => r.date).sort();
    if (dates.length) { ui.filter.preset = 'custom'; ui.filter.from = dates[0].slice(0, 7) + '-01'; ui.filter.to = endOfMonth(dates[dates.length - 1].slice(0, 7)); saveUI(); }
    App.go('spending');
    toast(`Imported ${rows.length} transactions.`, '', {
      label: 'Undo', fn: () => {
        store.batch(() => { store.all('transactions').filter((t) => t.importId === importId).forEach((t) => store.remove('transactions', t.id)); });
        toast('Import undone.');
      },
    });
  },
};

const IMPORT_TEMPLATE = [
  'Date,Description,Category,Amount,Person,Type,Currency,Account,Notes',
  '01/08/2026,Monthly salary,Salary,15000000,Junior,Income,IDR,Junior\'s Bank,',
  '01/08/2026,Monthly salary,Salary,14000000,Sabit,Income,IDR,Sabit\'s Bank,',
  '02/08/2026,Indomaret weekly groceries,Groceries,"425.000",Shared,Expense,IDR,Cash,',
  '03/08/2026,Gojek to office,Transport,28000,Junior,Expense,IDR,Junior\'s Bank,',
  '05/08/2026,Rent August,Housing & Rent,6500000,Shared,Expense,IDR,Junior\'s Bank,',
  '09/08/2026,Ramen in Shibuya,Dining & Coffee,1800,Sabit,Expense,JPY,Cash,Japan trip',
].join('\r\n');
