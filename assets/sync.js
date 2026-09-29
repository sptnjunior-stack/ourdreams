'use strict';
/* =====================================================================
 * sync.js — keeps a JSON file in a (private) GitHub repo in sync.
 * Uses the GitHub REST "contents" API with each person's own token.
 * Conflicts are resolved by merging record-by-record (newest edit wins).
 * ===================================================================== */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Order-independent fingerprint of a dataset (sorted keys, records sorted by id). */
function canon(d) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = norm(v[k]);
      return o;
    }
    return v;
  };
  const x = { settings: norm(d.settings) };
  for (const c of COLLECTIONS) x[c] = (d[c] || []).map(norm).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(x);
}

const gh = {
  conf() {
    const shared = window.BUDGET_CONFIG || {};
    const mine = cfg.github || {};
    const pick = (k, d) => (mine[k] !== undefined && mine[k] !== '' ? mine[k] : shared[k] || d);
    return { owner: pick('owner', ''), repo: pick('repo', ''), branch: pick('branch', 'main'), path: pick('path', 'budget-data.json'), token: mine.token || '' };
  },
  configured() { const c = this.conf(); return !!(c.owner && c.repo && c.path && c.token); },
  contentsUrl(c = this.conf()) {
    const p = c.path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${p}`;
  },
  headers(c = this.conf(), accept = 'application/vnd.github+json') {
    return { Accept: accept, Authorization: `Bearer ${c.token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  },
  async errorText(r) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); if (j.message) msg = `${r.status}: ${j.message}`; } catch (e) { /* ignore */ }
    if (r.status === 401) msg = 'Token rejected (401). Check that it is correct and not expired.';
    if (r.status === 403) msg += ' — the token may lack "Contents: Read and write" permission on this repo.';
    if (r.status === 404) msg = 'Repo not found (404). Check owner/repo and that your token can access it.';
    return msg;
  },
  async testRepo() {
    const c = this.conf();
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, { headers: this.headers(c), cache: 'no-store' });
    if (!r.ok) throw new Error(await this.errorText(r));
    return r.json();
  },
  async read() {
    const c = this.conf();
    const url = `${this.contentsUrl(c)}?ref=${encodeURIComponent(c.branch)}&_=${Date.now()}`;
    const r = await fetch(url, { headers: this.headers(c), cache: 'no-store' });
    if (r.status === 404) {
      // could be a missing file OR a missing repo/branch: distinguish
      await this.testRepo();
      return { sha: null, data: null };
    }
    if (!r.ok) throw new Error(await this.errorText(r));
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64decode(j.content);
    else {
      // files > 1 MB: fetch raw
      const r2 = await fetch(url, { headers: this.headers(c, 'application/vnd.github.raw+json'), cache: 'no-store' });
      if (!r2.ok) throw new Error(await this.errorText(r2));
      text = await r2.text();
    }
    let data = null;
    if (text && text.trim()) {
      try { data = JSON.parse(text); } catch (e) { throw new Error('The data file in GitHub is not valid JSON. Fix or delete it in the repo.'); }
    }
    return { sha: j.sha, data };
  },
  async write(data, sha) {
    const c = this.conf();
    const body = {
      message: `Budget update by ${pname(me())} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      content: b64encode(JSON.stringify(data, null, 1)),
      branch: c.branch,
    };
    if (sha) body.sha = sha;
    const r = await fetch(this.contentsUrl(c), { method: 'PUT', headers: { ...this.headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(await this.errorText(r));
    const j = await r.json();
    return j.content && j.content.sha;
  },
};

const sync = {
  meta: Object.assign({ dirty: false, lastSync: null, sha: null, error: null }, lsGet(LS.sync, {})),
  state: 'idle', // idle | syncing | error
  busy: null,
  _timer: null,
  saveMeta() { lsSet(LS.sync, this.meta); },
  markDirty() {
    this.meta.dirty = true; this.saveMeta();
    this.updatePill();
    if (gh.configured()) { clearTimeout(this._timer); this._timer = setTimeout(() => this.run(), 1500); }
  },
  status() {
    if (!gh.configured()) return { cls: '', ic: 'cloudOff', text: 'Local only', title: 'Not connected to GitHub — data is saved in this browser only. Connect in Settings.' };
    if (this.state === 'syncing') return { cls: 'syncing', ic: 'refresh', text: 'Syncing…', title: 'Syncing with GitHub' };
    if (this.state === 'error') return { cls: 'error', ic: 'alert', text: 'Sync error', title: this.meta.error || 'Sync failed' };
    if (this.meta.dirty) return { cls: '', ic: 'cloud', text: 'Unsaved', title: 'Changes waiting to be saved to GitHub' };
    return { cls: 'synced', ic: 'cloud', text: `Synced ${relTime(this.meta.lastSync)}`, title: `Last synced ${relTime(this.meta.lastSync)}` };
  },
  pillHTML() {
    const s = this.status();
    return `<button class="sync-pill ${s.cls}" data-action="sync-now" title="${esc(s.title)}">${icon(s.ic)}<span>${esc(s.text)}</span></button>`;
  },
  updatePill() { $$('.sync-pill').forEach((el) => { el.outerHTML = this.pillHTML(); }); },

  /** Pull remote, merge with local, push if anything local is newer. */
  run({ force = false } = {}) {
    if (!gh.configured()) return Promise.resolve();
    if (this.busy) { this._again = true; return this.busy; }
    this.state = 'syncing'; this.updatePill();
    this.busy = (async () => {
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const remote = await gh.read();
          const before = canon(store.data);
          const merged = remote.data ? mergeData(store.data, remote.data) : store.data;
          const mergedStr = canon(merged);
          const remoteStr = remote.data ? canon(normalizeData(remote.data)) : null;
          const needPush = force || !remote.data || mergedStr !== remoteStr;
          if (needPush) {
            try {
              const sha = await gh.write(merged, remote.sha);
              this.meta.sha = sha;
            } catch (e) {
              if (e.conflict) { await new Promise((r) => setTimeout(r, 400 + attempt * 600)); continue; }
              throw e;
            }
          } else {
            this.meta.sha = remote.sha;
          }
          // the person may have edited while we were talking to GitHub — keep those edits
          const editedMeanwhile = canon(store.data) !== before;
          if (mergedStr !== before) {
            const current = editedMeanwhile ? mergeData(store.data, merged) : merged;
            store.replace(current);
            App.renderSoon();
          }
          this.meta.dirty = editedMeanwhile; if (editedMeanwhile) this._again = true;
          this.meta.lastSync = stamp(); this.meta.error = null;
          this.state = 'idle';
          break;
        }
        if (this.state === 'syncing') throw new Error('Could not save after several tries (someone else keeps editing). Will retry.');
      } catch (e) {
        this.state = 'error';
        this.meta.error = navigator.onLine === false ? 'You are offline — changes are kept on this device and will sync later.' : e.message;
        console.warn('[sync]', e);
      } finally {
        this.saveMeta();
        this.busy = null;
        this.updatePill();
        if (this._again) { this._again = false; setTimeout(() => this.run(), 300); }
      }
    })();
    return this.busy;
  },
  start() {
    if (!gh.configured()) return;
    if (this._started) { this.run(); return; }
    this._started = true;
    this.run();
    setInterval(() => { if (document.visibilityState === 'visible') this.run(); }, 90 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.run(); });
    window.addEventListener('online', () => this.run());
    setInterval(() => this.updatePill(), 30 * 1000);
  },
};
