'use strict';
/* =====================================================================
 * views.js — pages (dashboard, spending, budget, categories, goals,
 * balance, settings) and their charts
 * ===================================================================== */

/* ---------------- chart helpers ---------------- */
const Charts = {
  list: [],
  destroyAll() { this.list.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } }); this.list = []; },
  make(id, config) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!window.Chart) { el.parentElement.innerHTML = '<div class="empty small">Charts could not load (offline?). Numbers are still correct.</div>'; return null; }
    const c = new Chart(el, config);
    this.list.push(c);
    return c;
  },
};
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { text: v('--text'), muted: v('--muted'), border: v('--border'), good: v('--good'), bad: v('--bad'), warn: v('--warn'), primary: v('--primary'), surface: v('--surface'), surface3: v('--surface-3') };
}
function shortIDR(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${+(a / 1e9).toFixed(1)}M`;
  if (a >= 1e6) return `${s}${+(a / 1e6).toFixed(1)}jt`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)}rb`;
  return `${s}${Math.round(a)}`;
}
function baseChartOptions(extra = {}) {
  const c = themeColors();
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { size: 12 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.parsed.y ?? ctx.parsed)}` } },
    },
    scales: {
      x: { ticks: { color: c.muted, font: { size: 11 }, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { color: c.border } },
      y: { ticks: { color: c.muted, font: { size: 11 }, callback: (v) => shortIDR(v) }, grid: { color: c.border }, border: { display: false } },
    },
    ...extra,
  };
}
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* Time buckets for trend charts */
function buckets(f) {
  const days = daysBetween(f.from, f.to) + 1;
  const out = [];
  if (days <= 45) {
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) out.push({ key: d, label: fmtDate(d, false), from: d, to: d });
    return { unit: 'day', list: out, keyOf: (date) => date };
  }
  if (days <= 190) {
    const start = parseDateStr(f.from); const dow = (start.getDay() + 6) % 7; // Monday start
    let d = addDays(f.from, -dow);
    while (d <= f.to) { const e = addDays(d, 6); out.push({ key: d, label: fmtDate(d < f.from ? f.from : d, false), from: d, to: e }); d = addDays(d, 7); }
    return { unit: 'week', list: out, keyOf: (date) => { const x = parseDateStr(date); const w = (x.getDay() + 6) % 7; return addDays(date, -w); } };
  }
  for (const ym of monthsBetween(f.from.slice(0, 7), f.to.slice(0, 7))) out.push({ key: ym, label: fmtMonth(ym), from: `${ym}-01`, to: endOfMonth(ym) });
  return { unit: 'month', list: out, keyOf: (date) => date.slice(0, 7) };
}
function prevRange(f) {
  let r;
  const fm = f.from.slice(0, 7), tm = f.to.slice(0, 7);
  if (f.from.endsWith('-01') && f.to === endOfMonth(tm)) {
    const n = monthsBetween(fm, tm).length;
    r = { from: `${addMonths(fm, -n)}-01`, to: endOfMonth(addMonths(tm, -n)) };
  } else {
    const len = daysBetween(f.from, f.to) + 1;
    r = { from: addDays(f.from, -len), to: addDays(f.from, -1) };
  }
  const today = todayStr();
  if (f.from <= today && f.to > today) { // period in progress: compare same elapsed days
    const el = daysBetween(f.from, today);
    const cut = addDays(r.from, el);
    if (cut < r.to) r.to = cut;
    r.partial = true;
  }
  return r;
}
function deltaHTML(cur, prev, goodWhenUp = true) {
  if (!prev) return '<span class="muted">no data last period</span>';
  const d = (cur - prev) / Math.abs(prev);
  const up = d >= 0;
  const cls = Math.abs(d) < 0.005 ? 'muted' : (up === goodWhenUp ? 'good' : 'bad');
  return `<span class="${cls}">${up ? '▲' : '▼'} ${pct(Math.abs(d))}</span> <span class="muted">vs last period</span>`;
}
function accountsForPerson(person) { return store.all('accounts').filter((a) => !a.archived && (person === 'all' || a.owner === person)); }
function progressBar(ratio, lg = false) {
  const cls = ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : 'ok';
  return `<div class="progress ${lg ? 'lg' : ''}"><span class="${cls}" style="width:${clamp(ratio * 100, 0, 100).toFixed(1)}%"></span></div>`;
}
function emptyState(title, text, btn = '') { return `<div class="empty"><h4>${title}</h4><div>${text}</div>${btn ? `<div style="margin-top:12px">${btn}</div>` : ''}</div>`; }
function amountCell(t) {
  const base = txBase(t);
  let cls = 'amt-out', sign = '';
  if (t.type === 'income') { cls = 'amt-in'; sign = '+'; }
  if (t.type === 'transfer') cls = 'amt-tr';
  if (t.type === 'adjustment') { cls = 'amt-tr'; sign = base >= 0 ? '+' : ''; }
  const orig = t.currency && t.currency !== 'IDR' ? `<span class="orig">${fmt(t.amount, t.currency)}</span>` : '';
  return `<span class="${cls}">${sign}${money(base)}</span>${orig}`;
}
function txTitle(t) {
  if (t.description) return esc(t.description);
  if (t.type === 'transfer') return 'Transfer';
  if (t.type === 'adjustment') return 'Balance adjustment';
  const c = catOf(t); return c ? esc(c.name) : '(no description)';
}
function txCatCell(t) {
  if (t.type === 'transfer') {
    const a = store.accMap(); return `<span class="chip">${icon('transfer')} ${esc((a.get(t.accountId) || {}).name || '?')} → ${esc((a.get(t.toAccountId) || {}).name || '?')}</span>`;
  }
  if (t.type === 'adjustment') return `<span class="chip">${icon('scale')} Adjustment</span>`;
  return catChip(t.categoryId);
}

const Views = {};

/* ================= DASHBOARD ================= */
Views.dashboard = () => {
  const f = getFilter();
  const txs = filteredTx(f);
  const S = summarize(txs);
  const pr = prevRange(f);
  const P = summarize(filteredTx({ ...f, ...pr }));
  const B = budgetForRange(f);
  const today = todayStr();
  const asOf = f.to < today ? f.to : today;
  const accs = accountsForPerson(f.person);
  const balance = sum(accs, (a) => accountBalanceIDR(a, asOf));
  const budgetLeft = B.total - S.outflow;
  const used = B.total ? S.outflow / B.total : 0;
  const saveRate = S.income ? (S.income - S.spend) / S.income : NaN;

  if (!store.activeTx().length) {
    return `<div class="card">${emptyState('Welcome! Let\'s get your numbers in.',
      'Import the last two months from your Google Sheet, or start adding spending. Then set a monthly budget and your goals.',
      `<button class="btn primary" data-action="import">${icon('upload')} Import from Google Sheets / CSV</button> <button class="btn" data-action="add-tx">${icon('plus')} Add a transaction</button>`)}</div>`;
  }

  // insights
  const inProgress = f.from <= today && f.to >= today;
  const elapsed = inProgress ? daysBetween(f.from, today) + 1 : daysBetween(f.from, f.to) + 1;
  const daysLeft = inProgress ? daysBetween(today, f.to) + 1 : 0;
  const topCat = Object.entries(S.byCat).sort((a, b) => b[1] - a[1])[0];
  const insights = [];
  insights.push(`<div class="insight"><b>${money(S.spend / Math.max(1, elapsed))}</b><span>average spending per day</span></div>`);
  if (inProgress && B.total) insights.push(`<div class="insight"><b class="${budgetLeft < 0 ? 'bad' : ''}">${budgetLeft > 0 ? money(budgetLeft / daysLeft) : money(0)}</b><span>safe to spend per day · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span></div>`);
  if (topCat) { const c = store.catMap().get(topCat[0]); insights.push(`<div class="insight"><b>${esc(c ? c.name : 'Uncategorized')}</b><span>biggest category · ${money(topCat[1], { compact: true })} (${pct(topCat[1] / (S.outflow || 1))})</span></div>`); }
  if (f.person === 'all' && S.outflow) insights.push(`<div class="insight"><b>${PERSON_IDS.map((p) => `${esc(pname(p))} ${pct((S.byPerson[p] || 0) / S.outflow)}`).join(' · ')}</b><span>share of spending</span></div>`);

  const kpi = (label, value, sub, extra = '') => `<div class="card kpi"><span class="kpi-label">${label}</span><span class="kpi-value" title="${esc(value)}">${value}</span><span class="kpi-sub">${sub}</span>${extra}</div>`;

  // budget rows
  const catRows = Object.keys({ ...B.perCat, ...S.byCat }).map((id) => ({ id, c: store.catMap().get(id), budget: B.perCat[id] || 0, actual: S.byCat[id] || 0 }))
    .filter((r) => r.c && r.c.type === 'expense' && (r.budget || r.actual))
    .sort((a, b) => (b.budget ? b.actual / b.budget : 9) - (a.budget ? a.actual / a.budget : 9) || b.actual - a.actual).slice(0, 8);

  const recent = [...txs].sort((a, b) => (b.date + (b.createdAt || b.updatedAt || '')).localeCompare(a.date + (a.createdAt || a.updatedAt || ''))).slice(0, 7);
  const biggest = txs.filter((t) => t.type === 'expense').sort((a, b) => txBase(b) - txBase(a)).slice(0, 5);
  const goals = store.all('goals').filter((g) => f.person === 'all' || g.owner === f.person || g.owner === 'shared').slice(0, 4);

  const catTotal = Object.values(S.byCat).reduce((a, b) => a + b, 0);
  const catList = Object.entries(S.byCat).sort((a, b) => b[1] - a[1]);

  return `
  <div class="grid kpis">
    ${kpi('Income', money(S.income, { compact: true }), deltaHTML(S.income, P.income, true))}
    ${kpi('Spending', money(S.spend, { compact: true }), deltaHTML(S.spend, P.spend, false))}
    ${kpi('Saved & invested', money(S.saved, { compact: true }), isFinite(saveRate) ? `Kept <b>${pct(saveRate)}</b> of income` : 'no income in period')}
    ${kpi(B.total ? 'Budget left' : 'Budget', B.total ? `<span class="${budgetLeft < 0 ? 'bad' : ''}">${money(budgetLeft, { compact: true })}</span>` : '–',
    B.total ? `${pct(used)} of ${money(B.total, { compact: true })} used` : '<a href="#budget">Set a budget →</a>', B.total ? progressBar(used) : '')}
    ${kpi('Current balance', money(balance, { compact: true }), `${accs.length} account${accs.length === 1 ? '' : 's'} · ${asOf === today ? 'today' : fmtDate(asOf)}`)}
  </div>
  <div class="card section-gap"><div class="insights">${insights.join('')}</div></div>

  <div class="grid cols-2-1 section-gap">
    <div class="card">
      <div class="card-head"><h3>Spending over time</h3><span class="sub">${S.count} transactions</span>
        <div class="right"><div class="seg">
          <button class="${ui.dashTrend !== 'flow' ? 'on' : ''}" data-action="dash-trend" data-v="person">By person</button>
          <button class="${ui.dashTrend === 'flow' ? 'on' : ''}" data-action="dash-trend" data-v="flow">Income vs spending</button>
        </div></div></div>
      <div class="chart-box tall"><canvas id="ch-trend"></canvas></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>By category</h3><span class="sub">tap to filter</span></div>
      ${catList.length ? `<div class="chart-box short"><canvas id="ch-cat"></canvas></div>
      <div class="legend-list">${catList.slice(0, 8).map(([id, v]) => { const c = store.catMap().get(id) || { name: 'Uncategorized', color: '#94a3b8' }; return `<div class="lg" data-action="filter-cat" data-id="${id}"><span class="dot" style="background:${c.color}"></span><span class="n">${esc(c.name)}</span><span class="num">${money(v, { compact: true })}</span><span class="p">${pct(v / catTotal)}</span></div>`; }).join('')}
      ${catList.length > 8 ? `<div class="small muted" style="padding:4px">+ ${catList.length - 8} more</div>` : ''}</div>` : emptyState('No spending', 'Nothing matches these filters.')}
    </div>
  </div>

  <div class="grid cols-3 section-gap">
    <div class="card">
      <div class="card-head"><h3>Budget vs actual</h3><div class="right"><a class="small" href="#budget">Plan →</a></div></div>
      ${catRows.length ? catRows.map((r) => `<div class="budget-row"><div class="nowrap" style="overflow:hidden;text-overflow:ellipsis"><span class="dot" style="background:${r.c.color}"></span> ${esc(r.c.name)}</div>
        <div class="small num nowrap"><b class="${r.budget && r.actual > r.budget ? 'bad' : ''}">${money(r.actual, { compact: true })}</b> <span class="muted">/ ${r.budget ? money(r.budget, { compact: true }) : 'no budget'}</span></div>
        ${progressBar(r.budget ? r.actual / r.budget : (r.actual ? 1.01 : 0))}</div>`).join('') : emptyState('No budget yet', 'Set monthly amounts per category on the Budget page.', '<a class="btn sm" href="#budget">Plan budget</a>')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Needs · Wants · Savings</h3><span class="sub">share of income</span></div>
      <div class="chart-box short"><canvas id="ch-nws"></canvas></div>
      <div class="legend-list">
        ${[['Needs', 0.5], ['Wants', 0.3], ['Savings', 0.2]].map(([g, target]) => { const v = S.byGroup[g] || 0; const share = S.income ? v / S.income : NaN; return `<div class="lg" style="grid-template-columns:12px 1fr auto 70px;cursor:default"><span class="dot" style="background:${GROUP_COLORS[g]}"></span><span class="n">${g}</span><span class="num">${money(v, { compact: true })}</span><span class="p">${isFinite(share) ? pct(share) : '–'} <span class="small">/ ${pct(target)}</span></span></div>`; }).join('')}
      </div>
      <div class="hint" style="margin-top:6px">Compared with the 50 / 30 / 20 rule of thumb.</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Who spent what</h3></div>
      <div class="chart-box short"><canvas id="ch-person"></canvas></div>
      <div class="legend-list">${PERSON_IDS.map((p) => `<div class="lg" data-action="filter-person" data-id="${p}"><span class="dot" style="background:${pcolor(p)}"></span><span class="n">${esc(pname(p))}</span><span class="num">${money(S.byPerson[p] || 0, { compact: true })}</span><span class="p">${pct((S.byPerson[p] || 0) / (S.outflow || 1))}</span></div>`).join('')}</div>
    </div>
  </div>

  <div class="grid cols-3 section-gap">
    <div class="card">
      <div class="card-head"><h3>Goals</h3><div class="right"><a class="small" href="#goals">All goals →</a></div></div>
      ${goals.length ? goals.map((g) => { const saved = goalSaved(g); const r = g.target ? saved / g.target : 0; return `<div class="budget-row"><div class="nowrap" style="overflow:hidden;text-overflow:ellipsis"><b>${esc(g.name)}</b> <span class="small muted">${esc(pname(g.owner))}</span></div><div class="small num nowrap"><b>${pct(r)}</b> <span class="muted">of ${money(g.target, { compact: true })}</span></div><div class="progress"><span style="width:${clamp(r * 100, 0, 100)}%;background:${g.color || 'var(--primary)'}"></span></div></div>`; }).join('') : emptyState('No goals yet', 'Emergency fund, holiday, wedding, house…', '<a class="btn sm" href="#goals">Add a goal</a>')}
    </div>
    <div class="card">
      <div class="card-head"><h3>Recent</h3><div class="right"><a class="small" href="#log">All →</a></div></div>
      <div class="list">${recent.map((t) => `<div class="list-row" data-action="edit-tx" data-id="${t.id}" style="cursor:pointer"><span class="dot" style="background:${(catOf(t) || {}).color || '#94a3b8'}"></span><div class="grow"><div class="title">${txTitle(t)}</div><div class="meta">${fmtDate(t.date, false)} · ${esc(pname(t.person))}</div></div><div class="amount">${amountCell(t)}</div></div>`).join('') || '<div class="muted small">No transactions.</div>'}</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Largest expenses</h3></div>
      <div class="list">${biggest.map((t) => `<div class="list-row" data-action="edit-tx" data-id="${t.id}" style="cursor:pointer"><span class="dot" style="background:${(catOf(t) || {}).color || '#94a3b8'}"></span><div class="grow"><div class="title">${txTitle(t)}</div><div class="meta">${fmtDate(t.date, false)} · ${esc((catOf(t) || {}).name || '')}</div></div><div class="amount">${amountCell(t)}</div></div>`).join('') || '<div class="muted small">No expenses.</div>'}</div>
    </div>
  </div>`;
};
Views.dashboard.after = () => {
  const f = getFilter();
  const txs = filteredTx(f);
  if (!store.activeTx().length) return;
  const S = summarize(txs);
  const c = themeColors();
  const bk = buckets(f);
  const idx = new Map(bk.list.map((b, i) => [b.key, i]));
  const labels = bk.list.map((b) => b.label);
  if (ui.dashTrend === 'flow') {
    const inc = new Array(bk.list.length).fill(0), out = new Array(bk.list.length).fill(0);
    for (const t of txs) { const i = idx.get(bk.keyOf(t.date)); if (i === undefined) continue; if (t.type === 'income') inc[i] += txBase(t); else if (t.type === 'expense') out[i] += txBase(t); }
    Charts.make('ch-trend', { type: 'bar', data: { labels, datasets: [
      { label: 'Income', data: inc, backgroundColor: hexA('#16a34a', 0.75), borderRadius: 4 },
      { label: 'Spending', data: out, backgroundColor: hexA('#f97316', 0.8), borderRadius: 4 },
    ] }, options: baseChartOptions() });
  } else {
    const series = PERSON_IDS.map(() => new Array(bk.list.length).fill(0));
    for (const t of txs) {
      if (t.type !== 'expense') continue;
      const i = idx.get(bk.keyOf(t.date)); if (i === undefined) continue;
      const p = PERSON_IDS.indexOf(t.person); series[p < 0 ? 2 : p][i] += txBase(t);
    }
    const B = [];
    // cumulative budget pace line (only for daily view with a budget)
    const datasets = PERSON_IDS.map((p, k) => ({ label: pname(p), data: series[k], backgroundColor: hexA(pcolor(p), 0.8), borderRadius: 3, stack: 's' }));
    const opts = baseChartOptions();
    opts.scales.x.stacked = true; opts.scales.y.stacked = true;
    if (bk.unit === 'day') {
      const budget = budgetForRange(f).total;
      if (budget) {
        let run = 0; const cum = series[0].map((_, i) => (run += series[0][i] + series[1][i] + series[2][i]));
        const today = todayStr();
        datasets.push({ type: 'line', label: 'Cumulative', data: cum.map((v, i) => (bk.list[i].key <= today ? v : null)), borderColor: c.text, borderWidth: 2, pointRadius: 0, yAxisID: 'y2', tension: 0.2 });
        datasets.push({ type: 'line', label: 'Budget pace', data: cum.map((_, i) => (budget * (i + 1)) / bk.list.length), borderColor: c.muted, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y2' });
        opts.scales.y2 = { position: 'right', ticks: { color: c.muted, font: { size: 11 }, callback: (v) => shortIDR(v) }, grid: { display: false }, border: { display: false } };
      }
    }
    Charts.make('ch-trend', { type: 'bar', data: { labels, datasets }, options: opts });
    void B;
  }
  const catList = Object.entries(S.byCat).sort((a, b) => b[1] - a[1]);
  if (catList.length) {
    const top = catList.slice(0, 8); const rest = catList.slice(8).reduce((a, [, v]) => a + v, 0);
    const cats = top.map(([id]) => store.catMap().get(id) || { name: 'Uncategorized', color: '#94a3b8' });
    Charts.make('ch-cat', { type: 'doughnut', data: { labels: [...cats.map((x) => x.name), ...(rest ? ['Other'] : [])], datasets: [{ data: [...top.map(([, v]) => v), ...(rest ? [rest] : [])], backgroundColor: [...cats.map((x) => x.color), ...(rest ? ['#cbd5e1'] : [])], borderColor: c.surface, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.parsed)}` } } },
        onClick: (_, els) => { if (els[0] && top[els[0].index]) App.setCatFilter(top[els[0].index][0]); } } });
  }
  const nws = ['Needs', 'Wants', 'Savings'];
  const optsNws = baseChartOptions({ indexAxis: 'y' });
  optsNws.plugins.legend.display = false;
  optsNws.scales = { x: { ticks: { color: c.muted, font: { size: 11 }, callback: (v) => shortIDR(v) }, grid: { color: c.border }, border: { display: false } }, y: { ticks: { color: c.muted }, grid: { display: false } } };
  optsNws.plugins.tooltip = { callbacks: { label: (ctx) => money(ctx.parsed.x) } };
  Charts.make('ch-nws', { type: 'bar', data: { labels: [...nws, 'Income'], datasets: [{ data: [...nws.map((g) => S.byGroup[g] || 0), S.income], backgroundColor: [...nws.map((g) => GROUP_COLORS[g]), hexA('#16a34a', 0.35)], borderRadius: 5 }] }, options: optsNws });

  const optsP = JSON.parse(JSON.stringify(optsNws));
  optsP.scales.x.ticks.callback = (v) => shortIDR(v);
  optsP.plugins.tooltip = { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.parsed.x)}` } };
  optsP.plugins.legend = { display: true, position: 'bottom', labels: { color: c.text, boxWidth: 10, boxHeight: 10, font: { size: 11 } } };
  optsP.scales.x.stacked = true; optsP.scales.y.stacked = true;
  optsP.indexAxis = 'y';
  const byPG = {}; for (const t of txs) { if (t.type !== 'expense') continue; const g = groupOf(t); byPG[t.person] = byPG[t.person] || {}; byPG[t.person][g] = (byPG[t.person][g] || 0) + txBase(t); }
  Charts.make('ch-person', { type: 'bar', data: { labels: PERSON_IDS.map(pname), datasets: nws.map((g) => ({ label: g, data: PERSON_IDS.map((p) => (byPG[p] || {})[g] || 0), backgroundColor: GROUP_COLORS[g], borderRadius: 3 })) }, options: optsP });
};

/* ================= SPENDING (transactions) ================= */
Views.spending = () => {
  const f = getFilter();
  const q = ui.tx.q.trim().toLowerCase();
  let txs = filteredTx(f).filter((t) => (ui.tx.type === 'all' || t.type === ui.tx.type || (ui.tx.type === 'transfer' && t.type === 'adjustment'))
    && (ui.tx.account === 'all' || t.accountId === ui.tx.account || t.toAccountId === ui.tx.account));
  if (q) {
    txs = txs.filter((t) => {
      const hay = `${t.description || ''} ${t.notes || ''} ${(catOf(t) || {}).name || ''} ${pname(t.person)} ${(store.accMap().get(t.accountId) || {}).name || ''} ${t.amount}`.toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }
  const dir = ui.tx.dir;
  const key = ui.tx.sort;
  const cmp = {
    date: (a, b) => a.date.localeCompare(b.date) || (a.createdAt || a.updatedAt || '').localeCompare(b.createdAt || b.updatedAt || ''),
    amount: (a, b) => txBase(a) - txBase(b),
    description: (a, b) => (a.description || '').localeCompare(b.description || ''),
    category: (a, b) => ((catOf(a) || {}).name || '').localeCompare((catOf(b) || {}).name || ''),
    person: (a, b) => pname(a.person).localeCompare(pname(b.person)),
  }[key] || (() => 0);
  txs.sort((a, b) => dir * cmp(a, b));
  const S = summarize(txs);
  const shown = txs.slice(0, ui.tx.limit);
  const sel = App.sel;
  const allSel = shown.length && shown.every((t) => sel.has(t.id));
  const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-action="tx-sort" data-k="${k}">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const accs = store.all('accounts');
  return `
  <div class="toolbar">
    <div class="search">${icon('search')}<input type="search" id="tx-q" placeholder="Search description, notes, amount…" value="${esc(ui.tx.q)}"></div>
    <div class="seg">${[['all', 'All'], ['expense', 'Spending'], ['income', 'Income'], ['transfer', 'Transfers']].map(([v, l]) => `<button class="${ui.tx.type === v ? 'on' : ''}" data-action="tx-type" data-v="${v}">${l}</button>`).join('')}</div>
    <select id="tx-acc" title="Account"><option value="all">All accounts</option>${accs.map((a) => `<option value="${a.id}" ${ui.tx.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    <span class="grow"></span>
    <button class="btn" data-action="import">${icon('upload')}<span class="hide-sm">Import</span></button>
    <button class="btn" data-action="export-csv">${icon('download')}<span class="hide-sm">Export</span></button>
    <button class="btn primary" data-action="add-tx">${icon('plus')} Add</button>
  </div>
  ${sel.size ? `<div class="bulkbar"><b>${sel.size} selected</b>
    <select id="bulk-cat"><option value="">Set category…</option>${store.categories().map((c) => `<option value="${c.id}">${esc(c.name)} (${c.type === 'income' ? 'income' : c.group})</option>`).join('')}</select>
    <select id="bulk-person"><option value="">Set person…</option>${PERSON_IDS.map((p) => `<option value="${p}">${esc(pname(p))}</option>`).join('')}</select>
    <select id="bulk-acc"><option value="">Set account…</option><option value="__none__">— none —</option>${accs.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
    <button class="btn sm danger" data-action="bulk-delete">${icon('trash')} Delete</button>
    <button class="btn sm ghost" data-action="bulk-clear">Clear</button></div>` : ''}
  <div class="card">
    <div class="card-head"><h3>${txs.length} transaction${txs.length === 1 ? '' : 's'}</h3>
      <span class="sub">Spending <b>${money(S.spend + S.saved)}</b> · Income <b class="good">${money(S.income)}</b> · Net <b class="${S.net < 0 ? 'bad' : 'good'}">${money(S.net)}</b></span></div>
    ${txs.length ? `<div class="table-wrap"><table class="t tx">
      <thead><tr><th class="c" style="width:30px"><input type="checkbox" class="check" data-action="sel-all" ${allSel ? 'checked' : ''} aria-label="Select all"></th>
        ${th('date', 'Date')}${th('description', 'Description')}${th('category', 'Category')}${th('person', 'Person')}<th>Account</th>${th('amount', 'Amount', 'r')}<th></th></tr></thead>
      <tbody>${shown.map((t) => `<tr class="${sel.has(t.id) ? 'sel' : ''}">
        <td class="c cb"><input type="checkbox" class="check" data-action="sel" data-id="${t.id}" ${sel.has(t.id) ? 'checked' : ''} aria-label="Select"></td>
        <td class="nowrap d-date">${fmtDate(t.date)}</td>
        <td class="d-desc" data-action="edit-tx" data-id="${t.id}" style="cursor:pointer"><div class="desc">${txTitle(t)}</div>${t.notes ? `<div class="note">${esc(t.notes)}</div>` : ''}</td>
        <td class="d-cat">${txCatCell(t)}</td>
        <td class="d-person">${personChip(t.person)}</td>
        <td class="d-acc small muted">${esc((store.accMap().get(t.accountId) || {}).name || '')}</td>
        <td class="d-meta small muted">${fmtDate(t.date, false)} ${txCatCell(t)} ${personChip(t.person)}</td>
        <td class="r nowrap d-amt">${amountCell(t)}</td>
        <td class="r d-act"><button class="btn ghost sm icon" data-action="edit-tx" data-id="${t.id}" aria-label="Edit">${icon('edit')}</button></td>
      </tr>`).join('')}</tbody></table></div>
      ${txs.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-action="tx-more">Show more (${txs.length - shown.length} left)</button></div>` : ''}`
    : emptyState('No transactions here', 'Try a wider date range or clear filters — or add one.', `<button class="btn primary" data-action="add-tx">${icon('plus')} Add transaction</button>`)}
  </div>`;
};
Views.spending.after = () => {
  const q = $('#tx-q');
  if (q) q.addEventListener('input', debounce(() => { ui.tx.q = q.value; ui.tx.limit = 100; App.render({ keepFocus: 'tx-q' }); }, 250));
  const acc = $('#tx-acc');
  if (acc) acc.onchange = () => { ui.tx.account = acc.value; saveUI(); App.render(); };
  const bulk = (id, fn) => { const el = $(id); if (el) el.onchange = () => { if (!el.value) return; fn(el.value); }; };
  bulk('#bulk-cat', (v) => {
    const c = store.catMap().get(v);
    store.batch(() => App.sel.forEach((id) => { const t = store.get('transactions', id); if (t && (t.type === 'expense' || t.type === 'income')) store.upsert('transactions', { ...t, categoryId: v, type: c.type }); }));
    toast(`Updated ${App.sel.size} transactions.`);
  });
  bulk('#bulk-person', (v) => { store.batch(() => App.sel.forEach((id) => { const t = store.get('transactions', id); if (t) store.upsert('transactions', { ...t, person: v }); })); toast('Updated.'); });
  bulk('#bulk-acc', (v) => { store.batch(() => App.sel.forEach((id) => { const t = store.get('transactions', id); if (t) store.upsert('transactions', { ...t, accountId: v === '__none__' ? '' : v }); })); toast('Updated.'); });
};

/* ================= BUDGET ================= */
Views.budget = () => {
  const f = getFilter();
  const ym = ui.budgetMonth || (f.to.slice(0, 7) < thisMonth() ? f.to.slice(0, 7) : (f.from.slice(0, 7) > thisMonth() ? f.from.slice(0, 7) : thisMonth()));
  ui.budgetMonth = ym;
  const { src, inherited } = budgetsFor(ym);
  const mf = { from: `${ym}-01`, to: endOfMonth(ym), person: f.person, cats: f.cats };
  const txs = filteredTx(mf);
  const actual = {};
  for (const t of txs) if (t.type === 'expense' || t.type === 'income') actual[t.categoryId] = (actual[t.categoryId] || 0) + txBase(t);
  const cats = store.categories().filter((c) => !f.cats || f.cats.has(c.id));
  const cols = PERSON_IDS;
  const planned = (c) => (f.person === 'all' ? budgetCell(ym, c.id, 'all') : budgetCell(ym, c.id, f.person));
  const sections = [['Income', cats.filter((c) => c.type === 'income')], ...GROUPS.map((g) => [g, cats.filter((c) => c.type === 'expense' && c.group === g)])];
  const tot = { incomePlan: 0, incomeAct: 0, expPlan: 0, expAct: 0, savPlan: 0, savAct: 0 };
  for (const c of cats) {
    const p = planned(c), a = actual[c.id] || 0;
    if (c.type === 'income') { tot.incomePlan += p; tot.incomeAct += a; } else { tot.expPlan += p; tot.expAct += a; if (c.group === 'Savings') { tot.savPlan += p; tot.savAct += a; } }
  }
  const unalloc = tot.incomePlan - tot.expPlan;
  const isPast = ym < thisMonth();
  const rowHTML = (c) => {
    const p = planned(c), a = actual[c.id] || 0;
    const left = p - a; const isInc = c.type === 'income';
    const ratio = p ? a / p : (a ? 1.01 : 0);
    return `<tr>
      <td class="nowrap"><span class="dot" style="background:${c.color}"></span> ${esc(c.name)}</td>
      ${cols.map((pid) => { const v = budgetCell(ym, c.id, pid); return `<td class="r ${f.person !== 'all' && f.person !== pid ? 'hide-sm' : ''}" ${f.person !== 'all' && f.person !== pid ? 'style="opacity:.45"' : ''}><input class="cell ${inherited ? 'inherited' : ''}" inputmode="decimal" data-bud="${c.id}|${pid}" value="${v ? fmtInput(v) : ''}" placeholder="0" aria-label="${esc(c.name)} budget for ${esc(pname(pid))}"></td>`; }).join('')}
      <td class="r num"><b>${money(p)}</b></td>
      <td class="r num">${money(a)}</td>
      <td class="r num ${!isInc && left < 0 ? 'bad' : ''} ${isInc && left > 0 && isPast ? 'warn' : ''}">${isInc ? money(a - p, { sign: true }) : money(left)}</td>
      <td style="min-width:110px">${isInc ? progressBar(Math.min(ratio, 1)).replace(/class="(ok|near|over)"/, 'class="ok"') : progressBar(ratio)}</td>
    </tr>`;
  };
  return `
  <div class="toolbar">
    <button class="btn icon" data-action="bud-month" data-d="-1" aria-label="Previous month">${icon('left')}</button>
    <input type="month" id="bud-month" value="${ym}">
    <button class="btn icon" data-action="bud-month" data-d="1" aria-label="Next month">${icon('right')}</button>
    <span class="grow"></span>
    <button class="btn" data-action="bud-copy">${icon('copy')} Copy last month</button>
    <button class="btn" data-action="bud-from-actual" title="Use last month's actual spending as this month's plan">${icon('refresh')} Use last month's actuals</button>
    <button class="btn danger" data-action="bud-clear">${icon('trash')} Clear month</button>
  </div>
  ${inherited ? `<div class="banner info">${icon('info')}<div class="grow small">No budget saved for <b>${fmtMonth(ym, true)}</b> yet, so it's using <b>${fmtMonth(src, true)}</b>'s plan (budgets roll forward). Editing any amount saves a copy for ${fmtMonth(ym, true)}.</div></div>` : ''}
  ${!src ? `<div class="banner info">${icon('info')}<div class="grow small"><b>Plan your month:</b> type how much each of you expects to earn and spend per category. Use <b>${esc(pname('shared'))}</b> for joint costs like rent and groceries. The plan carries forward to later months until you change it. Tip: "1,5jt" or "750rb" work too.</div></div>` : ''}
  <div class="grid kpis k4">
    <div class="card kpi"><span class="kpi-label">Planned income</span><span class="kpi-value">${money(tot.incomePlan, { compact: true })}</span><span class="kpi-sub">actual ${money(tot.incomeAct, { compact: true })}</span></div>
    <div class="card kpi"><span class="kpi-label">Planned spending</span><span class="kpi-value">${money(tot.expPlan - tot.savPlan, { compact: true })}</span><span class="kpi-sub">actual ${money(tot.expAct - tot.savAct, { compact: true })}</span>${progressBar((tot.expPlan - tot.savPlan) ? (tot.expAct - tot.savAct) / (tot.expPlan - tot.savPlan) : 0)}</div>
    <div class="card kpi"><span class="kpi-label">Planned savings</span><span class="kpi-value">${money(tot.savPlan, { compact: true })}</span><span class="kpi-sub">actual ${money(tot.savAct, { compact: true })}</span></div>
    <div class="card kpi"><span class="kpi-label">${unalloc >= 0 ? 'Not yet allocated' : 'Over-allocated'}</span><span class="kpi-value ${unalloc < 0 ? 'bad' : ''}">${money(unalloc, { compact: true })}</span><span class="kpi-sub">income − planned outflow</span></div>
  </div>
  <div class="card section-gap">
    <div class="card-head"><h3>${fmtMonth(ym, true)} plan</h3><span class="sub">${f.person === 'all' ? 'Totals for both of you' : `Showing ${esc(pname(f.person))}'s plan & actuals`}${f.cats ? ' · filtered categories' : ''}</span></div>
    <div class="table-wrap"><table class="t">
      <thead><tr><th>Category</th>${cols.map((p) => `<th class="r ${f.person !== 'all' && f.person !== p ? 'hide-sm' : ''}"><span class="dot" style="background:${pcolor(p)}"></span> ${esc(pname(p))}</th>`).join('')}<th class="r">Plan</th><th class="r">Actual</th><th class="r">Left</th><th></th></tr></thead>
      <tbody>
      ${sections.filter(([, list]) => list.length).map(([g, list]) => {
    const pSum = sum(list, planned), aSum = sum(list, (c) => actual[c.id] || 0);
    return `<tr class="group"><td colspan="${cols.length + 1}">${g}</td><td class="r">${money(pSum)}</td><td class="r">${money(aSum)}</td><td class="r">${g === 'Income' ? money(aSum - pSum, { sign: true }) : money(pSum - aSum)}</td><td></td></tr>${list.map(rowHTML).join('')}`;
  }).join('')}
      </tbody></table></div>
  </div>
  <div class="card section-gap">
    <div class="card-head"><h3>Budget vs actual by month</h3><span class="sub">spending, over the selected date range</span></div>
    <div class="chart-box"><canvas id="ch-bud"></canvas></div>
  </div>`;
};
Views.budget.after = () => {
  const m = $('#bud-month');
  if (m) m.onchange = () => { if (m.value) { ui.budgetMonth = m.value; saveUI(); App.render(); } };
  $$('input[data-bud]').forEach((inp) => {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('change', () => {
      const [catId, pid] = inp.dataset.bud.split('|');
      const v = inp.value.trim() === '' ? 0 : parseAmount(inp.value);
      if (!isFinite(v) || v < 0) { toast('Please enter a valid amount, e.g. 1500000, 1.500.000 or 1,5jt', 'bad'); inp.value = ''; return; }
      const month = ui.budgetMonth;
      // let focus move to the next cell (Tab) before re-rendering, so it is kept
      setTimeout(() => App.setBudget(month, catId, pid, Math.round(v)), 0);
    });
  });
  const f = getFilter();
  const months = monthsBetween(f.from.slice(0, 7), f.to.slice(0, 7)).slice(-24);
  const bud = [], act = [];
  for (const ym of months) {
    const mf = { from: `${ym}-01`, to: endOfMonth(ym), person: f.person, cats: f.cats };
    bud.push(budgetForRange(mf).total);
    act.push(sum(filteredTx(mf).filter((t) => t.type === 'expense'), txBase));
  }
  const c = themeColors();
  Charts.make('ch-bud', { type: 'bar', data: { labels: months.map((x) => fmtMonth(x)), datasets: [
    { label: 'Budget', data: bud, backgroundColor: hexA('#94a3b8', 0.25), borderColor: c.muted, borderWidth: 1.5, borderRadius: 4 },
    { label: 'Actual', data: act, backgroundColor: act.map((v, i) => (bud[i] && v > bud[i] ? hexA('#dc2626', 0.8) : hexA('#4f46e5', 0.8))), borderRadius: 4 },
  ] }, options: baseChartOptions() });
};

/* ================= CATEGORIES ================= */
Views.categories = () => {
  const f = getFilter();
  const txs = filteredTx({ ...f, cats: null });
  const stats = {};
  for (const t of txs) { if (!t.categoryId) continue; const s = (stats[t.categoryId] = stats[t.categoryId] || { n: 0, v: 0 }); s.n++; s.v += txBase(t); }
  const ym = thisMonth();
  const months = monthsBetween(f.from.slice(0, 7), f.to.slice(0, 7));
  const showTrend = months.length >= 2 && months.length <= 12;
  const trend = {};
  if (showTrend) for (const t of txs) { if (t.type !== 'expense') continue; const k = t.categoryId; trend[k] = trend[k] || {}; const mk = t.date.slice(0, 7); trend[k][mk] = (trend[k][mk] || 0) + txBase(t); }
  const list = (type) => {
    const cats = store.categories(type).filter((c) => !f.cats || f.cats.has(c.id));
    const groups = type === 'income' ? [['Income', cats]] : GROUPS.map((g) => [g, cats.filter((c) => c.group === g)]);
    const total = sum(cats, (c) => (stats[c.id] || {}).v || 0);
    return `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th class="r">Txns</th><th class="r">Total</th><th class="r hide-sm">Share</th>${type === 'expense' ? '<th class="r hide-sm">Budget / mo</th>' : ''}<th></th></tr></thead><tbody>
      ${groups.filter(([, l]) => l.length).map(([g, l]) => `${type === 'expense' ? `<tr class="group"><td colspan="6">${g}</td></tr>` : ''}${l.map((c) => { const s = stats[c.id] || { n: 0, v: 0 }; return `<tr>
        <td><span class="dot" style="background:${c.color}"></span> <b>${esc(c.name)}</b></td>
        <td class="r num">${s.n}</td><td class="r num">${money(s.v)}</td><td class="r num hide-sm muted">${total ? pct(s.v / total) : '–'}</td>
        ${type === 'expense' ? `<td class="r num hide-sm muted">${money(budgetCell(ym, c.id, 'all'))}</td>` : ''}
        <td class="r nowrap"><button class="btn ghost sm icon" data-action="filter-cat" data-id="${c.id}" title="Show on dashboard">${icon('filter')}</button><button class="btn ghost sm icon" data-action="edit-cat" data-id="${c.id}" title="Edit">${icon('edit')}</button><button class="btn ghost sm icon danger" data-action="del-cat" data-id="${c.id}" title="Delete">${icon('trash')}</button></td></tr>`; }).join('')}`).join('')}
      </tbody></table></div>`;
  };
  const expCats = store.categories('expense').filter((c) => !f.cats || f.cats.has(c.id)).filter((c) => trend[c.id]);
  return `
  <div class="toolbar"><span class="muted small">Numbers use the selected date range & person.</span><span class="grow"></span>
    <button class="btn primary" data-action="add-cat">${icon('plus')} Add category</button></div>
  <div class="grid cols-2">
    <div class="card"><div class="card-head"><h3>Spending categories</h3><span class="sub">grouped as Needs · Wants · Savings</span></div>${list('expense')}</div>
    <div class="card"><div class="card-head"><h3>Income categories</h3></div>${list('income')}
      <div class="card-head section-gap"><h3>Spending by category</h3></div><div class="chart-box"><canvas id="ch-cats"></canvas></div></div>
  </div>
  ${showTrend && expCats.length ? `<div class="card section-gap"><div class="card-head"><h3>Monthly trend by category</h3><span class="sub">spending per month</span></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Category</th>${months.map((m) => `<th class="r">${fmtMonth(m)}</th>`).join('')}<th class="r">Avg</th></tr></thead><tbody>
    ${expCats.map((c) => { const vals = months.map((m) => trend[c.id][m] || 0); const max = Math.max(...vals, 1); return `<tr><td class="nowrap"><span class="dot" style="background:${c.color}"></span> ${esc(c.name)}</td>${vals.map((v) => `<td class="r num" style="background:${v ? hexA(c.color, 0.06 + 0.3 * (v / max)) : 'transparent'}">${v ? shortIDR(v) : '<span class="muted">–</span>'}</td>`).join('')}<td class="r num"><b>${shortIDR(sum(vals) / vals.length)}</b></td></tr>`; }).join('')}
    </tbody></table></div></div>` : ''}`;
};
Views.categories.after = () => {
  const f = getFilter();
  const S = summarize(filteredTx(f));
  const list = Object.entries(S.byCat).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const cats = list.map(([id]) => store.catMap().get(id) || { name: 'Uncategorized', color: '#94a3b8' });
  const o = baseChartOptions({ indexAxis: 'y' });
  o.plugins.legend.display = false;
  o.plugins.tooltip = { callbacks: { label: (ctx) => money(ctx.parsed.x) } };
  const c = themeColors();
  o.scales = { x: { ticks: { color: c.muted, callback: (v) => shortIDR(v) }, grid: { color: c.border }, border: { display: false } }, y: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } } };
  Charts.make('ch-cats', { type: 'bar', data: { labels: cats.map((x) => x.name), datasets: [{ data: list.map(([, v]) => v), backgroundColor: cats.map((x) => x.color), borderRadius: 4 }] }, options: o });
};

/* ================= GOALS ================= */
Views.goals = () => {
  const f = getFilter();
  const goals = store.all('goals').filter((g) => f.person === 'all' || g.owner === f.person).sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
  const today = todayStr();
  const totTarget = sum(goals, (g) => g.target), totSaved = sum(goals, (g) => goalSaved(g));
  const periodSaved = sum(goals, (g) => goalSavedBetween(g, f.from, f.to < today ? f.to : today));
  const card = (g) => {
    const saved = goalSaved(g); const r = g.target ? saved / g.target : 0; const left = Math.max(0, g.target - saved);
    const monthsLeft = g.targetDate ? Math.max(0, (parseDateStr(g.targetDate).getFullYear() - new Date().getFullYear()) * 12 + parseDateStr(g.targetDate).getMonth() - new Date().getMonth()) : null;
    const perMonth = monthsLeft !== null ? left / Math.max(1, monthsLeft) : null;
    // pace: average of last 3 months contributions
    const from3 = `${addMonths(thisMonth(), -3)}-01`;
    const pace = goalSavedBetween(g, from3, addDays(`${thisMonth()}-01`, -1)) / 3;
    const onTrack = perMonth === null || left === 0 ? null : pace >= perMonth * 0.95;
    const contribs = g.accountId ? [] : [...store.all('contributions').filter((c) => c.goalId === g.id), ...store.activeTx().filter((t) => t.goalId === g.id && t.type === 'expense').map((t) => ({ id: t.id, date: t.date, amount: txBase(t), note: t.description, person: t.person, fromTx: true }))].sort((a, b) => b.date.localeCompare(a.date));
    const acc = g.accountId && store.get('accounts', g.accountId);
    return `<div class="card goal-card">
      <div class="goal-top"><span class="dot" style="background:${g.color || 'var(--primary)'};width:12px;height:12px;margin-top:5px"></span>
        <div style="flex:1;min-width:0"><h4>${esc(g.name)}</h4><div class="small muted">${personChip(g.owner)} ${g.targetDate ? `· by ${fmtDate(g.targetDate)}` : ''} ${acc ? `· linked to ${esc(acc.name)}` : ''}</div></div>
        ${r >= 1 ? '<span class="badge good">Reached</span>' : onTrack === true ? '<span class="badge good">On track</span>' : onTrack === false ? '<span class="badge warn">Behind</span>' : ''}
      </div>
      <div><span class="goal-amt">${money(saved)}</span> <span class="muted">of ${money(g.target)}</span></div>
      <div class="progress lg"><span style="width:${clamp(r * 100, 0, 100)}%;background:${g.color || 'var(--primary)'}"></span></div>
      <div class="goal-stats">
        <div><b>${pct(r)}</b>done</div>
        <div><b>${money(left, { compact: true })}</b>to go</div>
        <div><b>${perMonth !== null && left > 0 ? money(perMonth, { compact: true }) : '–'}</b>needed / month</div>
      </div>
      ${g.notes ? `<div class="small muted">${esc(g.notes)}</div>` : ''}
      ${contribs.length ? `<div class="list">${contribs.slice(0, 3).map((c) => `<div class="list-row"><div class="grow"><div class="title small">${esc(c.note || (c.amount < 0 ? 'Withdrawal' : 'Contribution'))}</div><div class="meta">${fmtDate(c.date)} · ${esc(pname(c.person))}${c.fromTx ? ' · from spending' : ''}</div></div><div class="amount small ${c.amount < 0 ? 'bad' : 'good'}">${money(c.amount, { sign: true })}</div>${c.fromTx ? '' : `<button class="btn ghost sm icon" data-action="del-contrib" data-id="${c.id}" aria-label="Remove">${icon('x')}</button>`}</div>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:auto;flex-wrap:wrap">
        ${g.accountId ? '<span class="hint">Progress follows the linked account\'s balance.</span>' : `<button class="btn sm primary" data-action="add-contrib" data-id="${g.id}">${icon('plus')} Add money</button>`}
        <span style="flex:1"></span>
        <button class="btn sm ghost" data-action="edit-goal" data-id="${g.id}">${icon('edit')} Edit</button>
      </div>
    </div>`;
  };
  return `
  <div class="toolbar"><span class="grow"></span><button class="btn primary" data-action="add-goal">${icon('plus')} New goal</button></div>
  ${goals.length ? `
  <div class="grid kpis k3">
    <div class="card kpi"><span class="kpi-label">Saved towards goals</span><span class="kpi-value">${money(totSaved, { compact: true })}</span><span class="kpi-sub">of ${money(totTarget, { compact: true })} · ${pct(totTarget ? totSaved / totTarget : 0)}</span>${progressBar(totTarget ? totSaved / totTarget : 0)}</div>
    <div class="card kpi"><span class="kpi-label">Added in selected period</span><span class="kpi-value">${money(periodSaved, { compact: true })}</span><span class="kpi-sub">${fmtDate(f.from)} – ${fmtDate(f.to)}</span></div>
    <div class="card kpi"><span class="kpi-label">Active goals</span><span class="kpi-value">${goals.filter((g) => goalSaved(g) < g.target).length}</span><span class="kpi-sub">${goals.filter((g) => goalSaved(g) >= g.target).length} reached</span></div>
  </div>
  <div class="grid cols-3 section-gap">${goals.map(card).join('')}</div>`
    : `<div class="card">${emptyState('Set your first shared goal', 'An emergency fund, a trip to Japan, a wedding, a house down payment… Track money you put aside manually, link a savings account, or tag spending in the "Savings & Investment" category to a goal.', `<button class="btn primary" data-action="add-goal">${icon('plus')} New goal</button>`)}</div>`}`;
};

/* ================= BALANCE ================= */
Views.balance = () => {
  const f = getFilter();
  const today = todayStr();
  const asOf = f.to < today ? f.to : today;
  const startRef = addDays(f.from, -1);
  const accs = accountsForPerson(f.person);
  const all = store.all('accounts');
  const total = sum(accs, (a) => accountBalanceIDR(a, asOf));
  const byOwner = (o) => sum(all.filter((a) => a.owner === o), (a) => accountBalanceIDR(a, asOf));
  const S = summarize(filteredTx({ ...f, cats: null }));
  const unassigned = filteredTx({ ...f, cats: null }).filter((t) => (t.type === 'expense' || t.type === 'income') && !t.accountId).length;
  const noOpening = accs.filter((a) => !a.openingDate && !Number(a.opening)).length;
  return `
  <div class="toolbar"><span class="muted small">Balances as of <b>${fmtDate(asOf)}</b> (end of the selected range).</span><span class="grow"></span>
    <button class="btn" data-action="add-transfer">${icon('transfer')} Transfer</button>
    <button class="btn primary" data-action="add-acc">${icon('plus')} Add account</button></div>
  ${noOpening ? `<div class="banner info">${icon('info')}<div class="grow small"><b>Tip:</b> set each account's <b>starting balance</b> (and the date it applies from) so balances match your bank. Or use <b>Reconcile</b> to type in today's real balance and the tracker records the difference.</div></div>` : ''}
  ${unassigned ? `<div class="banner">${icon('alert')}<div class="grow small">${unassigned} transaction(s) in this period have no account, so they don't affect balances. Assign accounts in bulk on the <a href="#log">Log</a> page (select rows → "Set account").</div></div>` : ''}
  <div class="grid kpis k4">
    <div class="card kpi"><span class="kpi-label">${f.person === 'all' ? 'Total balance' : `${esc(pname(f.person))}'s balance`}</span><span class="kpi-value">${money(total, { compact: true })}</span><span class="kpi-sub">${accs.length} accounts</span></div>
    ${PERSON_IDS.map((p) => `<div class="card kpi"><span class="kpi-label"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</span><span class="kpi-value">${money(byOwner(p), { compact: true })}</span><span class="kpi-sub">${all.filter((a) => a.owner === p).length} accounts</span></div>`).join('')}
  </div>
  <div class="grid cols-2-1 section-gap">
    <div class="card">
      <div class="card-head"><h3>Accounts</h3></div>
      ${accs.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Account</th><th class="hide-sm">Owner</th><th class="r">Balance</th><th class="r hide-sm">Change in period</th><th></th></tr></thead><tbody>
      ${accs.map((a) => { const bal = accountBalance(a, asOf); const ch = bal - accountBalance(a, startRef); return `<tr>
        <td><b>${esc(a.name)}</b><div class="small muted">${ACCOUNT_TYPES[a.type] || a.type} · ${a.currency}${a.openingDate ? ` · since ${fmtDate(a.openingDate)}` : ''}</div></td>
        <td class="hide-sm">${personChip(a.owner)}</td>
        <td class="r num nowrap"><b class="${bal < 0 ? 'bad' : ''}">${fmt(bal, a.currency)}</b>${a.currency !== 'IDR' ? `<span class="orig">≈ ${money(convert(bal, a.currency, 'IDR'))}</span>` : ''}</td>
        <td class="r num hide-sm ${ch < 0 ? 'bad' : ch > 0 ? 'good' : 'muted'}">${fmt(ch, a.currency, { sign: true })}</td>
        <td class="r nowrap"><button class="btn sm" data-action="reconcile" data-id="${a.id}" title="Enter the real balance">${icon('scale')}<span class="hide-sm">Reconcile</span></button><button class="btn ghost sm icon" data-action="edit-acc" data-id="${a.id}" aria-label="Edit">${icon('edit')}</button></td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td><td class="hide-sm"></td><td class="r">${money(total)}</td><td class="r hide-sm">${money(sum(accs, (a) => accountBalanceIDR(a, asOf) - accountBalanceIDR(a, startRef)), { sign: true })}</td><td></td></tr></tfoot></table></div>`
    : emptyState('No accounts', 'Add bank accounts, e-wallets (GoPay, OVO…) and cash.', `<button class="btn primary" data-action="add-acc">${icon('plus')} Add account</button>`)}
    </div>
    <div class="card">
      <div class="card-head"><h3>Cash flow in period</h3></div>
      <div class="list">
        <div class="list-row"><div class="grow">Income</div><div class="amount good">${money(S.income)}</div></div>
        <div class="list-row"><div class="grow">Spending</div><div class="amount">${money(-S.spend)}</div></div>
        <div class="list-row"><div class="grow">Saved & invested</div><div class="amount">${money(-S.saved)}</div></div>
        <div class="list-row"><div class="grow"><b>Net</b></div><div class="amount ${S.net < 0 ? 'bad' : 'good'}">${money(S.net, { sign: true })}</div></div>
      </div>
      <div class="card-head section-gap"><h3>Balance over time</h3></div>
      <div class="chart-box short"><canvas id="ch-bal"></canvas></div>
    </div>
  </div>`;
};
Views.balance.after = () => {
  const f = getFilter();
  const accs = accountsForPerson(f.person);
  if (!accs.length) return;
  const today = todayStr();
  const end = f.to < today ? f.to : today;
  const bk = buckets({ from: f.from, to: end });
  const points = bk.list.map((b) => (b.to > end ? end : b.to));
  const c = themeColors();
  const owners = f.person === 'all' ? PERSON_IDS.filter((p) => accs.some((a) => a.owner === p)) : [f.person];
  const datasets = owners.map((p) => ({ label: pname(p), data: points.map((d) => sum(accs.filter((a) => a.owner === p), (a) => accountBalanceIDR(a, d))), borderColor: pcolor(p), backgroundColor: hexA(pcolor(p), 0.12), fill: true, tension: 0.25, pointRadius: points.length > 40 ? 0 : 2, stack: 'b' }));
  const o = baseChartOptions();
  o.scales.y.stacked = true;
  Charts.make('ch-bal', { type: 'line', data: { labels: bk.list.map((b) => b.label), datasets }, options: o });
  void c;
};

/* ================= SETTINGS ================= */
Views.settings = () => {
  const P = persons();
  const st = store.data.settings;
  const g = gh.conf();
  const shared = window.BUDGET_CONFIG || {};
  const lockedNote = (k) => (shared[k] && !(cfg.github || {})[k] ? '<span class="hint">from config.js</span>' : '');
  return `
  <div class="settings-grid">
    <div class="card">
      <div class="card-head"><h3>This device</h3></div>
      <div class="kv">
        <span>Who's using it?</span>
        <div class="seg">${['junior', 'sabit'].map((p) => `<button class="${me() === p ? 'on' : ''}" data-action="set-me" data-v="${p}"><span class="dot" style="background:${pcolor(p)}"></span>${esc(pname(p))}</button>`).join('')}</div>
        <span>Theme</span>
        <div class="seg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="${cfg.theme === v ? 'on' : ''}" data-action="set-theme" data-v="${v}">${l}</button>`).join('')}</div>
      </div>
      <div class="hint" style="margin-top:10px">New transactions default to this person, and GitHub commits are labelled with their name.</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>People</h3></div>
      <div class="kv">
        ${PERSON_IDS.map((p) => `<span>${p === 'shared' ? 'Joint label' : p === 'junior' ? 'Person 1' : 'Person 2'}</span>
          <div style="display:flex;gap:8px"><input type="text" data-person-name="${p}" value="${esc(P[p].name)}" style="flex:1"><input type="color" data-person-color="${p}" value="${P[p].color}"></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Currencies</h3><span class="sub">main currency: IDR</span>
        <div class="right"><button class="btn sm" data-action="fetch-rates">${icon('refresh')} Get latest rates</button></div></div>
      <div class="kv">
        ${CUR_CODES.filter((c) => c !== 'IDR').map((c) => `<span>1 ${c} =</span><div style="display:flex;gap:8px;align-items:center"><span class="muted">Rp</span><input type="text" inputmode="decimal" data-rate="${c}" value="${fmtInput(st.rates[c], 'USD')}" style="width:140px"><span class="hint">${CURRENCIES[c].name}</span></div>`).join('')}
      </div>
      <div class="hint" style="margin-top:10px">Rates as of ${esc(st.ratesDate || '—')}. Each foreign-currency transaction stores the rate used when it was entered, so changing rates here doesn't rewrite history.</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>GitHub sync</h3><div class="right">${sync.pillHTML()}</div></div>
      ${!gh.configured() ? `<div class="banner info">${icon('info')}<div class="grow small">Connect a <b>private</b> GitHub repo so you and ${esc(pname(me() === 'junior' ? 'sabit' : 'junior'))} share one set of data. See README → "Set up sync". Until then, data is stored only in this browser.</div></div>` : ''}
      ${sync.state === 'error' && sync.meta.error ? `<div class="banner bad">${icon('alert')}<div class="grow small">${esc(sync.meta.error)}</div></div>` : ''}
      <div class="form-grid">
        <label class="field">Owner (user or org) ${lockedNote('owner')}<input type="text" id="gh-owner" value="${esc(g.owner)}" placeholder="e.g. junior-sabit" autocomplete="off"></label>
        <label class="field">Data repo ${lockedNote('repo')}<input type="text" id="gh-repo" value="${esc(g.repo)}" placeholder="e.g. budget-data" autocomplete="off"></label>
        <label class="field">Branch<input type="text" id="gh-branch" value="${esc(g.branch)}" autocomplete="off"></label>
        <label class="field">File path<input type="text" id="gh-path" value="${esc(g.path)}" autocomplete="off"></label>
        <label class="field full">Your personal access token
          <input type="password" id="gh-token" value="${esc(g.token)}" placeholder="github_pat_… or ghp_…" autocomplete="off">
          <span class="hint">Stored only in this browser — never uploaded. Needs <b>Contents: Read and write</b> on the data repo.</span></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" data-action="gh-save">${icon('check')} Save & connect</button>
        <button class="btn" data-action="gh-test">Test connection</button>
        ${gh.configured() ? `<button class="btn" data-action="sync-now">${icon('refresh')} Sync now</button><button class="btn danger" data-action="gh-forget">Disconnect</button>` : ''}
      </div>
      ${gh.configured() ? `<div class="hint" style="margin-top:10px">Last synced ${relTime(sync.meta.lastSync)}. Changes are saved to GitHub a moment after you make them and pulled when you reopen the tab.</div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h3>Import & export</h3></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" data-action="import">${icon('upload')} Import from Google Sheets / CSV</button>
        <button class="btn" data-action="export-csv">${icon('download')} Transactions CSV</button>
        <button class="btn" data-action="export-json">${icon('download')} Full backup (JSON)</button>
        <label class="btn">${icon('upload')} Restore backup<input type="file" id="restore-json" accept=".json,application/json" hidden></label>
      </div>
      <div class="hint" style="margin-top:10px">${store.activeTx().length} transactions · ${store.all('categories').length} categories · ${store.all('accounts').length} accounts · ${store.all('goals').length} goals</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Danger zone</h3></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn danger" data-action="wipe-tx">${icon('trash')} Delete all transactions</button>
        <button class="btn danger" data-action="reset-device">Reset this device</button>
      </div>
      <div class="hint" style="margin-top:10px">"Delete all transactions" also deletes them from GitHub for both of you. "Reset this device" only clears this browser's copy and settings (GitHub data is untouched). Version ${APP_VERSION}.</div>
    </div>
  </div>`;
};
Views.settings.after = () => {
  $$('[data-person-name]').forEach((inp) => {
    inp.onchange = () => { const p = inp.dataset.personName; const v = inp.value.trim() || p; store.updateSettings({ persons: { ...persons(), [p]: { ...persons()[p], name: v } } }); };
  });
  $$('[data-person-color]').forEach((inp) => {
    inp.onchange = () => { const p = inp.dataset.personColor; store.updateSettings({ persons: { ...persons(), [p]: { ...persons()[p], color: inp.value } } }); };
  });
  $$('[data-rate]').forEach((inp) => {
    inp.onchange = () => {
      const v = parseAmount(inp.value, 'us');
      if (!isFinite(v) || v <= 0) { toast('Enter a positive number', 'bad'); return; }
      store.updateSettings({ rates: { ...store.data.settings.rates, [inp.dataset.rate]: v }, ratesDate: todayStr() + ' (manual)' });
    };
  });
  const r = $('#restore-json');
  if (r) r.onchange = async () => {
    const file = r.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.transactions)) throw new Error('Not a budget backup file');
      const ok = await confirmBox('Restore backup?', `<p>This merges <b>${data.transactions.filter((t) => !t.deleted).length}</b> transactions from the backup into your data (newer edits win). Nothing is lost.</p>`, { okLabel: 'Restore', danger: false });
      if (!ok) return;
      store.replace(mergeData(store.data, data));
      store.changed();
      toast('Backup restored.');
    } catch (e) { toast(`Could not restore: ${e.message}`, 'bad'); }
  };
};

/* The transactions page is called "Log" (spending, income and transfers). */
Views.log = Views.spending;
