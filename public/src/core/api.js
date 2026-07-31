export function createApi(onUnauthorized) {
  let categories = [];
  let accounts = [];

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { onUnauthorized(); return null; }
    if (res.status === 204) return null;
    return res.json();
  }

  async function getCategories() {
    if (!categories.length) categories = await api('/categories');
    return categories;
  }

  function invalidateCategories() { categories = []; }

  async function getAccounts() {
    if (!accounts.length) accounts = await api('/accounts');
    return accounts;
  }

  function invalidateAccounts() { accounts = []; }

  return { api, getCategories, invalidateCategories, getAccounts, invalidateAccounts };
}
