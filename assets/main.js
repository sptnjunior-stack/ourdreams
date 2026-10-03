'use strict';
/* =====================================================================
 * main.js — app shell, routing, filters, forms and actions
 * ===================================================================== */

const PAGES = [
  ['dashboard', 'Dashboard', 'dashboard'],
  ['log', 'Log', 'receipt'],
  ['budget', 'Budget', 'pie'],
  ['categories', 'Categories', 'tag'],
  ['goals', 'Goals', 'target'],
  ['balance', 'Balance', 'wallet'],
  ['settings', 'Settings', 'settings'],
];

function applyTheme() {
  const root = document.documentElement;
  if (cfg.theme === 'light' || cfg.theme === 'dark') root.dataset.theme = cfg.theme; else delete root.dataset.theme;
}

const App = {
  sel: new Set(),
  ddOpen: false,
  filtersOpen: false,
  _deferred: false,

  init() {
    store.load();
    applyTheme();
    if (window.Chart) {
      Chart.defaults.font.family = '"Plus Jakarta Sans", system-ui, sans-serif';
    }
    window.addEventListener('hashchange', () => this.onHash());
    window.addEventListener('error', (ev) => { if (ev && ev.message) toast(`Something went wrong: ${ev.message}`, 'bad'); });
    window.addEventListener('unhandledrejection', (ev) => { const r = ev && ev.reason; if (r) toast(`Something went wrong: ${r.message || r}`, 'bad'); });
    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('change', (e) => this.onChange(e));
    // leaving an amount field turns 750rb / 1,5jt into 750.000 / 1.500.000
    document.addEventListener('focusout', (e) => {
      const el = e.target;
      if (!el.matches || !el.matches('input[data-money], input[data-bud]')) return;
      const raw = el.value.trim(); if (!raw) return;
      const curSel = el.form && el.form.elements.currency;
      const cur = el.dataset.money || (curSel && curSel.value) || 'IDR';
      const v = parseAmount(raw);
      if (!isFinite(v)) return;
      if (!(CURRENCIES[cur] || { decimals: 2 }).decimals && !Number.isInteger(v)) return; // e.g. "1.5" in Rupiah: leave it for you to fix
      const out = fmtInput(v, cur);
      if (out !== el.value) { el.value = out; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    // live "= Rp 1.500.000" hint under amount fields, so 750rb / 1,5jt are easy to check
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.matches || !el.matches('input[data-money]') || el.hasAttribute('data-nohint')) return;
      let h = el.nextElementSibling;
      if (!h || !h.classList.contains('money-hint')) { h = document.createElement('span'); h.className = 'hint money-hint'; el.insertAdjacentElement('afterend', h); }
      const curSel = el.form && el.form.elements.currency;
      const cur = el.dataset.money || (curSel && curSel.value) || 'IDR';
      const v = parseAmount(el.value);
      h.textContent = !el.value.trim() ? '' : isFinite(v) ? `= ${fmt(v, cur)}` : 'Not a number yet. Try 750rb, 1,5jt or 1.500.000';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Modal.isOpen() && !e.defaultPrevented) Modal.close();
      const tag = (document.activeElement || {}).tagName;
      if (!Modal.isOpen() && !/INPUT|SELECT|TEXTAREA/.test(tag) && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openTxForm(); }
    });
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.render()); } catch (e) { /* ignore */ }
    $('#fab').innerHTML = icon('plus');
    this.onHash(true);
    if (!cfg.me) welcome();
    if (store._migrated) sync.markDirty();
    sync.start();
  },
  onHash(first = false) {
    let p = (location.hash || '').replace('#', '') || ui.page || 'dashboard';
    if (p === 'spending') p = 'log'; // old name of the Log page (bookmarks, saved state)
    const page = PAGES.some((x) => x[0] === p) ? p : 'dashboard';
    if (!first && page !== ui.page) this.sel.clear();
    ui.page = page; saveUI();
    if (location.hash.replace('#', '') !== page) history.replaceState(null, '', `#${page}`);
    $('#app').classList.remove('nav-open');
    this.render();
    if (!first) window.scrollTo(0, 0);
  },
  go(page) { if (ui.page === page) this.render(); else location.hash = page; },
  renderSoon() {
    const a = document.activeElement;
    if (a && ($('#page').contains(a) || $('#topbar').contains(a)) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) {
      if (!this._deferred) {
        this._deferred = true;
        a.addEventListener('blur', () => { if (this._deferred) { this._deferred = false; setTimeout(() => this.render(), 60); } }, { once: true });
      }
      return;
    }
    this.render();
  },
  render() {
    this._deferred = false;
    // remember focus so re-rendering doesn't kick you out of a field
    const a = document.activeElement;
    let focusSel = null, caret = null;
    if (a && a !== document.body && ($('#page').contains(a) || $('#topbar').contains(a))) {
      if (a.id) focusSel = `#${a.id}`;
      else if (a.dataset && a.dataset.bud) focusSel = `[data-bud="${a.dataset.bud}"]`;
      try { caret = a.selectionStart; } catch (e) { caret = null; }
    }
    try { Charts.destroyAll(); } catch (e) { console.error(e); }
    const problems = [];
    try { this.renderSidebar(); } catch (e) { console.error(e); problems.push(['the menu', e]); }
    try { this.renderTopbar(); } catch (e) {
      console.error(e); problems.push(['the filter bar', e]);
      const page = PAGES.find((p) => p[0] === ui.page) || PAGES[0];
      $('#topbar').innerHTML = `<div class="topbar-row"><button class="btn ghost icon menu-btn" data-action="open-nav" aria-label="Menu">${icon('menu')}</button><h1 class="page-title">${page[1]}</h1></div>`;
    }
    const view = Views[ui.page] || Views.dashboard;
    let html = '';
    try { html = view(); } catch (e) { console.error(e); problems.push(['this page', e]); }
    $('#page').innerHTML = (problems.length ? errorPanel(problems) : '') + html;
    try { if (html && view.after) view.after(); } catch (e) { console.error(e); $('#page').insertAdjacentHTML('afterbegin', errorPanel([['the charts', e]])); }
    $('#fab').classList.toggle('hidden', ui.page === 'settings');
    if (this._refocus) { focusSel = this._refocus; this._refocus = null; caret = null; }
    if (focusSel) {
      const el = $(focusSel);
      if (el) { el.focus({ preventScroll: true }); try { if (caret !== null && el.setSelectionRange && el.type !== 'number') el.setSelectionRange(caret, caret); else if (el.select && el.dataset.bud) el.select(); } catch (e) { /* ignore */ } }
    }
  },
  renderSidebar() {
    $('#sidebar').innerHTML = `
      <div class="brand"><span class="brand-mark">${icon('heart')}</span><div>Our Budget<small>${esc(pname('junior'))} & ${esc(pname('sabit'))}</small></div></div>
      ${PAGES.map(([id, label, ic]) => `<a class="nav-item ${ui.page === id ? 'active' : ''}" href="#${id}">${icon(ic)}${label}</a>`).join('')}
      <div class="sidebar-foot">
        ${sync.pillHTML()}
        <div class="small muted" title="App version: check this after uploading new files">Version ${APP_VERSION}</div>
        <div class="me-switch">Using this device
          <div class="seg full">${['junior', 'sabit'].map((p) => `<button class="${me() === p ? 'on' : ''}" data-action="set-me" data-v="${p}"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</button>`).join('')}</div>
        </div>
      </div>`;
  },
  renderTopbar() {
    const page = PAGES.find((p) => p[0] === ui.page) || PAGES[0];
    const f = getFilter();
    const fl = ui.filter;
    const showFilters = ui.page !== 'settings';
    const isDefault = fl.preset === 'thisMonth' && fl.person === 'all' && !fl.cats.length;
    const catsLabel = fl.cats.length ? `${fl.cats.length} categor${fl.cats.length === 1 ? 'y' : 'ies'}` : 'All categories';
    // month picker: shows a month when the range is exactly one calendar month
    const oneMonth = f.from.endsWith('-01') && f.to === endOfMonth(f.from.slice(0, 7)) ? f.from.slice(0, 7) : '';
    const selYear = (oneMonth || f.to).slice(0, 4);
    const txYears = store.activeTx().map((t) => +String(t.date).slice(0, 4)).filter((y) => y > 1990);
    const nowY = new Date().getFullYear();
    const years = []; for (let y = Math.max(nowY + 1, +selYear); y >= Math.min(nowY - 2, +selYear, ...txYears); y--) years.push(y);
    const catGroups = [['Income', store.categories('income')], ...GROUPS.map((g) => [g, store.categories('expense').filter((c) => c.group === g)])];
    $('#topbar').className = `topbar ${this.filtersOpen ? 'filters-open' : ''}`;
    $('#topbar').innerHTML = `
      <div class="topbar-row">
        <button class="btn ghost icon menu-btn" data-action="open-nav" aria-label="Menu">${icon('menu')}</button>
        <h1 class="page-title">${page[1]}</h1>
        <div class="topbar-actions">
          ${showFilters ? `<button class="btn sm filter-toggle ${isDefault ? '' : 'primary'}" data-action="toggle-filters">${icon('filter')} Filters</button>` : ''}
          <span class="hide-sm">${sync.pillHTML()}</span>
        </div>
      </div>
      ${showFilters ? `
      <div class="filter-summary">${esc(filterLabel(f))}</div>
      <div class="filters">
        <select id="f-preset" aria-label="Date range">${PRESETS.map(([v, l]) => `<option value="${v}" ${fl.preset === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="field-inline month-pick" role="group" aria-label="Month">
          <button class="btn icon sm" data-action="f-month-step" data-d="-1" aria-label="Previous month">${icon('left')}</button>
          <select id="f-month" aria-label="Month"><option value="" ${oneMonth ? '' : 'selected'} disabled>Month…</option>${MONTHS_LONG.map((mn, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${oneMonth && +oneMonth.slice(5) === i + 1 ? 'selected' : ''}>${mn}</option>`).join('')}</select>
          <select id="f-year" aria-label="Year">${years.map((y) => `<option ${String(y) === selYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <button class="btn icon sm" data-action="f-month-step" data-d="1" aria-label="Next month">${icon('right')}</button>
        </div>
        <div class="field-inline"><input type="date" id="f-from" value="${f.from}" aria-label="From"><span class="muted">–</span><input type="date" id="f-to" value="${f.to}" aria-label="To"></div>
        <div class="seg" role="group" aria-label="Person">
          <button class="${fl.person === 'all' ? 'on' : ''}" data-action="f-person" data-v="all">Everyone</button>
          ${PEOPLE.map((p) => `<button class="${fl.person === p ? 'on' : ''}" data-action="f-person" data-v="${p}"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</button>`).join('')}
          <button class="${fl.person === SPLIT ? 'on' : ''}" data-action="f-person" data-v="${SPLIT}" title="Only transactions you split between you"><span class="dot" style="background:${pcolor('junior')}"></span><span class="dot" style="background:${pcolor('sabit')};margin-left:-6px"></span>Split</button>
        </div>
        <div class="dd" id="cat-dd">
          <button class="btn ${fl.cats.length ? 'primary' : ''}" data-action="cat-dd">${icon('tag')} ${catsLabel} ${icon('down')}</button>
          ${this.ddOpen ? `<div class="dd-panel">
            <div class="dd-actions"><button class="btn sm" data-action="cat-dd-all">All</button><button class="btn sm" data-action="cat-dd-none">Spending only</button><button class="btn sm ghost" data-action="cat-dd-close" style="margin-left:auto">Done</button></div>
            ${catGroups.filter(([, l]) => l.length).map(([g, l]) => `<h6><a href="#" data-action="cat-dd-group" data-g="${g}" style="color:inherit;text-decoration:none">${g}</a></h6>${l.map((c) => `<label><input type="checkbox" class="check" data-fcat="${c.id}" ${fl.cats.includes(c.id) ? 'checked' : ''}><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</label>`).join('')}`).join('')}
          </div>` : ''}
        </div>
        ${isDefault ? '' : `<button class="btn ghost sm" data-action="f-reset">${icon('x')} Reset</button>`}
      </div>` : ''}`;
  },
  setFilter(patch) {
    Object.assign(ui.filter, patch);
    ui.budgetMonth = null; ui.tx.limit = 100;
    saveUI(); this.render();
  },
  setCatFilter(id) { this.setFilter({ cats: [id] }); if (ui.page === 'categories') this.go('dashboard'); },

  setBudget(ym, catId, person, amount) {
    const { src, inherited, list } = budgetsFor(ym);
    store.batch(() => {
      if (inherited && src) {
        for (const b of list) store.upsert('budgets', { id: budgetId(ym, b.categoryId, b.person), month: ym, categoryId: b.categoryId, person: b.person, amount: b.amount });
      }
      store.upsert('budgets', { id: budgetId(ym, catId, person), month: ym, categoryId: catId, person, amount });
    });
  },

  async onClick(e) {
    // close category dropdown on outside click
    if (this.ddOpen && !e.target.closest('#cat-dd')) { this.ddOpen = false; this.renderTopbar(); }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    const v = el.dataset.v;
    if (el.tagName === 'A' || el.tagName === 'H6') e.preventDefault();
    switch (act) {
      case 'open-nav': $('#app').classList.add('nav-open'); break;
      case 'close-nav': $('#app').classList.remove('nav-open'); break;
      case 'toggle-filters': this.filtersOpen = !this.filtersOpen; this.renderTopbar(); break;
      case 'add-tx': openTxForm(); break;
      case 'add-transfer': openTxForm(null, { type: 'transfer' }); break;
      case 'edit-tx': { const t = store.get('transactions', id); if (t) openTxForm(t); break; }
      case 'import': Importer.open(); break;
      case 'export-csv': exportCSV(); break;
      case 'export-json': downloadFile(`budget-backup-${todayStr()}.json`, JSON.stringify(store.data, null, 1), 'application/json'); cfg.lastBackup = new Date().toISOString(); saveCfg(); this.render(); break;
      case 'local-snooze': cfg.localSnooze = new Date(Date.now() + 86400e3).toISOString(); saveCfg(); this.render(); break;
      case 'dash-trend': ui.dashTrend = v; this.render(); break;
      case 'filter-cat': this.setCatFilter(id); break;
      case 'filter-person': this.setFilter({ person: id }); break;
      case 'f-person': this.setFilter({ person: v }); break;
      case 'f-reset': this.setFilter({ preset: 'thisMonth', from: null, to: null, month: null, person: 'all', cats: [] }); break;
      case 'f-month-step': {
        const f = getFilter();
        const base = ui.filter.preset === 'month' && ui.filter.month ? ui.filter.month : f.to.slice(0, 7);
        this.setFilter({ preset: 'month', month: addMonths(base, +el.dataset.d) });
        break;
      }
      case 'cat-dd': this.ddOpen = !this.ddOpen; this.renderTopbar(); break;
      case 'cat-dd-close': this.ddOpen = false; this.renderTopbar(); break;
      case 'cat-dd-all': this.ddOpen = false; this.setFilter({ cats: [] }); break;
      case 'cat-dd-none': this.setFilter({ cats: store.categories('expense').map((c) => c.id) }); break;
      case 'cat-dd-group': {
        const g = el.dataset.g;
        const ids = (g === 'Income' ? store.categories('income') : store.categories('expense').filter((c) => c.group === g)).map((c) => c.id);
        this.setFilter({ cats: ids });
        break;
      }
      case 'tx-sort': { const k = el.dataset.k; if (ui.tx.sort === k) ui.tx.dir *= -1; else { ui.tx.sort = k; ui.tx.dir = k === 'date' || k === 'amount' ? -1 : 1; } saveUI(); this.render(); break; }
      case 'tx-type': ui.tx.type = v; ui.tx.limit = 100; saveUI(); this.render(); break;
      case 'tx-more': ui.tx.limit += 200; this.render(); break;
      case 'tx-sort-reset': ui.tx.sort = 'date'; ui.tx.dir = -1; saveUI(); this.render(); break;
      case 'tx-flagged': ui.tx.flagged = !ui.tx.flagged; ui.tx.limit = 100; saveUI(); this.render(); break;
      case 'review-flags': {
        const fl = flaggedTx();
        ui.tx.flagged = true; ui.tx.type = 'all'; ui.tx.account = 'all'; ui.tx.q = '';
        if (fl.length) { const ds = fl.map((t) => t.date).sort(); ui.filter.preset = 'custom'; ui.filter.from = ds[0]; ui.filter.to = ds[ds.length - 1]; }
        ui.filter.person = 'all'; ui.filter.cats = [];
        saveUI(); this.go('log'); break;
      }
      case 'flag-tx': {
        const t = store.get('transactions', id); if (!t) return;
        if (t.flagged) {
          const before = { ...t };
          store.upsert('transactions', { ...t, flagged: false, flagNote: '', flaggedBy: '', flaggedAt: '' });
          toast('Flag resolved.', '', { label: 'Undo', fn: () => store.upsert('transactions', before) });
        } else openFlagForm([t.id]);
        break;
      }
      case 'bulk-flag': openFlagForm([...this.sel]); break;
      case 'bulk-unflag': {
        const ids = [...this.sel];
        store.batch(() => ids.forEach((x) => { const t = store.get('transactions', x); if (t && t.flagged) store.upsert('transactions', { ...t, flagged: false, flagNote: '', flaggedBy: '', flaggedAt: '' }); }));
        toast('Flags cleared.'); break;
      }
      case 'tx-reset': Object.assign(ui.tx, { q: '', type: 'all', account: 'all', sort: 'date', dir: -1, limit: 100, flagged: false }); this.sel.clear(); saveUI(); this.render(); break;
      case 'sel': if (el.checked) this.sel.add(id); else this.sel.delete(id); this.render(); break;
      case 'sel-all': {
        const rows = $$('[data-action="sel"]').map((x) => x.dataset.id);
        if (el.checked) rows.forEach((x) => this.sel.add(x)); else rows.forEach((x) => this.sel.delete(x));
        this.render(); break;
      }
      case 'bulk-clear': this.sel.clear(); this.render(); break;
      case 'bulk-delete': {
        const n = this.sel.size;
        if (!(await confirmBox(`Delete ${n} transaction${n === 1 ? '' : 's'}?`, '<p>You can undo right after.</p>'))) return;
        const copies = [...this.sel].map((x) => store.get('transactions', x)).filter(Boolean);
        store.batch(() => copies.forEach((t) => store.remove('transactions', t.id)));
        this.sel.clear(); this.render();
        toast(`Deleted ${copies.length}.`, '', { label: 'Undo', fn: () => store.batch(() => copies.forEach((t) => store.upsert('transactions', t))) });
        break;
      }
      case 'bud-month': ui.budgetMonth = addMonths(ui.budgetMonth || thisMonth(), +el.dataset.d); saveUI(); this.render(); break;
      case 'bud-copy': {
        const ym = ui.budgetMonth; const prev = addMonths(ym, -1); const { list } = budgetsFor(prev);
        if (!list.length) { toast('No budget found for the previous month.', 'bad'); return; }
        store.batch(() => {
          store.all('budgets').filter((b) => b.month === ym).forEach((b) => store.remove('budgets', b.id));
          list.forEach((b) => store.upsert('budgets', { id: budgetId(ym, b.categoryId, b.person), month: ym, categoryId: b.categoryId, person: b.person, amount: b.amount }));
        });
        toast(`Copied ${fmtMonth(prev, true)}'s budget.`); break;
      }
      case 'bud-from-actual': {
        const ym = ui.budgetMonth; const prev = addMonths(ym, -1);
        const lns = allLines().filter((l) => l.date.startsWith(prev));
        if (!lns.length) { toast(`No transactions in ${fmtMonth(prev, true)}.`, 'bad'); return; }
        if (!(await confirmBox('Use last month\'s actuals?', `<p>This sets ${fmtMonth(ym, true)}'s plan to what each person actually earned and spent per category in ${fmtMonth(prev, true)} (rounded to Rp 50.000). You can adjust afterwards.</p>`, { okLabel: 'Fill plan', danger: false }))) return;
        const agg = {};
        for (const l of lns) { const k = `${l.categoryId}|${l.person}`; agg[k] = (agg[k] || 0) + l.v; }
        store.batch(() => {
          store.all('budgets').filter((b) => b.month === ym).forEach((b) => store.remove('budgets', b.id));
          for (const [k, val] of Object.entries(agg)) {
            const [catId, person] = k.split('|');
            if (!store.catMap().get(catId) || val <= 0) continue;
            store.upsert('budgets', { id: budgetId(ym, catId, person), month: ym, categoryId: catId, person, amount: Math.ceil(val / 50000) * 50000 });
          }
        });
        toast('Plan filled from last month.'); break;
      }
      case 'bud-clear': {
        const ym = ui.budgetMonth;
        if (!(await confirmBox(`Clear ${fmtMonth(ym, true)} budget?`, '<p>This month will fall back to the most recent earlier month\'s plan (if any).</p>', { okLabel: 'Clear' }))) return;
        store.batch(() => store.all('budgets').filter((b) => b.month === ym).forEach((b) => store.remove('budgets', b.id)));
        break;
      }
      case 'add-cat': openCategoryForm(); break;
      case 'toggle-fixed': {
        const c = store.get('categories', id); if (!c) return;
        const nowFixed = !isFixed(c);
        store.upsert('categories', { ...c, fixed: nowFixed });
        toast(`${c.name} is now ${nowFixed ? 'fixed (checked monthly)' : 'flexible (gets a daily allowance)'}.`);
        break;
      }
      case 'edit-cat': openCategoryForm(store.get('categories', id)); break;
      case 'del-cat': deleteCategory(store.get('categories', id)); break;
      case 'add-goal': openGoalForm(); break;
      case 'edit-goal': openGoalForm(store.get('goals', id)); break;
      case 'add-contrib': openContributionForm(store.get('goals', id)); break;
      case 'del-contrib': {
        const c = store.get('contributions', id); if (!c) return;
        store.remove('contributions', id);
        toast('Removed.', '', { label: 'Undo', fn: () => store.upsert('contributions', c) }); break;
      }
      case 'add-acc': openAccountForm(); break;
      case 'edit-acc': openAccountForm(store.get('accounts', id)); break;
      case 'reconcile': openReconcile(store.get('accounts', id)); break;
      case 'record-repeat': {
        const tpl = store.get('transactions', id); if (!tpl) return;
        const ym = el.dataset.ym;
        const keep = ['type', 'amount', 'currency', 'rate', 'description', 'categoryId', 'person', 'splitJunior', 'accountId', 'toAccountId', 'toAmount', 'payback', 'fee', 'goalId', 'notes'];
        const preset = {}; keep.forEach((k) => { if (tpl[k] !== undefined) preset[k] = tpl[k]; });
        const today = todayStr();
        preset.date = ym === today.slice(0, 7) ? today : dayInMonth(ym, Number(tpl.repeat.day) || 1);
        preset.repeatOf = tpl.id; preset.repeatMonth = ym;
        openTxForm(null, preset);
        break;
      }
      case 'skip-repeat': {
        const tpl = store.get('transactions', id); if (!tpl) return;
        const ym = el.dataset.ym;
        store.upsert('transactions', { ...tpl, repeat: { ...tpl.repeat, skips: [...new Set([...(tpl.repeat.skips || []), ym])] } });
        toast(`Skipped for ${fmtMonth(ym, true)}.`);
        break;
      }
      case 'reset-view': lsDel(LS.ui); location.hash = '#dashboard'; location.reload(); break;
      case 'pay-bill': openPayBill(store.get('accounts', id)); break;
      case 'set-debt-type': {
        const ids = String(id || '').split(',').filter(Boolean);
        store.batch(() => ids.forEach((x) => { const a = store.get('accounts', x); if (a && !isDebtAcc(a)) store.upsert('accounts', { ...a, type: suggestedDebtType(a), opening: -Math.abs(Number(a.opening) || 0) }); }));
        toast(ids.length === 1 ? 'Updated. Add its limit, statement and due day with the pencil icon.' : `Updated ${ids.length} accounts. Add limits, statement and due days with the pencil icons.`);
        break;
      }
      case 'statement': openStatement(store.get('accounts', id)); break;
      case 'set-me': cfg.me = v; saveCfg(); this.render(); toast(`This device is now ${pname(v)}'s.`); break;
      case 'set-theme': cfg.theme = v; saveCfg(); applyTheme(); this.render(); break;
      case 'fetch-rates': fetchRates(); break;
      case 'gh-save': ghSave(); break;
      case 'gh-test': ghTest(); break;
      case 'gh-forget': {
        if (!(await confirmBox('Disconnect GitHub on this device?', '<p>Your token is removed from this browser. Data stays in GitHub and in this browser.</p>', { okLabel: 'Disconnect' }))) return;
        cfg.github = { ...cfg.github, token: '' }; saveCfg(); sync.state = 'idle'; this.render(); break;
      }
      case 'sync-now':
        if (!gh.configured()) { this.go('settings'); toast('Connect GitHub first to sync between devices.'); return; }
        await sync.run(); if (sync.state === 'error') toast(sync.meta.error || 'Sync failed', 'bad'); else toast('Synced with GitHub.');
        this.render(); break;
      case 'wipe-tx': {
        const n = store.activeTx().length;
        if (!(await confirmBox('Delete ALL transactions?', `<p>This removes <b>${n}</b> transactions for both of you (including in GitHub). Categories, budgets, accounts and goals stay. Download a backup first if unsure.</p>`, { okLabel: `Delete ${n} transactions` }))) return;
        store.batch(() => store.activeTx().forEach((t) => store.remove('transactions', t.id)));
        toast('All transactions deleted.'); break;
      }
      case 'reset-device': {
        if (!(await confirmBox('Reset this device?', '<p>Clears this browser\'s copy of the data, your token and preferences. If you use GitHub sync, your data will download again after you reconnect.</p>', { okLabel: 'Reset' }))) return;
        Object.values(LS).forEach(lsDel); location.hash = ''; location.reload(); break;
      }
      default: break;
    }
  },
  onChange(e) {
    const el = e.target;
    if (el.id === 'f-preset') {
      const extra = el.value === 'custom' ? getFilter() : el.value === 'month' ? { month: getFilter().to.slice(0, 7) } : {};
      this.setFilter({ preset: el.value, ...extra }); return;
    }
    if (el.id === 'f-month' || el.id === 'f-year') {
      const mSel = $('#f-month').value || getFilter().to.slice(5, 7);
      this.setFilter({ preset: 'month', month: `${$('#f-year').value}-${mSel}` }); return;
    }
    if (el.id === 'f-from' || el.id === 'f-to') {
      const f = getFilter();
      const from = el.id === 'f-from' ? el.value || f.from : f.from;
      const to = el.id === 'f-to' ? el.value || f.to : f.to;
      this.setFilter({ preset: 'custom', from, to }); return;
    }
    if (el.dataset && el.dataset.fcat) {
      const set = new Set(ui.filter.cats);
      if (el.checked) set.add(el.dataset.fcat); else set.delete(el.dataset.fcat);
      Object.assign(ui.filter, { cats: [...set] }); ui.budgetMonth = null; saveUI();
      this.render();
    }
  },
};

/* ---------------- error panel ----------------
 * Shown instead of a blank page if something fails to draw, with the details to send for a fix. */
function errorPanel(problems) {
  const detail = problems.map(([where, e]) => `${where}: ${e && e.message}\n${String((e && e.stack) || '').split('\n').slice(0, 4).join('\n')}`).join('\n\n');
  return `<div class="banner bad err-panel">${icon('alert')}<div class="grow small">
    <b>Something went wrong drawing ${esc(problems.map((p) => p[0]).join(' and '))}.</b> Your data is safe. Try <b>Reset view</b> first. If it keeps happening, send a screenshot of this box.
    <pre class="err-detail">${esc(detail)}\nVersion ${APP_VERSION} · ${esc(navigator.userAgent)}</pre>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-action="reset-view">Reset view (keeps your data)</button><button class="btn sm" data-action="export-json">${icon('download')} Download backup</button></div>
  </div></div>`;
}

/* ---------------- welcome ---------------- */
function welcome() {
  const m = Modal.open(`${Modal.head('Welcome to your couple budget')}
    <div class="modal-body">
      <p style="margin-top:0">Who's using this device? New entries will default to this person (you can change it any time).</p>
      <div class="seg full" style="margin-bottom:16px">${['junior', 'sabit'].map((p) => `<button data-me="${p}" style="padding:12px"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</button>`).join('')}</div>
      <ol class="small" style="padding-left:18px;color:var(--text-2);line-height:1.7;margin:0">
        <li><b>Connect GitHub</b> in Settings so both of you share the same data.</li>
        <li><b>Import</b> your past spending from Google Sheets (Log → Import).</li>
        <li>Set a monthly <b>Budget</b>, your <b>Goals</b> and account <b>Balances</b>.</li>
      </ol>
    </div>`);
  m.querySelectorAll('[data-me]').forEach((b) => {
    b.onclick = () => { cfg.me = b.dataset.me; saveCfg(); Modal.close(); App.render(); toast(`Hi ${pname(cfg.me)}!`); };
  });
}

/* ---------------- transaction form ---------------- */
function lastAccountFor(person) {
  if (person === SPLIT || person === 'shared') person = me();
  const t = store.activeTx().filter((x) => x.person === person && x.accountId && x.type === 'expense').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  if (t && store.get('accounts', t.accountId)) return t.accountId;
  const own = store.all('accounts').find((a) => a.owner === person && !a.archived);
  return own ? own.id : '';
}
const FEE_CHIPS = [1000, 2500, 6500];
const SPLIT_CHIPS = [[0.5, '50 : 50'], [0.6, '60 : 40'], [0.4, '40 : 60'], [0.7, '70 : 30'], [0.3, '30 : 70']];
function openTxForm(existing, preset = {}) {
  const isNew = !existing;
  const t = existing ? { ...existing } : {
    id: uid('t_'), type: 'expense', date: todayStr(), amount: '', currency: 'IDR', rate: 1, description: '', categoryId: '',
    person: me(), splitJunior: 0.5, accountId: lastAccountFor(me()), toAccountId: '', notes: '', goalId: '', fee: 0, ...preset,
  };
  if (t.person === 'shared') { t.person = SPLIT; t.splitJunior = 0.5; }
  if (isNew && ui.filter.person !== 'all' && !preset.person) { t.person = ui.filter.person; t.accountId = lastAccountFor(t.person); }
  let catTouched = !!existing && !!t.categoryId;
  // past descriptions for the suggestion list: newest first, with how often and in which category they were used
  const descInfo = new Map();
  for (const x of [...store.activeTx()].sort((a, b) => b.date.localeCompare(a.date))) {
    const d = (x.description || '').trim(); if (!d) continue;
    const k = d.toLowerCase();
    if (!descInfo.has(k)) descInfo.set(k, { text: d, n: 0, categoryId: x.categoryId, amount: txBase(x) });
    descInfo.get(k).n++;
  }
  const accOpts = (sel) => `<option value="">— none —</option>${store.all('accounts').filter((a) => !a.archived || a.id === sel).map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}`;
  const goals = store.all('goals');
  const hasFee = !!(Number(t.fee) || 0);
  const title = isNew ? (t.type === 'transfer' ? 'New transfer' : 'New transaction') : (t.type === 'adjustment' ? 'Balance adjustment' : 'Edit transaction');
  const m = Modal.open(`${Modal.head(title, isNew ? `Tip: press <b>N</b> anywhere to add one quickly` : `Last edited by ${esc(pname(t.updatedBy || t.createdBy))} · ${relTime(t.updatedAt)}`)}
    <form class="modal-body" id="tx-form" autocomplete="off">
      ${t.type === 'adjustment' ? '' : `<div class="seg full" style="margin-bottom:14px">
        ${[['expense', 'Spending'], ['income', 'Income'], ['transfer', 'Transfer']].map(([v, l]) => `<button type="button" data-t="${v}" class="${t.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>`}
      <div class="form-grid tx-grid">
        <label class="field">Amount<div style="display:flex;gap:8px"><input type="text" name="amount" inputmode="decimal" data-money data-nohint autofocus required value="${t.amount !== '' ? fmtInput(t.amount, t.currency) : ''}" placeholder="45.000 or 1,5jt" style="flex:1;min-width:0;font-size:18px;font-weight:700">
          <select name="currency" style="width:84px;flex:none">${CUR_CODES.map((c) => `<option ${t.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <span class="hint" id="amt-preview"></span></label>
        <label class="field">Date<input type="date" name="date" required value="${t.date}"></label>
        ${t.type === 'adjustment' ? '' : `<div class="field full fee-wrap">
          <button type="button" class="link-btn ${hasFee ? 'hidden' : ''}" data-fee-open>${icon('plus')} Add admin fee</button>
          <div class="fee-box ${hasFee ? '' : 'hidden'}">
            <div class="fee-head"><span>Admin fee</span><button type="button" class="link-btn" data-fee-remove>Remove</button></div>
            <div class="chip-row">${FEE_CHIPS.map((v) => `<button type="button" class="pick" data-fee="${v}">+${fmtInput(v)}</button>`).join('')}${FEE_CHIPS.slice(0, 2).map((v) => `<button type="button" class="pick" data-fee="${-v}">−${fmtInput(v)}</button>`).join('')}
              <input type="text" name="fee" inputmode="decimal" data-money data-nohint value="${hasFee ? fmtInput(t.fee, t.currency) : ''}" placeholder="Other, e.g. 3.500 or -1.000" aria-label="Admin fee amount" style="flex:1;min-width:150px"></div>
            <div class="hint" id="fee-help"></div>
            <div class="fee-sum" id="fee-sum"></div>
          </div></div>`}
        <label class="field full rate-row">Exchange rate<div style="display:flex;gap:8px;align-items:center"><span class="muted nowrap" id="rate-label">1 ${t.currency} = Rp</span><input type="text" name="rate" inputmode="decimal" value="${fmtInput(t.rate || rateOf(t.currency), 'USD')}" style="flex:1"></div><span class="hint">Saved with this transaction. Default comes from Settings.</span></label>
        <div class="field full"><label for="tx-desc">Description</label><div class="ac-wrap"><input type="text" id="tx-desc" name="description" value="${esc(t.description)}" placeholder="e.g. Indomaret, Gojek, Rent" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="desc-ac"><div class="ac-list hidden" id="desc-ac" role="listbox"></div></div></div>
        <label class="field cat-row"><span id="cat-label">Category</span><select name="categoryId"></select><span class="hint cat-hint hidden">A label only: transfers aren't counted as spending or income.</span></label>
        <label class="field goal-row">Towards goal<select name="goalId"><option value="">— none —</option>${goals.map((g) => `<option value="${g.id}" ${t.goalId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
        <div class="field full who-row"><span>Who</span><div class="seg full" id="person-seg">${PEOPLE.map((p) => `<button type="button" data-p="${p}"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</button>`).join('')}<button type="button" data-p="${SPLIT}"><span class="dot" style="background:${pcolor('junior')}"></span><span class="dot" style="background:${pcolor('sabit')};margin-left:-6px"></span>Split</button></div></div>
        <div class="field full split-row">
          <div class="chip-row">${SPLIT_CHIPS.map(([r, l]) => `<button type="button" class="pick" data-split="${r}">${l}</button>`).join('')}</div>
          <div class="split-amts">
            <label class="split-amt"><span><span class="dot" style="background:${pcolor('junior')}"></span>${esc(pname('junior'))}'s share</span><input type="text" name="shareJunior" inputmode="decimal" data-money data-nohint></label>
            <div class="split-amt"><span><span class="dot" style="background:${pcolor('sabit')}"></span>${esc(pname('sabit'))}'s share</span><b id="share-sabit">–</b></div>
          </div>
          <span class="hint">Each share counts toward that person's budget and reports. "Paid from" is the account the money actually left.</span>
        </div>
        <div class="field full payback-row">
          <label class="check"><input type="checkbox" name="payback" ${t.payback ? 'checked' : ''}> ${icon('transfer')} <span id="payback-label">Paying back partner</span></label>
          <span class="hint" id="payback-hint"></span>
        </div>
        <label class="field acc-row"><span id="acc-label">Paid from</span><select name="accountId">${accOpts(t.accountId)}</select></label>
        <label class="field to-row"><span id="to-label">To account</span><select name="toAccountId">${accOpts(t.toAccountId)}</select></label>
        <div class="field full inst-row">
          <span>Pay in</span>
          <div class="chip-row">${[1, 3, 6, 12, 24].map((n) => `<button type="button" class="pick" data-inst="${n}">${n === 1 ? 'Full' : `${n}×`}</button>`).join('')}
            <input type="number" name="instMonths" min="2" max="60" placeholder="Other ×" aria-label="Number of months" style="width:96px"></div>
          <div class="inst-extra">
            <label class="split-amt"><span>Interest / fee per month (optional)</span><input type="text" name="instInterest" inputmode="decimal" data-nohint placeholder="e.g. 50.000 or 2,95%"></label>
          </div>
          <div class="fee-sum" id="inst-sum"></div>
        </div>
        <div class="field full inst-hint hidden"><div class="banner info" style="margin:0">${icon('info')}<div class="grow small"><span id="inst-hint-text"></span></div><button type="button" class="btn sm" data-fix-debt>Set as card</button></div></div>
        <label class="field to-amt-row">Amount received<input type="text" name="toAmount" inputmode="decimal" value="${t.toAmount != null && t.toAmount !== '' ? fmtInput(t.toAmount, 'USD') : ''}" placeholder="only if currencies differ"></label>
        <label class="field full">Notes<textarea name="notes" rows="2" placeholder="Optional">${esc(t.notes)}</textarea></label>
        <div class="field full repeat-field">
          ${t.repeatOf ? `<span class="hint">${icon('repeat')} Monthly repeat${(() => { const tp = store.get('transactions', t.repeatOf); return tp ? ` of “${esc(tp.description || 'transaction')}”` : ''; })()} · ${esc(fmtMonth(t.repeatMonth || t.date.slice(0, 7), true))}</span>`
    : `<label class="check"><input type="checkbox" name="repeat" ${t.repeat ? 'checked' : ''}> ${icon('repeat')} <span id="repeat-label">Repeats every month</span></label>`}
        </div>
        <div class="field full flag-field">
          <label class="check"><input type="checkbox" name="flagged" ${t.flagged ? 'checked' : ''}> ${icon('flag')} Flag for follow-up</label>
          <div class="flag-extra ${t.flagged ? '' : 'hidden'}">
            <div class="chip-row">${FLAG_REASONS.map((r) => `<button type="button" class="pick" data-flagreason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
            <input type="text" name="flagNote" value="${esc(t.flagNote || '')}" placeholder="What needs checking? (optional)" aria-label="Flag note">
          </div>
        </div>
      </div>
    </form>
    <div class="modal-foot">
      ${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button><button class="btn" data-dup title="Duplicate">${icon('copy')}</button>`}
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      ${isNew ? '<button class="btn" data-save-more>Save & add another</button>' : ''}
      <button class="btn primary" data-save>${icon('check')} Save</button>
    </div>`);
  const form = $('#tx-form', m);
  const F = (n) => form.elements[n];
  const show = (sel, on) => { m.querySelectorAll(sel).forEach((el) => el.classList.toggle('hidden', !on)); };
  let type = t.type, person = isSplit(t) ? SPLIT : t.person;
  let ratio = clamp(Number(t.splitJunior ?? 0.5), 0, 1);
  let feeOn = hasFee;
  let months = instMonths(t) || 1;
  const fillCats = () => {
    const ctype = type === 'income' ? 'income' : 'expense';
    const cur = F('categoryId').value || t.categoryId;
    const cats = store.categories(ctype);
    const groups = ctype === 'income' ? [['Income', cats]] : GROUPS.map((g) => [g, cats.filter((c) => c.group === g)]);
    F('categoryId').innerHTML = `<option value="">Choose…</option>${groups.filter(([, l]) => l.length).map(([g, l]) => `<optgroup label="${g}">${l.map((c) => `<option value="${c.id}" ${cur === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}`;
  };
  const amountNow = () => { const a = parseAmount(F('amount').value); return isFinite(a) ? Math.abs(a) : NaN; };
  const feeNow = () => { if (!feeOn || !F('fee')) return 0; const v = parseAmount(F('fee').value); return isFinite(v) ? v : 0; };
  const savingsCat = () => { const c = store.catMap().get(F('categoryId').value); return type === 'expense' && !!c && c.group === 'Savings'; };
  const updateShares = (fromInput = false) => {
    const a = amountNow();
    const cur = F('currency').value;
    if (!fromInput) F('shareJunior').value = isFinite(a) ? fmtInput(Math.round(a * ratio * 100) / 100, cur) : '';
    $('#share-sabit', m).textContent = isFinite(a) ? fmt(a * (1 - ratio), cur) : '–';
    m.querySelectorAll('[data-split]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.split - ratio) < 0.001));
  };
  const refresh = () => {
    const cur = F('currency').value;
    show('.rate-row', cur !== 'IDR');
    $('#rate-label', m).textContent = `1 ${cur} = Rp`;
    const isTr = type === 'transfer', isAdj = type === 'adjustment';
    show('.cat-row', !isAdj);
    $('#cat-label', m).textContent = isTr ? 'Category (optional)' : 'Category';
    show('.cat-hint', isTr);
    const sav = savingsCat();
    const pbOk = type === 'expense' && (person === 'junior' || person === 'sabit');
    show('.payback-row', pbOk);
    const pb = pbOk && F('payback').checked;
    const partner = partnerOf(person);
    if (pbOk) {
      $('#payback-label', m).textContent = `${pname(person)} is paying back ${pname(partner)}`;
      const cat = store.catMap().get(F('categoryId').value);
      $('#payback-hint', m).innerHTML = pb ? `Counts as <b>${esc(pname(person))}'s</b> ${cat ? esc(cat.name) : 'spending'} and lowers <b>${esc(pname(partner))}'s</b> by the same amount. Choose ${esc(pname(partner))}'s account below.` : `Tick this when ${esc(pname(person))} pays ${esc(pname(partner))} back for something ${esc(pname(partner))} already paid (e.g. a share of the rent).`;
      if (pb && !F('toAccountId').value) { const acc = store.all('accounts').find((a) => a.owner === partner && !a.archived && !isDebtAcc(a)); if (acc) F('toAccountId').value = acc.id; }
    }
    show('.to-row', isTr || sav || pb);
    $('#to-label', m).textContent = isTr ? 'To account' : pb ? `Into ${pname(partner)}'s account` : 'Moved into (optional)';
    const fromAcc = store.get('accounts', F('accountId').value), toAcc = store.get('accounts', F('toAccountId').value);
    show('.to-amt-row', (isTr || sav || (type === 'expense' && F('payback').checked && (person === 'junior' || person === 'sabit'))) && !!fromAcc && !!toAcc && toAcc.currency !== cur);
    $('#acc-label', m).textContent = isTr ? 'From account' : type === 'income' ? 'Received into' : isAdj ? 'Account' : 'Paid from';
    show('.goal-row', goals.length && !isTr && type !== 'income' && (sav || !!F('goalId').value));
    show('.split-row', person === SPLIT && !isTr && !isAdj);
    show('.who-row', !isAdj);
    m.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x.dataset.p === person));
    const a = parseAmount(F('amount').value);
    const r = cur === 'IDR' ? 1 : parseAmount(F('rate').value, 'us');
    $('#amt-preview', m).textContent = isFinite(a) ? (cur !== 'IDR' && isFinite(r) ? `≈ ${money(a * r)}` : fmt(a, cur)) : '';
    const fsum = $('#fee-sum', m);
    if (fsum) {
      const fee = feeNow(), fa = Math.abs(fee), A = amountNow();
      m.querySelectorAll('[data-fee]').forEach((b) => b.classList.toggle('on', feeOn && +b.dataset.fee === fee));
      const from = esc((fromAcc || {}).name || 'the account'), to = esc((toAcc || {}).name || 'the other account');
      const mm = (v) => fmt(v, cur);
      let txt = '';
      if (feeOn && fa && isFinite(A)) {
        if (type === 'income') txt = `<b>${mm(A - fa)}</b> arrives in ${from} · ${mm(A)} income − ${mm(fa)} fee`;
        else if (type === 'transfer') txt = fee > 0 ? `${from} sends <b>${mm(A + fa)}</b> · ${to} receives ${mm(A)} · ${mm(fa)} fee` : `${from} sends <b>${mm(A)}</b> · ${to} receives ${mm(A - fa)} · ${mm(fa)} fee included`;
        else txt = fee > 0 ? `<b>${mm(A + fa)}</b> leaves ${from} · ${mm(A)} + ${mm(fa)} fee` : `<b>${mm(A)}</b> leaves ${from} · ${mm(A - fa)} + ${mm(fa)} fee included`;
      }
      fsum.innerHTML = txt;
      $('#fee-help', m).innerHTML = type === 'income' ? 'The fee is taken from what you receive. It is counted in "Bank &amp; Admin Fees".' : '<b>+</b> = charged on top of the amount · <b>−</b> = already inside the amount. It is counted in "Bank &amp; Admin Fees".';
    }
    if (person === SPLIT) updateShares(document.activeElement === F('shareJunior'));
    // installments: only for spending paid with a credit card / paylater
    const instOk = type === 'expense' && isDebtAcc(fromAcc) && !pb;
    show('.inst-row', instOk);
    const hintOn = type === 'expense' && looksLikeDebt(fromAcc);
    show('.inst-hint', hintOn);
    if (hintOn) $('#inst-hint-text', m).innerHTML = `Paying in installments? <b>${esc(fromAcc.name)}</b> is set up as ${esc(ACCOUNT_TYPES[fromAcc.type] || fromAcc.type)}. Set it as a ${suggestedDebtType(fromAcc) === 'paylater' ? 'paylater' : 'credit card'} to see the "Pay in" options.`;
    if (!instOk) months = 1;
    m.querySelectorAll('[data-inst]').forEach((b) => b.classList.toggle('on', +b.dataset.inst === months || (months > 1 && ![3, 6, 12, 24].includes(months) && false)));
    if (document.activeElement !== F('instMonths')) F('instMonths').value = months > 1 && ![3, 6, 12, 24].includes(months) ? months : '';
    show('.inst-extra', instOk && months > 1);
    const isum = $('#inst-sum', m);
    const A2 = amountNow();
    if (instOk && months > 1 && isFinite(A2)) {
      const P = feeNow() < 0 ? A2 - Math.abs(feeNow()) : A2;
      const intr = parseInterest(F('instInterest').value, P);
      const last = addMonthsToDate(F('date').value || todayStr(), months - 1);
      isum.innerHTML = `<b>${fmt(P / months, cur)}</b> per month × ${months}${intr ? ` + ${fmt(intr, cur)} interest` : ''} · ${fmtDate(F('date').value || todayStr(), false)} – ${fmtDate(last)}. The card owes the full ${fmt(P, cur)} now; budgets count one month at a time (as a fixed cost).`;
    } else isum.innerHTML = '';
  };
  fillCats(); refresh();
  F('flagged').addEventListener('change', () => { show('.flag-extra', F('flagged').checked); });
  F('payback').addEventListener('change', refresh);
  const repeatLabel = () => { const el = $('#repeat-label', m); if (el) el.textContent = `Repeats every month${F('date').value ? ` (reminder on day ${Number(F('date').value.slice(8, 10))})` : ''}`; };
  repeatLabel(); F('date').addEventListener('change', repeatLabel);
  m.querySelectorAll('[data-flagreason]').forEach((b) => b.onclick = () => { F('flagNote').value = b.dataset.flagreason; });
  m.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
    type = b.dataset.t; m.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    if (!catTouched) F('categoryId').value = '';
    fillCats(); refresh();
  });
  m.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
    const prevDefault = lastAccountFor(person);
    person = b.dataset.p;
    if (isNew && (F('accountId').value === prevDefault)) { F('accountId').value = lastAccountFor(person); }
    refresh();
  });
  m.querySelectorAll('[data-split]').forEach((b) => b.onclick = () => { ratio = +b.dataset.split; updateShares(); });
  m.querySelectorAll('[data-inst]').forEach((b) => b.onclick = () => { months = +b.dataset.inst; F('instMonths').value = ''; refresh(); });
  m.querySelector('[data-fix-debt]').onclick = () => {
    const a = store.get('accounts', F('accountId').value); if (!a) return;
    store.upsert('accounts', { ...a, type: suggestedDebtType(a), opening: -Math.abs(Number(a.opening) || 0) });
    toast(`${a.name} is now a ${suggestedDebtType(a) === 'paylater' ? 'paylater' : 'credit card'} account.`);
    refresh();
  };
  F('instMonths').addEventListener('input', () => { const n = Math.round(Number(F('instMonths').value)); if (n >= 2 && n <= 60) { months = n; refresh(); } });
  F('instInterest').addEventListener('input', refresh);
  if (instMonths(t) && instInterest(t)) F('instInterest').value = fmtInput(instInterest(t), t.currency);
  F('date').addEventListener('change', refresh);
  F('shareJunior').addEventListener('input', () => {
    const a = amountNow(); const s = parseAmount(F('shareJunior').value);
    if (isFinite(a) && a > 0 && isFinite(s)) { ratio = clamp(s / a, 0, 1); updateShares(true); }
  });
  const feeOpen = m.querySelector('[data-fee-open]');
  if (feeOpen) {
    feeOpen.onclick = () => { feeOn = true; show('.fee-box', true); show('[data-fee-open]', false); refresh(); };
    m.querySelector('[data-fee-remove]').onclick = () => { feeOn = false; F('fee').value = ''; show('.fee-box', false); show('[data-fee-open]', true); refresh(); };
    m.querySelectorAll('[data-fee]').forEach((b) => b.onclick = () => { F('fee').value = (+b.dataset.fee < 0 ? '-' : '') + fmtInput(Math.abs(+b.dataset.fee), F('currency').value); refresh(); });
    F('fee').addEventListener('input', refresh);
  }
  F('currency').onchange = () => { F('rate').value = fmtInput(rateOf(F('currency').value), 'USD'); refresh(); };
  F('amount').oninput = refresh; F('rate').oninput = refresh;
  F('accountId').onchange = () => {
    const a = store.get('accounts', F('accountId').value);
    if (a && isNew && !F('amount').value) { F('currency').value = a.currency; F('rate').value = fmtInput(rateOf(a.currency), 'USD'); }
    refresh();
  };
  F('toAccountId').onchange = refresh;
  F('categoryId').onchange = () => { catTouched = true; refresh(); };
  // description suggestions (own dropdown: the browser's built-in one is unreadable in some Safari setups)
  const ac = $('#desc-ac', m); const di = F('description');
  let acItems = [], acIdx = -1;
  const acClose = () => { ac.classList.add('hidden'); di.setAttribute('aria-expanded', 'false'); acIdx = -1; };
  const acRender = () => {
    const q = di.value.trim().toLowerCase();
    if (!q) { acClose(); return; }
    const all = [...descInfo.values()].filter((x) => x.text.toLowerCase().includes(q) && x.text.toLowerCase() !== q);
    all.sort((a, b) => (b.text.toLowerCase().startsWith(q) - a.text.toLowerCase().startsWith(q)) || b.n - a.n);
    acItems = all.slice(0, 8);
    if (!acItems.length) { acClose(); return; }
    acIdx = Math.min(acIdx, acItems.length - 1);
    const hl = (txt) => { const i = txt.toLowerCase().indexOf(q); return i < 0 ? esc(txt) : `${esc(txt.slice(0, i))}<mark>${esc(txt.slice(i, i + q.length))}</mark>${esc(txt.slice(i + q.length))}`; };
    ac.innerHTML = acItems.map((x, i) => { const c = store.catMap().get(x.categoryId); return `<div class="ac-item ${i === acIdx ? 'on' : ''}" role="option" aria-selected="${i === acIdx}" data-ac="${i}"><span class="ac-text">${hl(x.text)}</span>${c ? `<span class="ac-meta"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>` : ''}</div>`; }).join('');
    ac.classList.remove('hidden'); di.setAttribute('aria-expanded', 'true');
  };
  const acPick = (i) => {
    const x = acItems[i]; if (!x) return;
    di.value = x.text; acClose();
    di.dispatchEvent(new Event('change', { bubbles: true }));
  };
  di.addEventListener('input', () => { acIdx = -1; acRender(); });
  di.addEventListener('focus', acRender);
  di.addEventListener('blur', () => setTimeout(acClose, 120));
  di.addEventListener('keydown', (e) => {
    if (ac.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); acIdx = (acIdx + 1) % acItems.length; acRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIdx = acIdx <= 0 ? acItems.length - 1 : acIdx - 1; acRender(); }
    else if (e.key === 'Enter' && acIdx >= 0) { e.preventDefault(); e.stopPropagation(); acPick(acIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acClose(); }
  });
  ac.addEventListener('mousedown', (e) => e.preventDefault());
  ac.addEventListener('click', (e) => { const it = e.target.closest('[data-ac]'); if (it) acPick(+it.dataset.ac); });
  F('description').addEventListener('change', () => {
    if (catTouched) return;
    const s = suggestCategory(F('description').value, type === 'income' ? 'income' : 'expense');
    if (s) { F('categoryId').value = s; refresh(); }
  });
  const collect = () => {
    const cur = F('currency').value;
    let amount = parseAmount(F('amount').value);
    if (!isFinite(amount) || amount === 0) { toast('Please enter an amount.', 'bad'); F('amount').focus(); return null; }
    if (type !== 'expense' && type !== 'adjustment') amount = Math.abs(amount);
    const rate = cur === 'IDR' ? 1 : parseAmount(F('rate').value, 'us');
    if (!isFinite(rate) || rate <= 0) { toast('Please enter a valid exchange rate.', 'bad'); return null; }
    if (!F('date').value) { toast('Please choose a date.', 'bad'); return null; }
    if (!isValidDate(F('date').value)) { toast(`"${F('date').value}" doesn't look right. Please pick a date between 2000 and 2100.`, 'bad'); F('date').focus(); return null; }
    let fee = 0;
    if (feeOn && F('fee') && F('fee').value.trim()) {
      fee = parseAmount(F('fee').value);
      if (!isFinite(fee)) { toast('The admin fee is not a number. Try 2.500 or -1.000.', 'bad'); F('fee').focus(); return null; }
      if (Math.abs(fee) >= Math.abs(amount) && (fee < 0 || type === 'income')) { toast('The fee must be smaller than the amount.', 'bad'); return null; }
    }
    const toVisible = !m.querySelector('.to-row').classList.contains('hidden');
    const rec = {
      ...t, type, amount, currency: cur, rate, date: F('date').value, description: F('description').value.trim(),
      person: type === 'transfer' || type === 'adjustment' ? (person === SPLIT ? me() : person) : person,
      categoryId: type === 'adjustment' ? '' : F('categoryId').value, accountId: F('accountId').value,
      toAccountId: toVisible ? F('toAccountId').value : '', notes: F('notes').value.trim(),
      payback: type === 'expense' && (person === 'junior' || person === 'sabit') && F('payback').checked,
      flagged: F('flagged').checked,
      flagNote: F('flagged').checked ? F('flagNote').value.trim() : '',
      flaggedBy: F('flagged').checked ? (t.flagged ? t.flaggedBy || me() : me()) : '',
      flaggedAt: F('flagged').checked ? (t.flagged ? t.flaggedAt || stamp() : stamp()) : '',
      goalId: m.querySelector('.goal-row').classList.contains('hidden') ? '' : F('goalId').value,
      fee,
    };
    const instVisible = !m.querySelector('.inst-row').classList.contains('hidden');
    if (instVisible && months > 1) {
      const P = principalAmt({ ...rec });
      const intr = parseInterest(F('instInterest').value, P);
      if (!isFinite(intr)) { toast('Interest is not a number. Try 50.000 or 2,95%.', 'bad'); return null; }
      rec.installment = { months, interest: intr };
    } else rec.installment = null;
    if (rec.person === SPLIT) rec.splitJunior = Math.round(ratio * 10000) / 10000; else delete rec.splitJunior;
    const toAmt = F('toAmount').value.trim();
    if (rec.payback && !rec.toAccountId) { toast(`Choose ${pname(partnerOf(rec.person))}'s account the money goes into.`, 'bad'); return null; }
    if (F('repeat')) rec.repeat = F('repeat').checked && type !== 'adjustment' ? { every: 'month', day: Number(rec.date.slice(8, 10)), skips: (t.repeat && t.repeat.skips) || [] } : null;
    rec.toAmount = toVisible && toAmt && !m.querySelector('.to-amt-row').classList.contains('hidden') ? parseAmount(toAmt) : null;
    if (type === 'transfer') {
      if (!rec.accountId || !rec.toAccountId) { toast('Choose both accounts for a transfer.', 'bad'); return null; }
      if (rec.accountId === rec.toAccountId) { toast('Pick two different accounts.', 'bad'); return null; }
    } else if (rec.toAccountId && rec.toAccountId === rec.accountId) { toast('"Moved into" must be a different account than "Paid from".', 'bad'); return null; }
    if (type !== 'transfer' && type !== 'adjustment' && !rec.categoryId) {
      rec.categoryId = type === 'income' ? (store.get('categories', 'c_other-income') ? 'c_other-income' : '') : (store.get('categories', 'c_other') ? 'c_other' : '');
    }
    return rec;
  };
  const save = async (more) => {
    const rec = collect(); if (!rec) return;
    const big = Math.abs(txBase(rec));
    if (big >= BIG_AMOUNT && Math.abs(txBase(t)) !== big) {
      const ok = await confirmBox('Is this amount right?', `<p style="margin-top:0">You entered <b style="font-size:18px">${money(big)}</b>${rec.description ? ` for <b>${esc(rec.description)}</b>` : ''}.</p><p class="hint">That's ${shortIDR(big).replace('M', ' miliar').replace('jt', ' juta')}. Big amounts are often an extra 000 by mistake.</p>`, { okLabel: 'Yes, save it', danger: false });
      if (!ok) { F('amount').focus(); F('amount').select && F('amount').select(); return; }
    }
    store.upsert('transactions', rec);
    Modal.close();
    toast(isNew ? `Added ${money(txBase(rec))}${rec.fee ? ' + fee' : ''}${rec.description ? ` · ${rec.description}` : ''}` : 'Saved.');
    if (more) openTxForm(null, { type: rec.type, date: rec.date, person: rec.person, splitJunior: rec.splitJunior ?? 0.5, accountId: rec.accountId, currency: rec.currency, rate: rec.rate });
  };
  form.onsubmit = (e) => { e.preventDefault(); save(false); };
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.name !== 'description') { e.preventDefault(); save(false); } });
  m.querySelector('[data-save]').onclick = () => save(false);
  const more = m.querySelector('[data-save-more]'); if (more) more.onclick = () => save(true);
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = () => {
    const copy = store.get('transactions', t.id);
    store.remove('transactions', t.id); Modal.close();
    toast('Transaction deleted.', '', { label: 'Undo', fn: () => store.upsert('transactions', copy) });
  };
  const dup = m.querySelector('[data-dup]');
  if (dup) dup.onclick = () => { const rec = collect(); if (!rec) return; Modal.close(); const { id, createdAt, createdBy, updatedAt, updatedBy, importId, ...rest } = rec; void id; void createdAt; void createdBy; void updatedAt; void updatedBy; void importId; openTxForm(null, { ...rest, date: todayStr() }); };
}

/** "2,95%" → 2,95% of the principal; "50.000" → 50000; empty → 0. */
function parseInterest(v, principal) {
  const s = String(v || '').trim(); if (!s) return 0;
  if (s.endsWith('%')) { const p = parseAmount(s.slice(0, -1).replace('.', ',').replace(/,(?=\d{3}\b)/, '')); return isFinite(p) ? Math.round((principal * p) / 100) : NaN; }
  return parseAmount(s);
}

/* ---------------- credit card: pay bill & statement ---------------- */
function openPayBill(card) {
  if (!card) return;
  const today = todayStr();
  const owed = Math.max(0, -accountBalance(card, today));
  const st = cardStatement(card, 0);
  const prev = st && st.due <= 0 ? null : st;
  const options = [];
  if (prev && prev.due > 0) options.push(['due', `Statement due · ${fmt(prev.due, card.currency)}`, prev.due]);
  if (owed > 0) options.push(['full', `Everything owed now · ${fmt(owed, card.currency)}`, owed]);
  const later = unbilledInstallments(card);
  const banks = store.all('accounts').filter((a) => !isDebtAcc(a) && !a.archived);
  const fromId = (banks.find((a) => a.owner === card.owner) || banks[0] || {}).id || '';
  let pick = options[0] ? options[0][0] : 'other';
  const m = Modal.open(`${Modal.head(`Pay ${esc(card.name)} bill`, prev && prev.dueDate ? `Statement ${fmtDate(prev.from, false)} – ${fmtDate(prev.close, false)} · due ${fmtDate(prev.dueDate)}` : 'Records a transfer from your bank to the card')}
    <form class="modal-body" id="pay-form"><div class="form-grid">
      <div class="field full"><span>Amount</span><div class="chip-row">${options.map(([k, l]) => `<button type="button" class="pick ${pick === k ? 'on' : ''}" data-pay="${k}">${l}</button>`).join('')}<button type="button" class="pick ${pick === 'other' ? 'on' : ''}" data-pay="other">Other</button></div></div>
      <label class="field">Pay amount (${card.currency})<input type="text" name="amount" inputmode="decimal" data-money="${card.currency}" value="${options[0] ? fmtInput(options[0][2], card.currency) : ''}"></label>
      <label class="field">Date<input type="date" name="date" value="${today}"></label>
      <label class="field full">From account<select name="from">${banks.map((a) => `<option value="${a.id}" ${a.id === fromId ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
    </div>
    <p class="hint">${later > 0 ? `${fmt(later, card.currency)} of future installments isn't billed yet, so "Everything owed now" includes it. ` : ''}A card payment is a transfer, not spending: the purchases were already counted when you made them.</p></form>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Record payment</button></div>`);
  const form = $('#pay-form', m);
  m.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => {
    pick = b.dataset.pay; m.querySelectorAll('[data-pay]').forEach((x) => x.classList.toggle('on', x === b));
    const o = options.find((x) => x[0] === pick); if (o) form.elements.amount.value = fmtInput(o[2], card.currency); else { form.elements.amount.value = ''; form.elements.amount.focus(); }
  });
  const save = () => {
    const v = parseAmount(form.elements.amount.value);
    if (!isFinite(v) || v <= 0) { toast('Please enter the amount you paid.', 'bad'); return; }
    if (!form.elements.from.value) { toast('Add a bank account to pay from first.', 'bad'); return; }
    const from = store.get('accounts', form.elements.from.value);
    if (form.elements.date.value && !isValidDate(form.elements.date.value)) { toast('Please pick a date between 2000 and 2100.', 'bad'); return; }
    store.upsert('transactions', { id: uid('t_'), type: 'transfer', date: form.elements.date.value || today, amount: convert(v, card.currency, from.currency), currency: from.currency, rate: rateOf(from.currency),
      toAmount: from.currency === card.currency ? null : v, description: `Pay ${card.name} bill`, categoryId: '', person: card.owner === 'shared' ? me() : card.owner, accountId: from.id, toAccountId: card.id, notes: '' });
    Modal.close(); toast(`Payment of ${fmt(v, card.currency)} recorded.`);
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
}
function openStatement(card, offset = 0) {
  if (!card) return;
  const st = cardStatement(card, offset);
  if (!st) { toast('Set the statement closing day for this card first (edit the account).', 'bad'); openAccountForm(card); return; }
  const c = card.currency;
  const html = `${Modal.head(`${esc(card.name)} statement`, `${fmtDate(st.from)} – ${fmtDate(st.close)}${st.dueDate ? ` · due ${fmtDate(st.dueDate)}` : ''}`)}
    <div class="modal-body">
      <div class="toolbar" style="margin-bottom:10px"><button class="btn icon sm" data-st="-1" aria-label="Previous statement">${icon('left')}</button><span class="small muted">${offset === 0 ? 'Latest statement' : `${-offset} statement${offset === -1 ? '' : 's'} ago`}</span><button class="btn icon sm" data-st="1" ${offset >= 1 ? 'disabled' : ''} aria-label="Next statement">${icon('right')}</button><span class="grow"></span>${offset === 1 ? '<span class="badge">current period, still open</span>' : ''}</div>
      ${st.items.length ? `<div class="preview-table"><table class="t"><thead><tr><th>Date</th><th>Item</th><th class="r">Amount</th></tr></thead><tbody>
        ${st.items.map((i) => `<tr><td class="nowrap">${fmtDate(i.date, false)}</td><td>${esc(i.label)}</td><td class="r num nowrap ${i.amount < 0 ? 'good' : ''}">${fmt(i.amount, c)}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('Nothing billed', 'No charges on this card in this statement period.')}
      <div class="list" style="margin-top:12px">
        <div class="list-row"><div class="grow">Total billed</div><div class="amount">${fmt(st.billed, c)}</div></div>
        <div class="list-row"><div class="grow">Paid after closing</div><div class="amount good">${fmt(-st.paidAfter, c)}</div></div>
        <div class="list-row"><div class="grow"><b>${offset === 1 ? 'Building up' : 'Still to pay'}</b></div><div class="amount ${st.due > 0 ? 'bad' : 'good'}">${st.due > 0 ? fmt(st.due, c) : 'Paid ✓'}</div></div>
      </div>
      <p class="hint">Check these lines against your bank's statement. Installments show one month's portion; refunds and adjustments are negative.</p>
    </div>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Close</button>${st.due > 0 && offset <= 0 ? `<button class="btn primary" data-paynow>Pay bill</button>` : ''}</div>`;
  const m = Modal.open(html, { wide: true });
  m.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { Modal.close(); openStatement(card, offset + Number(b.dataset.st)); });
  const pay = m.querySelector('[data-paynow]'); if (pay) pay.onclick = () => { Modal.close(); openPayBill(card); };
}

/* ---------------- flag form (quick) ---------------- */
function openFlagForm(ids) {
  ids = ids.filter((x) => store.get('transactions', x));
  if (!ids.length) return;
  const one = ids.length === 1 ? store.get('transactions', ids[0]) : null;
  const m = Modal.open(`${Modal.head(`${icon('flag')} Flag for follow-up`, one ? `${txTitle(one)} · ${money(txBase(one))} · ${fmtDate(one.date)}` : `${ids.length} transactions`)}
    <form class="modal-body" id="flag-form">
      <div class="chip-row" style="margin-bottom:10px">${FLAG_REASONS.map((r) => `<button type="button" class="pick" data-flagreason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <label class="field">What needs checking? (optional)<input type="text" name="note" autofocus placeholder="e.g. Ask Sabit if this was the Shopee refund"></label>
      <p class="hint">Flags don't change any totals. Find them later with the <b>Flagged</b> button on the Log page, or from the reminder on the Dashboard.</p>
    </form>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('flag')} Flag</button></div>`);
  const form = $('#flag-form', m);
  m.querySelectorAll('[data-flagreason]').forEach((b) => b.onclick = () => { form.elements.note.value = b.dataset.flagreason; m.querySelectorAll('[data-flagreason]').forEach((x) => x.classList.toggle('on', x === b)); });
  const save = () => {
    const note = form.elements.note.value.trim(); const at = stamp();
    store.batch(() => ids.forEach((x) => { const t = store.get('transactions', x); if (t) store.upsert('transactions', { ...t, flagged: true, flagNote: note, flaggedBy: me(), flaggedAt: at }); }));
    Modal.close(); toast(ids.length === 1 ? 'Flagged for follow-up.' : `Flagged ${ids.length} transactions.`);
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
}

/* ---------------- category form ---------------- */
function openCategoryForm(c) {
  const isNew = !c;
  c = c ? { ...c } : { id: uid('c_'), name: '', type: 'expense', group: 'Wants', color: '#6366f1', order: 500 };
  const m = Modal.open(`${Modal.head(isNew ? 'New category' : 'Edit category')}
    <form class="modal-body" id="cat-form"><div class="form-grid">
      <label class="field full">Name<input type="text" name="name" required value="${esc(c.name)}" placeholder="e.g. Pets, Coffee, Parking"></label>
      <label class="field">Type<select name="type"><option value="expense" ${c.type === 'expense' ? 'selected' : ''}>Spending</option><option value="income" ${c.type === 'income' ? 'selected' : ''}>Income</option></select></label>
      <label class="field grp">Group<select name="group">${GROUPS.map((g) => `<option ${c.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select><span class="hint">Needs = essentials · Wants = lifestyle · Savings = money set aside</span></label>
      <label class="field grp">Budget type<select name="fixed"><option value="0" ${!isFixed({ ...c, type: 'expense' }) ? 'selected' : ''}>Flexible: day-to-day, gets a daily allowance</option><option value="1" ${isFixed({ ...c, type: 'expense' }) ? 'selected' : ''}>Fixed: monthly bill, checked once a month</option></select></label>
      <label class="field">Colour<input type="color" name="color" value="${c.color}"></label>
    </div></form>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Save</button></div>`);
  const form = $('#cat-form', m);
  const sync_ = () => m.querySelectorAll('.grp').forEach((el) => el.classList.toggle('hidden', form.elements.type.value === 'income'));
  form.elements.type.onchange = sync_; sync_();
  const save = () => {
    const name = form.elements.name.value.trim();
    if (!name) { toast('Please enter a name.', 'bad'); return; }
    const type = form.elements.type.value;
    const dupe = store.all('categories').find((x) => x.id !== c.id && x.type === type && x.name.toLowerCase() === name.toLowerCase());
    if (dupe) { toast('A category with that name already exists.', 'bad'); return; }
    store.upsert('categories', { ...c, name, type, group: type === 'income' ? 'Income' : form.elements.group.value, color: form.elements.color.value, fixed: type === 'expense' && form.elements.fixed.value === '1' });
    Modal.close(); toast('Category saved.');
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
}
async function deleteCategory(c) {
  if (!c) return;
  const used = store.activeTx().filter((t) => t.categoryId === c.id);
  const others = store.categories(c.type).filter((x) => x.id !== c.id);
  if (!used.length) {
    if (!(await confirmBox(`Delete "${c.name}"?`, '<p>No transactions use it. Its budget amounts are removed too.</p>'))) return;
    store.batch(() => { store.remove('categories', c.id); store.all('budgets').filter((b) => b.categoryId === c.id).forEach((b) => store.remove('budgets', b.id)); });
    return;
  }
  const m = Modal.open(`${Modal.head(`Delete "${esc(c.name)}"?`)}
    <div class="modal-body"><p style="margin-top:0">${used.length} transaction(s) use this category. Move them to:</p>
      <select id="move-to" style="width:100%">${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <p class="hint">Budget amounts for "${esc(c.name)}" are removed. This is how you merge two categories.</p></div>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn danger solid" data-ok>Move & delete</button></div>`);
  m.querySelector('[data-ok]').onclick = () => {
    const to = $('#move-to', m).value; if (!to) return;
    store.batch(() => {
      used.forEach((t) => store.upsert('transactions', { ...t, categoryId: to }));
      store.all('budgets').filter((b) => b.categoryId === c.id).forEach((b) => store.remove('budgets', b.id));
      store.remove('categories', c.id);
    });
    Modal.close(); toast(`Moved ${used.length} transactions and deleted "${c.name}".`);
  };
}

/* ---------------- goals ---------------- */
function openGoalForm(g) {
  const isNew = !g;
  g = g ? { ...g } : { id: uid('g_'), name: '', target: '', targetDate: '', owner: 'shared', color: '#10b981', accountId: '', notes: '' };
  const m = Modal.open(`${Modal.head(isNew ? 'New goal' : 'Edit goal')}
    <form class="modal-body" id="goal-form"><div class="form-grid">
      <label class="field full">Goal name<input type="text" name="name" required value="${esc(g.name)}" placeholder="e.g. Emergency fund, Japan trip, Wedding"></label>
      <label class="field">Target amount (IDR)<input type="text" name="target" inputmode="decimal" data-money value="${g.target ? fmtInput(g.target) : ''}" placeholder="e.g. 50jt"></label>
      <label class="field">Target date<input type="date" name="targetDate" value="${g.targetDate || ''}"></label>
      <div class="field full"><span>Whose goal</span><div class="seg full" id="g-owner">${PERSON_IDS.map((p) => `<button type="button" data-o="${p}" class="${g.owner === p ? 'on' : ''}">${esc(pname(p))}</button>`).join('')}</div></div>
      <label class="field">Link to account (optional)<select name="accountId"><option value="">— track manually —</option>${store.all('accounts').map((a) => `<option value="${a.id}" ${g.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><span class="hint">Progress = that account's balance</span></label>
      <label class="field">Colour<input type="color" name="color" value="${g.color}"></label>
      ${isNew ? '<label class="field full">Already saved (optional)<input type="text" name="start" inputmode="decimal" data-money placeholder="e.g. 5jt or 750rb"></label>' : ''}
      <label class="field full">Notes<textarea name="notes" rows="2">${esc(g.notes || '')}</textarea></label>
    </div></form>
    <div class="modal-foot">${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button>`}<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Save</button></div>`);
  const form = $('#goal-form', m);
  let owner = g.owner;
  m.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { owner = b.dataset.o; m.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', x === b)); });
  const save = () => {
    const E = form.elements;
    const name = E.name.value.trim(); const target = parseAmount(E.target.value);
    if (!name) { toast('Please name your goal.', 'bad'); return; }
    if (!isFinite(target) || target <= 0) { toast('Please enter a target amount.', 'bad'); return; }
    if (E.targetDate.value && !isValidDate(E.targetDate.value)) { toast('Please pick a target date between 2000 and 2100.', 'bad'); return; }
    store.batch(() => {
      store.upsert('goals', { ...g, name, target: Math.round(target), targetDate: E.targetDate.value, owner, accountId: E.accountId.value, color: E.color.value, notes: E.notes.value.trim() });
      if (isNew && E.start && E.start.value.trim()) {
        const s = parseAmount(E.start.value);
        if (isFinite(s) && s) store.upsert('contributions', { id: uid('gc_'), goalId: g.id, date: todayStr(), amount: Math.round(s), person: owner, note: 'Starting amount' });
      }
    });
    Modal.close(); toast('Goal saved.');
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    Modal.close();
    if (!(await confirmBox(`Delete goal "${g.name}"?`, '<p>Its contribution history is deleted too. Transactions tagged to it stay (untagged).</p>'))) return;
    store.batch(() => {
      store.remove('goals', g.id);
      store.all('contributions').filter((c) => c.goalId === g.id).forEach((c) => store.remove('contributions', c.id));
      store.activeTx().filter((t) => t.goalId === g.id).forEach((t) => store.upsert('transactions', { ...t, goalId: '' }));
    });
  };
}
function openContributionForm(g) {
  if (!g) return;
  let sign = 1, person = me();
  const m = Modal.open(`${Modal.head(`Add money · ${esc(g.name)}`, `${money(goalSaved(g))} of ${money(g.target)} saved`)}
    <form class="modal-body" id="gc-form"><div class="seg full" style="margin-bottom:14px"><button type="button" class="on" data-s="1">Add</button><button type="button" data-s="-1">Withdraw</button></div>
    <div class="form-grid">
      <label class="field">Amount (IDR)<input type="text" name="amount" inputmode="decimal" data-money autofocus placeholder="e.g. 2jt or 500rb"></label>
      <label class="field">Date<input type="date" name="date" value="${todayStr()}"></label>
      <div class="field full"><span>Who</span><div class="seg full">${PERSON_IDS.map((p) => `<button type="button" data-p="${p}" class="${person === p ? 'on' : ''}">${esc(pname(p))}</button>`).join('')}</div></div>
      <label class="field full">Note<input type="text" name="note" placeholder="Optional"></label>
    </div></form>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Save</button></div>`);
  const form = $('#gc-form', m);
  m.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sign = +b.dataset.s; m.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); });
  m.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { person = b.dataset.p; m.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); });
  const save = () => {
    const a = parseAmount(form.elements.amount.value);
    if (!isFinite(a) || a <= 0) { toast('Please enter an amount.', 'bad'); return; }
    if (form.elements.date.value && !isValidDate(form.elements.date.value)) { toast('Please pick a date between 2000 and 2100.', 'bad'); return; }
    store.upsert('contributions', { id: uid('gc_'), goalId: g.id, date: form.elements.date.value || todayStr(), amount: Math.round(a) * sign, person, note: form.elements.note.value.trim() });
    Modal.close(); toast(sign > 0 ? 'Nice — money added to your goal.' : 'Withdrawal recorded.');
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
}

/* ---------------- accounts ---------------- */
function openAccountForm(a) {
  const isNew = !a;
  a = a ? { ...a } : { id: uid('a_'), name: '', type: 'bank', owner: me(), currency: 'IDR', opening: 0, openingDate: '', archived: false };
  let owner = a.owner;
  const m = Modal.open(`${Modal.head(isNew ? 'New account' : 'Edit account')}
    <form class="modal-body" id="acc-form"><div class="form-grid">
      <label class="field full">Name<input type="text" name="name" required value="${esc(a.name)}" placeholder="e.g. BCA Junior, GoPay Sabit, Joint savings"></label>
      <label class="field">Type<select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Currency<select name="currency">${CUR_CODES.map((c) => `<option ${a.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <div class="field full"><span>Owner</span><div class="seg full">${PERSON_IDS.map((p) => `<button type="button" data-o="${p}" class="${owner === p ? 'on' : ''}">${esc(pname(p))}</button>`).join('')}</div></div>
      <label class="field"><span class="opening-label">${isDebtAcc(a) ? 'Amount owed at start' : 'Starting balance'}</span><input type="text" name="opening" inputmode="decimal" data-money value="${a.opening ? fmtInput(isDebtAcc(a) ? Math.abs(a.opening) : a.opening, a.currency) : ''}" placeholder="e.g. 12,5jt"><span class="hint opening-hint">${isDebtAcc(a) ? 'What you owed on this card on that date' : 'Negative if the account is overdrawn'}</span></label>
      <label class="field">Balance on date<input type="date" name="openingDate" value="${a.openingDate || ''}"><span class="hint">Only transactions from this date on are counted</span></label>
      <label class="field debt-only">Credit limit<input type="text" name="limit" inputmode="decimal" data-money value="${a.limit ? fmtInput(a.limit, a.currency) : ''}" placeholder="e.g. 15jt (optional)"></label>
      <label class="field debt-only">Statement closing day<input type="number" name="closingDay" min="1" max="31" value="${a.closingDay || ''}" placeholder="e.g. 25"><span class="hint">Day of the month your statement is printed</span></label>
      <label class="field debt-only">Payment due day<input type="number" name="dueDay" min="1" max="31" value="${a.dueDay || ''}" placeholder="e.g. 10"><span class="hint">You'll get a reminder 7 days before</span></label>
      ${isNew ? '' : `<label class="check full"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Archived (hidden from lists)</label>`}
    </div></form>
    <div class="modal-foot">${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button>`}<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Save</button></div>`);
  const form = $('#acc-form', m);
  m.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { owner = b.dataset.o; m.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', x === b)); });
  const syncType = () => {
    const debt = isDebtAcc({ type: form.elements.type.value });
    m.querySelectorAll('.debt-only').forEach((el) => el.classList.toggle('hidden', !debt));
    m.querySelector('.opening-label').textContent = debt ? 'Amount owed at start' : 'Starting balance';
    m.querySelector('.opening-hint').textContent = debt ? 'What you owed on this card on that date' : 'Negative if the account is overdrawn';
  };
  form.elements.type.addEventListener('change', syncType); syncType();
  const save = () => {
    const E = form.elements;
    const name = E.name.value.trim(); if (!name) { toast('Please enter a name.', 'bad'); return; }
    let opening = E.opening.value.trim() ? parseAmount(E.opening.value) : 0;
    if (!isFinite(opening)) { toast('Starting balance is not a number.', 'bad'); return; }
    const debt = isDebtAcc({ type: E.type.value });
    if (debt) opening = -Math.abs(opening);
    const day = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 31 ? n : ''; };
    const limit = debt && E.limit.value.trim() ? parseAmount(E.limit.value) : '';
    if (limit !== '' && !isFinite(limit)) { toast('Credit limit is not a number.', 'bad'); return; }
    if (E.openingDate.value && !isValidDate(E.openingDate.value)) { toast('Please pick a starting date between 2000 and 2100.', 'bad'); return; }
    store.upsert('accounts', { ...a, name, type: E.type.value, currency: E.currency.value, owner, opening, openingDate: E.openingDate.value, archived: E.archived ? E.archived.checked : false,
      limit: debt ? limit : '', closingDay: debt ? day(E.closingDay.value) : '', dueDay: debt ? day(E.dueDay.value) : '' });
    Modal.close(); toast('Account saved.');
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
  const del = m.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    const used = store.activeTx().filter((t) => t.accountId === a.id || t.toAccountId === a.id);
    Modal.close();
    if (!(await confirmBox(`Delete "${a.name}"?`, used.length ? `<p>${used.length} transaction(s) use it. They'll be kept but without an account (balance adjustments/transfers for it are deleted). Consider <b>Archive</b> instead.</p>` : '<p>No transactions use it.</p>'))) return;
    store.batch(() => {
      used.forEach((t) => {
        if (t.type === 'adjustment' || t.type === 'transfer') store.remove('transactions', t.id);
        else store.upsert('transactions', { ...t, accountId: '' });
      });
      store.remove('accounts', a.id);
      store.all('goals').filter((g) => g.accountId === a.id).forEach((g) => store.upsert('goals', { ...g, accountId: '' }));
    });
  };
}
function openReconcile(a) {
  if (!a) return;
  const today = todayStr();
  const cur = accountBalance(a, today);
  const m = Modal.open(`${Modal.head(`Reconcile · ${esc(a.name)}`, 'Make the tracker match your real balance')}
    <form class="modal-body" id="rec-form">
      <p style="margin-top:0">Tracker balance today: <b>${fmt(cur, a.currency)}</b></p>
      <label class="field">Actual balance in your bank / app (${a.currency})<input type="text" name="actual" inputmode="decimal" data-money="${a.currency}" autofocus placeholder="${fmtInput(cur, a.currency)}"></label>
      <p class="hint">We'll add a "Balance adjustment" for the difference. It doesn't count as spending or income in reports.</p>
    </form>
    <div class="modal-foot"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${icon('check')} Adjust</button></div>`);
  const form = $('#rec-form', m);
  const save = () => {
    const v = parseAmount(form.elements.actual.value);
    if (!isFinite(v)) { toast('Please enter the actual balance.', 'bad'); return; }
    const diff = v - cur;
    if (Math.abs(diff) < 0.005) { Modal.close(); toast('Already matches — nothing to adjust.'); return; }
    store.upsert('transactions', { id: uid('t_'), type: 'adjustment', date: today, amount: diff, currency: a.currency, rate: rateOf(a.currency), description: 'Balance adjustment', categoryId: '', person: a.owner, accountId: a.id, notes: `Set to ${fmt(v, a.currency)}` });
    Modal.close(); toast(`Adjusted by ${fmt(diff, a.currency, { sign: true })}.`);
  };
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  m.querySelector('[data-save]').onclick = save;
}

/* ---------------- settings actions ---------------- */
async function fetchRates() {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR,JPY,SGD', { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status}`);
    const j = await r.json();
    const idr = j.rates.IDR;
    const rates = { ...store.data.settings.rates, USD: Math.round(idr * 100) / 100, JPY: Math.round((idr / j.rates.JPY) * 100) / 100, SGD: Math.round((idr / j.rates.SGD) * 100) / 100 };
    store.updateSettings({ rates, ratesDate: j.date });
    toast(`Rates updated (${j.date}).`);
  } catch (e) { toast('Could not fetch rates — enter them manually.', 'bad'); }
}
function readGhFields() {
  const v = (id) => ($(`#${id}`) || {}).value;
  cfg.github = { owner: (v('gh-owner') || '').trim(), repo: (v('gh-repo') || '').trim(), branch: (v('gh-branch') || 'main').trim(), path: (v('gh-path') || 'budget-data.json').trim(), token: (v('gh-token') || '').trim() };
  saveCfg();
}
async function ghTest(quiet = false) {
  readGhFields();
  if (!gh.configured()) { toast('Fill in owner, repo and token first.', 'bad'); return false; }
  try {
    const repo = await gh.testRepo();
    const canWrite = repo.permissions ? repo.permissions.push : true;
    if (!repo.private) toast('Warning: this repo is PUBLIC — anyone can read your finances. Make it private.', 'bad');
    else if (!canWrite) toast('Connected, but this token cannot write. Give it "Contents: Read and write".', 'bad');
    else if (!quiet) toast(`Connected to ${repo.full_name} (private, write access).`);
    return canWrite;
  } catch (e) { toast(e.message, 'bad'); return false; }
}
async function ghSave() {
  const ok = await ghTest(true);
  if (!ok) { App.render(); return; }
  const firstTime = !sync.meta.lastSync;
  sync.meta.dirty = true; sync.saveMeta();
  if (firstTime) sync.start(); // sets up timers on first connect
  cfg.localSince = ''; saveCfg();
  await sync.run();
  App.render();
  if (sync.state === 'error') toast(sync.meta.error || 'Sync failed', 'bad');
  else toast('Connected — your data is now synced with GitHub.');
}

function exportCSV() {
  const f = getFilter();
  const txs = filteredTx(f).sort((a, b) => a.date.localeCompare(b.date));
  const accs = store.accMap();
  const rows = [['Date', 'Type', 'Description', 'Category', 'Group', 'Person', 'Junior share %', 'Account', 'To account', 'Amount', 'Currency', 'Rate', 'Amount (IDR)', 'Admin fee', 'Notes', 'Flagged', 'Flag note']];
  for (const t of txs) {
    const c = catOf(t);
    rows.push([t.date, t.type, t.description || '', c ? c.name : '', c ? c.group : '', isSplit(t) ? 'Split' : pname(t.person), Math.round(shareOf(t, 'junior') * 100), (accs.get(t.accountId) || {}).name || '', (accs.get(t.toAccountId) || {}).name || '', t.amount, t.currency || 'IDR', t.rate || 1, txBase(t), Number(t.fee) || 0, t.notes || '', t.flagged ? 'yes' : '', t.flagNote || '']);
  }
  downloadFile(`transactions-${f.from}-to-${f.to}.csv`, '﻿' + toCSV(rows), 'text/csv');
  toast(`Exported ${txs.length} transactions (current filters).`);
}

/* ---------------- boot ---------------- */
document.addEventListener('DOMContentLoaded', () => App.init());
