[README.md](https://github.com/user-attachments/files/32888576/README.md)
# Our Budget — couple budget tracker

A budget tracker for two people (Junior & Sabit) that runs on **GitHub Pages** and saves your data to a **private GitHub repo**, so both of you always see the same numbers on any phone or laptop.

| Page | What it does |
|---|---|
| **Dashboard** | Income, spending, savings, budget left and current balance, with comparisons to the previous period, spending over time (by person or income vs spending), by category, Needs/Wants/Savings vs the 50/30/20 rule, who spent what, goals, recent and largest expenses, "safe to spend per day". |
| **Log** | Every transaction (spending, income, transfers). Search, sort, bulk-edit category/person/account, import, export CSV. |
| **Budget** | Monthly plan per category **per person** (Junior / Sabit / Shared) plus planned income. Plans roll forward to later months until you change them. Plan vs actual, and budget vs actual by month. |
| **Categories** | Add, edit, recolour, merge or delete categories, grouped as Needs / Wants / Savings. Monthly trend table per category. |
| **Goals** | Savings goals with target and date, progress, "needed per month", on-track status. Add money manually, link a savings account, or tag "Savings & Investment" spending to a goal. |
| **Balance** | Accounts (bank, e-wallet, cash, credit card) per owner, current balances, change in period, balance over time, transfers, and "Reconcile" to match your real bank balance. |

The **filters at the top** (date range, person, categories) apply to every page. Main currency is **IDR**; you can also record **JPY, USD and SGD** — each transaction keeps the exchange rate used, and Settings can fetch today's rates.

---

## 1. Set up (one time, about 15 minutes)

You'll make two repositories:

- `budget-app` — **public**, hosts the website (contains no financial data).
- `budget-data` — **private**, holds one file `budget-data.json` with all your data.

### Step 1 — Create a free GitHub organization (recommended)

GitHub's fine-grained tokens can only reach repos owned by **your own account or an organization you belong to**. If `budget-data` lived on Junior's personal account, Sabit couldn't use a fine-grained token for it. A free organization solves this.

1. github.com → your avatar → **Your organizations** → **New organization** → **Free**.
2. Name it, e.g. `junior-sabit`.
3. **Invite Sabit** as an Owner (org → People → Invite member).

> No organization? See [Alternative without an organization](#alternative-without-an-organization).

### Step 2 — Create the private data repo

1. In the org: **New repository** → name `budget-data` → **Private** → tick **Add a README** → Create.
2. That's it — the app creates `budget-data.json` on first save.

### Step 3 — Create the app repo and turn on GitHub Pages

1. In the org: **New repository** → name `budget-app` → **Public** → Create.
2. **Add file → Upload files** → drag in everything from this folder (`index.html`, `assets/`, `.nojekyll`, `README.md`, `template/`) → Commit.
3. Edit **`assets/config.js`** on GitHub (pencil icon) and fill in:
   ```js
   owner: "junior-sabit",      // your org name
   repo: "budget-data",
   branch: "main",
   path: "budget-data.json"
   ```
   Commit. (Never put a token in this file — the repo is public.)
4. Repo **Settings → Pages** → Source: **Deploy from a branch** → Branch **main** / **(root)** → Save.
5. After a minute your tracker is live at `https://junior-sabit.github.io/budget-app/`. Bookmark it / "Add to Home Screen" on your phones.

### Step 4 — Each of you creates a personal token

Do this once **each** (Junior on his account, Sabit on hers/his):

1. github.com → avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** `junior-sabit` (the org). **Expiration:** e.g. 1 year.
3. **Repository access:** *Only select repositories* → `budget-data`.
4. **Permissions → Repository permissions → Contents: Read and write.** (Metadata: Read-only is added automatically.)
5. Generate and copy the token (`github_pat_…`).

> If the org shows "requires approval", an org owner approves it under org **Settings → Personal access tokens → Pending requests**. You can also allow fine-grained tokens without approval there.

### Step 5 — Connect

Open the tracker → **Settings → GitHub sync** → paste your token → **Save & connect**. The pill in the sidebar turns green: *Synced just now*. Repeat on each device you use.

The token is stored only in that browser (localStorage) and is sent only to `api.github.com`. Use the tracker on your own devices; press **Disconnect** on any shared computer.

---

## 2. Import your last two months from Google Sheets

1. Open your spending sheet in Google Sheets. Select the whole table **including the header row** and copy (Ctrl/Cmd + C).
   *(Or File → Download → Comma-separated values (.csv).)*
2. In the tracker: **Log → Import** (or Settings → Import).
3. **Paste** (or upload the CSV) → **Next**.
4. **Match columns.** The importer guesses English and Indonesian headers (Tanggal, Keterangan, Kategori, Nominal/Jumlah, Siapa/Oleh, Metode Bayar/Rekening…). Only **Date** and **Amount** are required. Options:
   - Date format (auto-detects DD/MM/YYYY vs MM/DD/YYYY; also reads "15 Agustus 2026", "Aug 3, 2026" and Sheets serial numbers).
   - Number format (Indonesian `1.250.000` / English `1,250,000`; "Rp", "1,5jt", "750rb" also work).
   - No Type column? Choose how to read signs — e.g. *Positive = spending, negative = income*. Or map a separate **Income amount** column.
   - Default person / currency / account for empty cells.
5. **Match values.** Map each of your sheet's categories to a tracker category (or create it), each person value (e.g. "Berdua" → Shared), and each payment method to an account (or create it).
6. **Review** totals, skipped rows and possible duplicates → **Import**. There's an **Undo** button right after.

No category column? The importer guesses from the description (Indomaret → Groceries, Gojek → Transport, GoFood → Food Delivery, PLN → Utilities, Netflix → Subscriptions, Gaji → Salary …) and falls back to "Other". Fix the rest in bulk on the Log page (tick rows → *Set category*).

`template/import-template.csv` shows a clean layout if you want to tidy your sheet first.

---

## 3. Everyday use

- **Add spending:** the round **+** button (or press **N** on a keyboard). Type the amount like `45.000`, `45000` or `45rb`. Shortcuts work in every amount field (goals, budgets, balances): `750rb` = 750.000, `1,5jt` = 1.500.000. Pick who spent it — **Junior**, **Sabit**, or **Shared** for joint costs. Descriptions you've used before are suggested, and their last category is filled in automatically.
- **Foreign currency:** pick JPY/USD/SGD in the amount field; the rate is pre-filled from Settings and saved with the transaction.
- **Budget:** go to Budget, type amounts per person/category. Next month automatically reuses this plan; edit any cell to make a month-specific version. "Use last month's actuals" is a quick way to create a first plan from your imported data.
- **Balances:** on Balance, add your real accounts with a starting balance and date (e.g. balance on 1 July). Record moves between accounts as **Transfers** (they don't count as spending). Use **Reconcile** whenever the bank balance differs.
- **Goals:** create a goal, then **Add money** each month — or link a savings account so progress follows its balance.

### How syncing works
- Every change is saved in the browser immediately and pushed to `budget-data.json` about 1.5 s later. Each save is a **commit**, so the data repo's history is a full audit trail and backup.
- The app pulls the latest data when you open or return to the tab and every 90 s.
- If you both edit at the same time, changes are **merged record by record** (the newest edit to each transaction wins; deletions are remembered), so nothing is overwritten.
- Offline? Keep going — it syncs when you're back online.

### Backups
Settings → **Full backup (JSON)** downloads everything; **Restore backup** merges a file back in. You can also restore any older version of `budget-data.json` from the repo's commit history.

---

## Alternative without an organization

Put both repos on Junior's personal account and add Sabit as a collaborator on `budget-data` (repo Settings → Collaborators). Junior uses a fine-grained token as above. Sabit must use a **classic** token (Developer settings → Tokens (classic) → scope `repo`), because fine-grained tokens can't access another person's repo. Classic tokens can reach all of Sabit's repos, so the organization route is safer.

(GitHub Pages on a *private* app repo needs a paid plan; keeping `budget-app` public is fine because it contains no data.)

---

## Troubleshooting

| Message | Fix |
|---|---|
| *Repo not found (404)* | Check owner/repo spelling in config.js/Settings and that the token's resource owner is the org and it includes `budget-data`. |
| *Token rejected (401)* | Token expired or mistyped — create a new one. |
| *403 … lacks "Contents: Read and write"* | Edit the token's permissions, or the org hasn't approved it yet. |
| *Warning: this repo is PUBLIC* | Make `budget-data` private (repo Settings → General → Danger Zone → Change visibility). |
| Charts missing | The chart library loads from cdnjs; check your connection. Numbers still work. |

## Files

```
index.html            app shell
assets/config.js      shared settings (owner / repo / path) — no secrets
assets/core.js        data model, calculations, formatting
assets/sync.js        GitHub read/write + merge
assets/importer.js    Google Sheets / CSV importer
assets/views.js       pages and charts
assets/main.js        navigation, forms, actions
assets/styles.css     styles (light & dark)
template/import-template.csv
.nojekyll             tells GitHub Pages to serve files as-is
```

No build step and no server: plain HTML/CSS/JavaScript plus Chart.js from cdnjs.
