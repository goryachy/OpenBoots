export class InvenTreeInventoryCore {
  constructor() { this.baseUrl = (process.env.INVENTREE_BASE_URL || '').replace(/\/$/, ''); this.token = process.env.INVENTREE_TOKEN; }
  async request(path, options = {}) {
    if (!this.baseUrl || !this.token) throw Object.assign(new Error('INVENTREE_NOT_CONFIGURED'), { code: 'INVENTREE_NOT_CONFIGURED' });
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers: { Accept: 'application/json', Authorization: `Token ${this.token}`, ...(options.headers || {}) } });
    if (!response.ok) throw Object.assign(new Error(`INVENTREE_HTTP_${response.status}`), { code: 'INVENTREE_API_ERROR', status: response.status });
    return response.json();
  }
  async health() { return this.request('/api/'); }
  async searchProducts(query) { return this.request(`/api/part/part/?search=${encodeURIComponent(query || '')}`); }
  async getLocations() { return this.request('/api/stock/location/'); }
}

export const inventreeConfigured = Boolean(process.env.INVENTREE_BASE_URL && process.env.INVENTREE_TOKEN);
