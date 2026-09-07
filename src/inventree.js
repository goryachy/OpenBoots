import fs from 'node:fs';
import { db, timestamp } from './db.js';

const list = (value) => (Array.isArray(value) ? value : value?.results || []);
const number = (value, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

const parseDescription = (description = '') => {
  const structured = String(description).match(/OpenBoots Metadata:\s*(\{.*\})/);
  if (structured) {
    try {
      const metadata = JSON.parse(structured[1]);
      return {
        brand: metadata.brand || '', model: metadata.model || '', color: metadata.color || '',
        sizes: Array.isArray(metadata.sizes) ? metadata.sizes : String(metadata.sizes || '').split(/[,;\s]+/).filter(Boolean).map((value) => {
          const match = value.match(/^(.+?)x(\d+)$/i);
          return { size: match ? match[1] : value, quantity: match ? Number(match[2]) : 1 };
        }),
        pairsPerBox: metadata.pairsPerBox == null ? null : number(metadata.pairsPerBox, null),
        note: metadata.note || '',
      };
    } catch { /* Fall back to the readable legacy format below. */ }
  }
  const fields = {};
  for (const line of String(description).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const sizes = (fields.sizes || '').split(/[,;\s]+/).filter(Boolean).map((value) => {
    const match = value.match(/^(.+?)x(\d+)$/i);
    return { size: match ? match[1] : value, quantity: match ? Number(match[2]) : 1 };
  });
  return {
    brand: fields.brand || '',
    model: fields.model || '',
    color: fields.color || '',
    sizes,
    pairsPerBox: fields['pairs per box'] ? number(fields['pairs per box'], null) : null,
    note: fields.note || '',
  };
};

const descriptionFor = (input) => `OpenBoots Metadata: ${JSON.stringify({
  brand: input.brand || '', model: input.model || '', color: input.color || '',
  sizes: (input.sizes || []).map((item) => `${item.size}x${item.quantity || 1}`).join(','),
  pairsPerBox: input.pairsPerBox ?? null, note: input.note || '',
})}`;

export class InvenTreeInventoryCore {
  constructor() {
    this.baseUrl = (process.env.INVENTREE_BASE_URL || '').replace(/\/$/, '');
    this.token = process.env.INVENTREE_TOKEN || '';
    this.tokenFile = process.env.INVENTREE_TOKEN_FILE || '';
  }

  getToken() {
    if (this.token) return this.token.trim();
    if (this.tokenFile) {
      try { return fs.readFileSync(this.tokenFile, 'utf8').trim(); } catch { return ''; }
    }
    return '';
  }

  async request(path, options = {}) {
    const token = this.getToken();
    if (!this.baseUrl || !token) throw Object.assign(new Error('INVENTREE_NOT_CONFIGURED'), { code: 'INVENTREE_NOT_CONFIGURED' });
    const { body, headers, ...requestOptions } = options;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...requestOptions,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {}),
      },
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { detail: raw }; }
    if (!response.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
      let code = 'INVENTREE_API_ERROR';
      if (/available quantity|insufficient|exceed/i.test(detail)) code = 'INSUFFICIENT_STOCK';
      if (/already exists|unique|barcode.*exist|matches existing/i.test(detail)) code = 'DUPLICATE_BARCODE';
      if (path.includes('/stock/location/') && options.method === 'DELETE' && /stock|sub.?location|delete_stock_items|delete_sub_locations/i.test(detail)) code = 'LOCATION_NOT_EMPTY';
      throw Object.assign(new Error(`INVENTREE_HTTP_${response.status}`), { code, status: response.status, details: payload });
    }
    return payload;
  }

  async requestMultipart(path, form, method = 'PATCH') {
    const token = this.getToken();
    if (!this.baseUrl || !token) throw Object.assign(new Error('INVENTREE_NOT_CONFIGURED'), { code: 'INVENTREE_NOT_CONFIGURED' });
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      body: form,
      headers: { Accept: 'application/json', Authorization: `Token ${token}` },
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { detail: raw }; }
    if (!response.ok) throw Object.assign(new Error(`INVENTREE_HTTP_${response.status}`), { code: 'INVENTREE_API_ERROR', status: response.status, details: payload });
    return payload;
  }

  async health() { return this.request('/api/'); }

  async getLocations() {
    const locations = list(await this.request('/api/stock/location/?limit=1000'));
    return locations.map((location) => ({ id: location.pk, name: location.name, description: location.description || '' }));
  }

  async createLocation(input) {
    const location = await this.request('/api/stock/location/', { method: 'POST', body: { name: input.name, description: input.description || '' } });
    return { id: location.pk, name: location.name, description: location.description || '' };
  }

  async updateLocation(id, input) {
    const location = await this.request(`/api/stock/location/${Number(id)}/`, { method: 'PATCH', body: { name: input.name, description: input.description || '' } });
    return { id: location.pk, name: location.name, description: location.description || '' };
  }

  async deleteLocation(id) {
    await this.request(`/api/stock/location/${Number(id)}/`, { method: 'DELETE', body: { delete_stock_items: false, delete_sub_locations: false } });
    return { ok: true };
  }

  async getBrands() {
    const parts = list(await this.request('/api/part/?limit=1000'));
    return [...new Set(parts.map((part) => parseDescription(part.description).brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  async getSalePrice(partId) {
    const prices = list(await this.request(`/api/part/sale-price/?part=${partId}&limit=100`)).sort((a, b) => number(a.quantity) - number(b.quantity));
    const price = prices.find((item) => number(item.quantity) === 1) || prices[0];
    return price ? number(price.price, null) : null;
  }

  async toProduct(part, withDetails = false) {
    const metadata = parseDescription(part.description);
    const salePrice = withDetails || part.pricing_min ? await this.getSalePrice(part.pk) : null;
    return {
      id: part.pk,
      name: part.name || '',
      brand: metadata.brand,
      model: metadata.model,
      article: part.IPN || '',
      color: metadata.color,
      sizes: metadata.sizes,
      pairsPerBox: metadata.pairsPerBox,
      salePrice,
      barcode: null,
      internalBarcode: `INV-${String(part.pk).padStart(9, '0')}`,
      note: metadata.note,
      aliases: [],
      photoUrl: part.image || part.thumbnail ? `/api/products/${part.pk}/photo` : null,
      total_stock: number(part.total_in_stock ?? part.in_stock),
    };
  }

  async searchProducts(query = '', filters = {}) {
    const params = new URLSearchParams({ limit: '1000' });
    if (query) params.set('search', query);
    const parts = list(await this.request(`/api/part/?${params.toString()}`));
    const [locations, stockIndex] = await this.getStockIndex();
    let direct = null;
    if (/^(?:\d{8,14}|INV-[0-9A-Z]+)$/i.test(query)) {
      const found = await this.findProductByBarcode(query);
      direct = found ? await this.getProduct(found.id) : null;
    }
    const products = await Promise.all([...(direct ? [direct] : []), ...parts.map((part) => this.toProduct(part))]);
    const result = [];
    const seen = new Set();
    for (const product of products) {
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      product.stock = stockIndex.get(product.id) || locations.map((location) => ({ location_id: location.id, name: location.name, quantity: 0 }));
      product.total_stock = product.stock.reduce((sum, item) => sum + number(item.quantity), 0);
      if (filters.inStock && product.total_stock <= 0) continue;
      if (filters.brand && !product.brand.toLowerCase().includes(String(filters.brand).toLowerCase())) continue;
      if (filters.color && !product.color.toLowerCase().includes(String(filters.color).toLowerCase())) continue;
      if (filters.size && !product.sizes.some((item) => String(item.size) === String(filters.size))) continue;
      if (filters.locationId) {
        if (!product.stock.some((item) => item.location_id === Number(filters.locationId) && item.quantity > 0)) continue;
      }
      result.push(product);
    }
    return result;
  }

  async getStockIndex() {
    const [items, locations] = await Promise.all([
      list(await this.request('/api/stock/?limit=1000')),
      this.getLocations(),
    ]);
    const byPart = new Map();
    for (const item of items) {
      const partId = Number(item.part);
      const locationId = Number(item.location);
      if (!partId || !locationId) continue;
      if (!byPart.has(partId)) byPart.set(partId, new Map());
      const quantities = byPart.get(partId);
      quantities.set(locationId, (quantities.get(locationId) || 0) + number(item.quantity));
    }
    const index = new Map();
    for (const [partId, quantities] of byPart) index.set(partId, locations.map((location) => ({ location_id: location.id, name: location.name, quantity: quantities.get(location.id) || 0 })));
    return [locations, index];
  }

  async findProductByBarcode(barcode) {
    try {
      const response = await this.request('/api/barcode/', { method: 'POST', body: { barcode } });
      return response.part?.instance ? this.toProduct(response.part.instance, true) : null;
    } catch (error) {
      if (error.status === 400 || error.status === 404) return null;
      throw error;
    }
  }

  async getProduct(id) {
    const part = await this.request(`/api/part/${Number(id)}/`);
    const product = await this.toProduct(part, true);
    product.stock = await this.getStock(product.id);
    product.movements = await this.getMovementHistory(product.id);
    return product;
  }

  async getStock(productId) {
    const items = list(await this.request(`/api/stock/?part=${Number(productId)}&limit=1000`));
    const totals = new Map();
    for (const item of items) {
      if (!item.location) continue;
      const current = totals.get(item.location) || { location_id: item.location, name: item.location_detail?.name || `Location ${item.location}`, quantity: 0 };
      current.quantity += number(item.quantity);
      totals.set(item.location, current);
    }
    const locations = await this.getLocations();
    return locations.map((location) => ({ location_id: location.id, name: location.name, quantity: totals.get(location.id)?.quantity || 0 }));
  }

  async getStockItems(productId, locationId) {
    const items = list(await this.request(`/api/stock/?part=${Number(productId)}&location=${Number(locationId)}&limit=1000`));
    return items.filter((item) => item.location === Number(locationId) && item.in_stock !== false);
  }

  async receive(productId, locationId, quantity, sessionId) {
    const items = await this.getStockItems(productId, locationId);
    if (items.length) return this.request('/api/stock/add/', { method: 'POST', body: { items: [{ pk: items[0].pk, quantity: String(quantity) }], notes: `OpenBoots receiving session ${sessionId}` } });
    return this.request('/api/stock/', { method: 'POST', body: { part: Number(productId), quantity, location: Number(locationId), delete_on_deplete: false } });
  }

  async mutateStock(productId, locationId, delta, type = 'ADJUSTMENT', relatedId = null) {
    if (delta === 0) return;
    if (delta > 0) return this.receive(productId, locationId, delta, relatedId || type);
    const items = await this.getStockItems(productId, locationId);
    let remaining = Math.abs(delta);
    const allocations = [];
    for (const item of items) {
      const available = Math.max(0, number(item.quantity) - number(item.allocated));
      if (!available) continue;
      const quantity = Math.min(remaining, available);
      allocations.push({ pk: item.pk, quantity: String(quantity) });
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining) throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'INSUFFICIENT_STOCK' });
    return this.request('/api/stock/remove/', { method: 'POST', body: { items: allocations, notes: `${type}${relatedId ? ` ${relatedId}` : ''}` } });
  }

  async transfer(lines, fromLocationId, toLocationId, transferId) {
    if (!this.transferLocks) this.transferLocks = new Map();
    const lockKey = `${fromLocationId}:${toLocationId}:${JSON.stringify(lines)}`;
    const previous = this.transferLocks.get(lockKey) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.transferLocks.set(lockKey, current);
    await previous;
    try { return await this.transferUnlocked(lines, fromLocationId, toLocationId, transferId); }
    finally { release(); if (this.transferLocks.get(lockKey) === current) this.transferLocks.delete(lockKey); }
  }

  async transferUnlocked(lines, fromLocationId, toLocationId, transferId) {
    const allocations = [];
    for (const line of lines) {
      let remaining = line.quantity;
      for (const item of await this.getStockItems(line.productId, fromLocationId)) {
        const available = Math.max(0, number(item.quantity) - number(item.allocated));
        if (!available) continue;
        const quantity = Math.min(remaining, available);
        allocations.push({ pk: item.pk, quantity: String(quantity), merge: true });
        remaining -= quantity;
        if (!remaining) break;
      }
      if (remaining) throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'INSUFFICIENT_STOCK' });
    }
    return this.request('/api/stock/transfer/', { method: 'POST', body: { items: allocations, location: Number(toLocationId), notes: `OpenBoots transfer ${transferId}` } });
  }

  async createProduct(input) {
    const part = await this.request('/api/part/', { method: 'POST', body: {
      name: input.name, IPN: input.article || '', description: descriptionFor(input), active: true,
      component: true, purchaseable: true, salable: true, trackable: false, assembly: false,
      virtual: false, consumable: false, testable: false, is_template: false, locked: false,
    } });
    if (input.barcode) await this.linkBarcode(part.pk, input.barcode);
    const generated = await this.request('/api/barcode/generate/', { method: 'POST', body: { model: 'part', pk: part.pk } });
    if (input.internalBarcode && input.internalBarcode !== generated.barcode) await this.linkBarcode(part.pk, input.internalBarcode);
    if (input.salePrice != null) await this.request('/api/part/sale-price/', { method: 'POST', body: { part: part.pk, quantity: 1, price: String(input.salePrice), price_currency: process.env.INVENTREE_DEFAULT_CURRENCY || 'UAH' } });
    const product = await this.getProduct(part.pk);
    product.barcode = input.barcode || null;
    product.internalBarcode = generated.barcode || product.internalBarcode;
    return product;
  }

  async updateProduct(id, input) {
    await this.request(`/api/part/${Number(id)}/`, { method: 'PATCH', body: { name: input.name, IPN: input.article || '', description: descriptionFor(input) } });
    if (input.barcode) await this.linkBarcode(id, input.barcode);
    if (input.salePrice != null) await this.request('/api/part/sale-price/', { method: 'POST', body: { part: Number(id), quantity: 1, price: String(input.salePrice), price_currency: process.env.INVENTREE_DEFAULT_CURRENCY || 'UAH' } });
    return this.getProduct(id);
  }

  async setProductPhoto(id, file) {
    await this.getProduct(id);
    const form = new FormData();
    form.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'product-photo');
    await this.requestMultipart(`/api/part/thumbs/${Number(id)}/`, form);
    return this.getProduct(id);
  }

  async getProductPhoto(id) {
    const thumbnail = await this.request(`/api/part/thumbs/${Number(id)}/`);
    if (!thumbnail?.image) return null;
    const token = this.getToken();
    const response = await fetch(new URL(thumbnail.image, `${this.baseUrl}/`), {
      headers: { Authorization: `Token ${token}` },
    });
    if (!response.ok) throw Object.assign(new Error(`INVENTREE_HTTP_${response.status}`), { code: 'INVENTREE_API_ERROR', status: response.status });
    return { buffer: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type') || 'image/jpeg' };
  }

  async deleteProduct(id) {
    const stock = await this.getStock(id);
    if (stock.some((item) => Number(item.quantity) > 0)) throw Object.assign(new Error('PRODUCT_IN_USE'), { code: 'PRODUCT_IN_USE' });
    await this.request(`/api/part/${Number(id)}/`, { method: 'DELETE' });
    return { ok: true };
  }

  async linkBarcode(productId, barcode) {
    const existing = await this.findProductByBarcode(barcode);
    if (existing && existing.id !== Number(productId)) throw Object.assign(new Error('DUPLICATE_BARCODE'), { code: 'DUPLICATE_BARCODE' });
    if (existing?.id === Number(productId)) return existing;
    await this.request('/api/barcode/link/', { method: 'POST', body: { barcode, part: Number(productId) } });
    return this.getProduct(productId);
  }

  async getMovementHistory(productId) {
    const entries = list(await this.request(`/api/stock/track/?part=${Number(productId)}&limit=100&ordering=-date`));
    return entries.map((entry) => ({ id: entry.pk, type: entry.label || 'STOCK', quantity: Object.values(entry.deltas || {}).reduce((sum, value) => sum + number(value), 0), location_name: '', created_at: entry.date, user_id: entry.user || null }));
  }

  async searchCustomers(query = '') {
    const params = new URLSearchParams({ limit: '50' });
    if (query) params.set('search', query);
    return list(await this.request(`/api/company/?${params.toString()}`)).filter((company) => company.is_customer !== false).map((company) => ({ id: company.pk, name: company.name, phone: company.phone || '', note: company.description || '', order_count: 0 }));
  }

  async createCustomer(input) {
    const existing = (await this.searchCustomers(input.phone)).find((item) => item.phone === input.phone);
    if (existing) return existing;
    const emailKey = String(input.phone).replace(/\D/g, '') || `customer-${Date.now()}`;
    const company = await this.request('/api/company/', { method: 'POST', body: { name: input.name, phone: input.phone, email: `openboots-${emailKey}@localhost.invalid`, description: input.note || '', currency: process.env.INVENTREE_DEFAULT_CURRENCY || 'UAH', active: true, is_customer: true, is_supplier: false, is_manufacturer: false } });
    return { id: company.pk, name: company.name, phone: company.phone || input.phone, note: company.description || '' };
  }

  async createOrder(input) {
    const customer = input.customerId ? { id: input.customerId } : await this.createCustomer(input);
    const response = await this.request('/api/order/so/', { method: 'POST', body: { customer: customer.id, description: input.note || '', order_currency: process.env.INVENTREE_DEFAULT_CURRENCY || 'UAH' } });
    db.prepare('INSERT OR REPLACE INTO inventree_order_context(inventree_order_id,source_location_id,created_at) VALUES (?,?,?)').run(response.pk, input.sourceLocationId, timestamp());
    return this.getOrder(response.pk);
  }

  async getOrder(id) {
    const order = await this.request(`/api/order/so/${Number(id)}/`);
    const context = db.prepare('SELECT source_location_id FROM inventree_order_context WHERE inventree_order_id=?').get(Number(id));
    const lineItems = list(await this.request(`/api/order/so-line/?order=${Number(id)}&limit=100`));
    const lines = await Promise.all(lineItems.map(async (line) => ({ ...(await this.getProduct(line.part)), id: line.pk, product_id: line.part, quantity: number(line.quantity) })));
    const customer = order.customer ? await this.request(`/api/company/${order.customer}/`) : (order.customer_detail || {});
    const shipments = list(await this.request(`/api/order/so/shipment/?order=${Number(id)}&limit=20`));
    const shipped = Boolean(order.shipment_date || shipments.some((shipment) => shipment.shipment_date));
    return { id: order.pk, delivery_number: order.reference, status: shipped ? 'CONFIRMED' : 'DRAFT', customer_name: customer.name || '', customer_phone: customer.phone || '', location_name: context?.source_location_id ? String(context.source_location_id) : '', source_location_id: context?.source_location_id, created_at: order.creation_date, lines };
  }

  async addOrderLine(orderId, productId, quantity = 1) {
    const existing = list(await this.request(`/api/order/so-line/?order=${Number(orderId)}&part=${Number(productId)}&limit=10`))[0];
    if (existing) await this.request(`/api/order/so-line/${existing.pk}/`, { method: 'PATCH', body: { quantity: number(existing.quantity) + quantity } });
    else await this.request('/api/order/so-line/', { method: 'POST', body: { order: Number(orderId), part: Number(productId), quantity } });
    return this.getOrder(orderId);
  }

  async confirmOrder(orderId, idempotencyKey) {
    if (!this.confirmLocks) this.confirmLocks = new Map();
    const previous = this.confirmLocks.get(Number(orderId)) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.confirmLocks.set(Number(orderId), current);
    await previous;
    try { return await this.confirmOrderUnlocked(orderId, idempotencyKey); }
    finally { release(); if (this.confirmLocks.get(Number(orderId)) === current) this.confirmLocks.delete(Number(orderId)); }
  }

  async confirmOrderUnlocked(orderId, idempotencyKey) {
    const key = `inventree-order:${orderId}:${idempotencyKey}`;
    const previous = db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get('inventree-order', key);
    if (previous) return JSON.parse(previous.response_json);
    const order = await this.getOrder(orderId);
    if (order.status === 'CONFIRMED') return order;
    if (!order.lines.length) throw Object.assign(new Error('EMPTY_ORDER'), { code: 'EMPTY_ORDER' });
    const items = [];
    for (const line of order.lines) {
      let remaining = line.quantity;
      for (const item of await this.getStockItems(line.product_id, order.source_location_id)) {
        const available = Math.max(0, number(item.quantity) - number(item.allocated));
        if (!available) continue;
        const quantity = Math.min(remaining, available);
        items.push({ line_item: line.id, stock_item: item.pk, quantity: String(quantity) });
        remaining -= quantity;
        if (!remaining) break;
      }
      if (remaining) throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'INSUFFICIENT_STOCK' });
    }
    const shipment = await this.request('/api/order/so/shipment/', { method: 'POST', body: { order: Number(orderId), reference: `OpenBoots-${orderId}` } });
    await this.request(`/api/order/so/${Number(orderId)}/allocate/`, { method: 'POST', body: { items, shipment: shipment.pk } });
    const task = await this.request(`/api/order/so/shipment/${shipment.pk}/ship/`, { method: 'POST', body: {} });
    if (task.task_id) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = await this.request(`/api/background-task/${task.task_id}/`);
        if (state.complete) {
          if (!state.success) throw Object.assign(new Error('INVENTREE_SHIPMENT_FAILED'), { code: 'INVENTREE_API_ERROR', details: state });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    const result = await this.getOrder(orderId);
    db.prepare('INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)').run('inventree-order', key, JSON.stringify(result), timestamp());
    return result;
  }

  async cancelOrder(orderId) {
    await this.request(`/api/order/so/${Number(orderId)}/cancel/`, { method: 'POST', body: {} });
    return this.getOrder(orderId);
  }

  async beginCount(locationId) {
    const locations = await this.getLocations();
    if (!locations.some((location) => location.id === Number(locationId))) throw new Error('LOCATION_NOT_FOUND');
    const products = await this.searchProducts('', {});
    const location = locations.find((item) => item.id === Number(locationId));
    db.prepare('INSERT OR IGNORE INTO locations(id,name,active) VALUES (?,?,1)').run(location.id, location.name);
    const localProduct = db.prepare('INSERT OR IGNORE INTO products(id,name,internal_barcode,created_at) VALUES (?,?,?,?)');
    for (const product of products) localProduct.run(product.id, product.name || `Part ${product.id}`, product.internalBarcode, timestamp());
    const r = db.prepare('INSERT INTO inventory_counts(location_id,created_at) VALUES (?,?)').run(locationId, timestamp());
    const add = db.prepare('INSERT INTO count_lines(count_id,product_id,expected) VALUES (?,?,?)');
    for (const product of products) {
      const stock = await this.getStock(product.id);
      add.run(r.lastInsertRowid, product.id, stock.find((item) => item.location_id === Number(locationId))?.quantity || 0);
    }
    return this.getCount(r.lastInsertRowid);
  }

  async getCount(id) {
    const count = db.prepare('SELECT * FROM inventory_counts WHERE id=?').get(Number(id));
    if (!count) return null;
    const locations = await this.getLocations();
    const result = { ...count, location_name: locations.find((location) => location.id === count.location_id)?.name || String(count.location_id) };
    const lines = db.prepare('SELECT * FROM count_lines WHERE count_id=?').all(id);
    result.lines = await Promise.all(lines.map(async (line) => {
      const product = await this.getProduct(line.product_id);
      return { ...line, name: product.name, brand: product.brand, model: product.model };
    }));
    return result;
  }

  async updateCountLine(countId, productId, actual) {
    db.prepare('UPDATE count_lines SET actual=? WHERE count_id=? AND product_id=?').run(actual, countId, productId);
    return this.getCount(countId);
  }

  async applyCount(countId) {
    const count = db.prepare("SELECT * FROM inventory_counts WHERE id=? AND status='OPEN'").get(countId);
    if (!count) throw Object.assign(new Error('COUNT_NOT_OPEN'), { code: 'COUNT_NOT_OPEN' });
    const lines = db.prepare('SELECT * FROM count_lines WHERE count_id=?').all(countId);
    for (const line of lines) await this.mutateStock(line.product_id, count.location_id, line.actual - line.expected, 'ADJUSTMENT', String(countId));
    db.prepare("UPDATE inventory_counts SET status='APPLIED' WHERE id=?").run(countId);
    return this.getCount(countId);
  }
}

export const inventreeConfigured = Boolean(process.env.INVENTREE_BASE_URL && (process.env.INVENTREE_TOKEN || process.env.INVENTREE_TOKEN_FILE));
