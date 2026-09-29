/*
 * Shared (non-secret) configuration.
 * Fill this in once, commit it, and both of you only need to paste your own
 * GitHub token in Settings. NEVER put a token in this file — it is public.
 */
window.BUDGET_CONFIG = {
  owner: "sptnjunior-stack",                 // GitHub user or organization that owns the DATA repo, e.g. "junior-sabit"
  repo: "ourdreams-data",                  // the PRIVATE data repo, e.g. "budget-data"
  branch: "main",
  path: "budget-data.json"   // file inside the data repo (created automatically on first save)
};
