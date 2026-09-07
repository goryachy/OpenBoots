import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, productPhotoDirectory, timestamp, tx } from './db.js';

export const sizesFromRow = (row) => JSON.parse(row.sizes_json || '[]');
const productView = (row) => ({ ...row, sizes: sizesFromRow(row), pairsPerBox: row.pairs_per_box ?? null, salePrice: row.sale_price_cents == null ? null : row.sale_price_cents / 100, aliases: row.aliases ? JSON.parse(row.aliases) : [], photoUrl: row.photo_path ? `/api/products/${row.id}/photo?v=${encodeURIComponent(row.photo_updated_at || '')}` : null });
const safePhotoPath = (filePath) => {
  const root = `${path.resolve(productPhotoDirectory)}${path.sep}`;
  const resolved = path.resolve(filePath || '');
  return resolved.startsWith(root) ? resolved : null;
};

export class DemoInventoryCore {
  findProductByBarcode(barcode) {
    const row = db.prepare(`SELECT p.*, (SELECT json_group_array(pa.barcode) FROM product_aliases pa WHERE pa.product_id=p.id) aliases FROM products p WHERE p.barcode=? OR p.internal_barcode=? OR p.id IN (SELECT product_id FROM product_aliases WHERE barcode=?)`).get(barcode, barcode, barcode);
    return row ? productView(row) : null;
  }
  getProduct(id) { const row = db.prepare(`SELECT p.*, (SELECT json_group_array(pa.barcode) FROM product_aliases pa WHERE pa.product_id=p.id) aliases FROM products p WHERE p.id=?`).get(id); return row ? productView(row) : null; }
  setProductPhoto(id, file) {
    const product = this.getProduct(id);
    if (!product) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
    if (!extension) throw Object.assign(new Error('UNSUPPORTED_IMAGE'), { code: 'UNSUPPORTED_IMAGE' });
    fs.mkdirSync(productPhotoDirectory, { recursive: true });
    const target = path.join(productPhotoDirectory, `${Number(id)}-${crypto.randomUUID()}.${extension}`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, file.buffer);
      fs.renameSync(temporary, target);
      db.prepare('UPDATE products SET photo_path=?,photo_updated_at=? WHERE id=?').run(target, timestamp(), Number(id));
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      fs.rmSync(target, { force: true });
      throw error;
    }
    const previousPath = safePhotoPath(product.photo_path);
    if (previousPath && previousPath !== target) fs.rmSync(previousPath, { force: true });
    return this.getProduct(id);
  }
  getProductPhoto(id) {
    const product = this.getProduct(id);
    const filePath = safePhotoPath(product?.photo_path);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    return { buffer: fs.readFileSync(filePath), mime };
  }
  searchProducts(query = '', filters = {}) {
    const like = `%${query}%`;
    const rows = db.prepare(`SELECT p.*, COALESCE(SUM(s.quantity),0) total_stock, (SELECT json_group_array(pa.barcode) FROM product_aliases pa WHERE pa.product_id=p.id) aliases FROM products p LEFT JOIN stock s ON s.product_id=p.id WHERE (?='' OR p.name LIKE ? OR p.brand LIKE ? OR p.model LIKE ? OR p.article LIKE ? OR p.color LIKE ? OR p.barcode=? OR p.internal_barcode=? OR p.id IN (SELECT product_id FROM product_aliases WHERE barcode=?)) GROUP BY p.id ORDER BY p.name LIMIT 100`).all(query, like, like, like, like, like, query, query, query).map((row) => ({ ...productView(row), stock: this.getStock(row.id) }));
    return rows.filter((row) => {
      if (filters.inStock && row.total_stock <= 0) return false;
      if (filters.brand && !row.brand.toLowerCase().includes(String(filters.brand).toLowerCase())) return false;
      if (filters.color && !row.color.toLowerCase().includes(String(filters.color).toLowerCase())) return false;
      if (filters.size && !sizesFromRow(row).some((size) => String(size.size) === String(filters.size))) return false;
      if (filters.locationId && !this.getStock(row.id).some((stock) => stock.location_id === Number(filters.locationId) && stock.quantity > 0)) return false;
      return true;
    });
  }
  getLocations() { return db.prepare('SELECT id,name FROM locations WHERE active=1 ORDER BY id').all(); }
  createLocation(input) { const r = db.prepare('INSERT INTO locations(name) VALUES (?)').run(input.name); return db.prepare('SELECT id,name FROM locations WHERE id=?').get(r.lastInsertRowid); }
  updateLocation(id, input) { const result = db.prepare('UPDATE locations SET name=? WHERE id=? AND active=1').run(input.name, id); if (!result.changes) throw new Error('LOCATION_NOT_FOUND'); return db.prepare('SELECT id,name FROM locations WHERE id=?').get(id); }
  deleteLocation(id) { const location = db.prepare('SELECT id FROM locations WHERE id=? AND active=1').get(id); if (!location) throw new Error('LOCATION_NOT_FOUND'); const stock = db.prepare('SELECT 1 FROM stock WHERE location_id=? AND quantity>0 LIMIT 1').get(id); if (stock) throw Object.assign(new Error('LOCATION_NOT_EMPTY'), { code: 'LOCATION_NOT_EMPTY' }); db.prepare('UPDATE locations SET active=0 WHERE id=?').run(id); return { ok: true }; }
  getStock(productId) { return db.prepare('SELECT l.id location_id,l.name,COALESCE(s.quantity,0) quantity FROM locations l LEFT JOIN stock s ON s.location_id=l.id AND s.product_id=? WHERE l.active=1 ORDER BY l.id').all(productId); }
  getBrands() { return db.prepare("SELECT DISTINCT brand FROM products WHERE trim(brand)<>'' ORDER BY brand").all().map((row) => row.brand); }
  getMovementHistory(productId) { return db.prepare('SELECT m.*,l.name location_name FROM movements m JOIN locations l ON l.id=m.location_id WHERE m.product_id=? ORDER BY m.created_at DESC LIMIT 100').all(productId); }
  ensureStock(productId, locationId) { db.prepare('INSERT OR IGNORE INTO stock(product_id,location_id,quantity) VALUES (?,?,0)').run(productId, locationId); }
  mutateStock(productId, locationId, delta, type, relatedId = null, userId = null) {
    this.ensureStock(productId, locationId);
    const result = db.prepare('UPDATE stock SET quantity=quantity+? WHERE product_id=? AND location_id=? AND quantity+? >= 0').run(delta, productId, locationId, delta);
    if (result.changes !== 1) throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'INSUFFICIENT_STOCK' });
    db.prepare('INSERT INTO movements(product_id,location_id,type,quantity,related_id,created_at,user_id) VALUES (?,?,?,?,?,?,?)').run(productId, locationId, type, delta, relatedId, timestamp(), userId);
  }
  receive(productId, locationId, quantity, sessionId, userId) { return tx(() => { this.mutateStock(productId, locationId, quantity, 'RECEIVE', String(sessionId), userId); }); }
  transfer(lines, fromLocationId, toLocationId, transferId, userId) { return tx(() => { for (const line of lines) this.mutateStock(line.productId, fromLocationId, -line.quantity, 'TRANSFER_OUT', String(transferId), userId); for (const line of lines) this.mutateStock(line.productId, toLocationId, line.quantity, 'TRANSFER_IN', String(transferId), userId); }); }
  createProduct(input) {
    return tx(() => {
      if (input.barcode && this.findProductByBarcode(input.barcode)) throw Object.assign(new Error('DUPLICATE_BARCODE'), { code: 'DUPLICATE_BARCODE' });
      const internal = input.internalBarcode || `INV-${String(Number(db.prepare("SELECT COALESCE(MAX(id),0)+1 n FROM products").get().n) + 1823).padStart(9, '0')}`;
      const result = db.prepare('INSERT INTO products(name,brand,model,article,color,sizes_json,pairs_per_box,sale_price_cents,barcode,internal_barcode,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(input.name, input.brand || '', input.model || '', input.article || '', input.color || '', JSON.stringify(input.sizes || []), input.pairsPerBox || null, input.salePrice == null || input.salePrice === '' ? null : Math.round(Number(input.salePrice) * 100), input.barcode || null, internal, input.note || '', timestamp());
      const product = this.getProduct(result.lastInsertRowid);
      return product;
    });
  }
  updateProduct(id, input) {
    return tx(() => {
      const current = this.getProduct(id);
      if (!current) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      if (input.barcode && input.barcode !== current.barcode) {
        const linked = this.findProductByBarcode(input.barcode);
        if (linked && linked.id !== Number(id)) throw Object.assign(new Error('DUPLICATE_BARCODE'), { code: 'DUPLICATE_BARCODE' });
      }
      db.prepare('UPDATE products SET name=?,brand=?,model=?,article=?,color=?,sizes_json=?,pairs_per_box=?,sale_price_cents=?,barcode=?,note=? WHERE id=?').run(input.name,input.brand || '',input.model || '',input.article || '',input.color || '',JSON.stringify(input.sizes || []),input.pairsPerBox || null,input.salePrice == null || input.salePrice === '' ? null : Math.round(Number(input.salePrice) * 100),input.barcode || null,input.note || '',id);
      return this.getProduct(id);
    });
  }
  deleteProduct(id) {
    const product = this.getProduct(id);
    const result = tx(() => {
      if (!this.getProduct(id)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      if (db.prepare('SELECT 1 FROM stock WHERE product_id=? AND quantity>0 LIMIT 1').get(id)) throw Object.assign(new Error('PRODUCT_IN_USE'), { code: 'PRODUCT_IN_USE' });
      if (db.prepare('SELECT 1 FROM movements WHERE product_id=? LIMIT 1').get(id)) throw Object.assign(new Error('PRODUCT_HAS_HISTORY'), { code: 'PRODUCT_HAS_HISTORY' });
      if (db.prepare('SELECT 1 FROM order_lines WHERE product_id=? LIMIT 1').get(id)) throw Object.assign(new Error('PRODUCT_HAS_ORDERS'), { code: 'PRODUCT_HAS_ORDERS' });
      db.prepare('DELETE FROM product_aliases WHERE product_id=?').run(id);
      db.prepare('DELETE FROM products WHERE id=?').run(id);
      return { ok: true };
    });
    const photoPath = safePhotoPath(product?.photo_path);
    if (photoPath) fs.rmSync(photoPath, { force: true });
    return result;
  }
  linkBarcode(productId, barcode) { return tx(() => { if (this.findProductByBarcode(barcode)) throw Object.assign(new Error('DUPLICATE_BARCODE'), { code: 'DUPLICATE_BARCODE' }); db.prepare('INSERT INTO product_aliases(barcode,product_id,source) VALUES (?,?,?)').run(barcode, productId, 'linked'); return this.getProduct(productId); }); }
  createCustomer(input) { const existing = db.prepare('SELECT * FROM customers WHERE phone=?').get(input.phone); if (existing) return existing; const r = db.prepare('INSERT INTO customers(name,phone,note,created_at) VALUES (?,?,?,?)').run(input.name,input.phone,input.note || '',timestamp()); return db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid); }
  searchCustomers(query='') { return db.prepare("SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='CONFIRMED') order_count FROM customers c WHERE ?='' OR c.name LIKE ? OR c.phone LIKE ? ORDER BY c.name LIMIT 50").all(query,`%${query}%`,`%${query}%`); }
  getOrder(id) { const order = db.prepare('SELECT o.*,c.name customer_name,c.phone customer_phone,l.name location_name FROM orders o JOIN customers c ON c.id=o.customer_id JOIN locations l ON l.id=o.source_location_id WHERE o.id=?').get(id); if (!order) return null; order.lines=db.prepare('SELECT ol.quantity,p.* FROM order_lines ol JOIN products p ON p.id=ol.product_id WHERE ol.order_id=?').all(id).map(productView).map(p=>({ ...p, quantity: p.quantity || 0 })); return order; }
  createOrder(input) { return tx(() => { const customer = input.customerId ? db.prepare('SELECT * FROM customers WHERE id=?').get(input.customerId) : this.createCustomer(input); if (!customer) throw new Error('CUSTOMER_NOT_FOUND'); const r=db.prepare('INSERT INTO orders(customer_id,source_location_id,status,created_at) VALUES (?,?,\'DRAFT\',?)').run(customer.id,input.sourceLocationId,timestamp()); return this.getOrder(r.lastInsertRowid); }); }
  addOrderLine(orderId, productId, quantity=1) { return tx(() => { const order=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId); if (!order || order.status !== 'DRAFT') throw new Error('ORDER_NOT_DRAFT'); const existing=db.prepare('SELECT quantity FROM order_lines WHERE order_id=? AND product_id=?').get(orderId,productId); if(existing) db.prepare('UPDATE order_lines SET quantity=quantity+? WHERE order_id=? AND product_id=?').run(quantity,orderId,productId); else db.prepare('INSERT INTO order_lines(order_id,product_id,quantity) VALUES (?,?,?)').run(orderId,productId,quantity); return this.getOrder(orderId); }); }
  confirmOrder(orderId, idempotencyKey, userId) {
    const previous=db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get(`order:${orderId}`,idempotencyKey);
    if(previous) return JSON.parse(previous.response_json);
    return tx(() => { const order=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId); if(!order) throw new Error('ORDER_NOT_FOUND'); if(order.status==='CONFIRMED') return this.getOrder(orderId); if(order.status!=='DRAFT') throw new Error('ORDER_NOT_DRAFT'); const lines=db.prepare('SELECT * FROM order_lines WHERE order_id=?').all(orderId); if(!lines.length) throw new Error('EMPTY_ORDER'); for(const line of lines) this.mutateStock(line.product_id,order.source_location_id,-line.quantity,'SALE',String(orderId),userId); const number=`${new Date().getFullYear()}-${String(orderId).padStart(6,'0')}`; db.prepare("UPDATE orders SET status='CONFIRMED',delivery_number=?,confirmed_at=?,idempotency_key=? WHERE id=?").run(number,timestamp(),idempotencyKey,orderId); const result=this.getOrder(orderId); db.prepare('INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)').run(`order:${orderId}`,idempotencyKey,JSON.stringify(result),timestamp()); return result; });
  }
  cancelOrder(orderId) { db.prepare("UPDATE orders SET status='CANCELLED' WHERE id=? AND status='DRAFT'").run(orderId); return this.getOrder(orderId); }
  beginCount(locationId) { return tx(() => { const r=db.prepare('INSERT INTO inventory_counts(location_id,created_at) VALUES (?,?)').run(locationId,timestamp()); const products=db.prepare('SELECT p.id,COALESCE(s.quantity,0) expected FROM products p LEFT JOIN stock s ON s.product_id=p.id AND s.location_id=?').all(locationId); const add=db.prepare('INSERT INTO count_lines(count_id,product_id,expected) VALUES (?,?,?)'); products.forEach(p=>add.run(r.lastInsertRowid,p.id,p.expected)); return this.getCount(r.lastInsertRowid); }); }
  getCount(id) { const count=db.prepare('SELECT c.*,l.name location_name FROM inventory_counts c JOIN locations l ON l.id=c.location_id WHERE c.id=?').get(id); if(!count)return null; count.lines=db.prepare('SELECT cl.*,p.name,p.brand,p.model FROM count_lines cl JOIN products p ON p.id=cl.product_id WHERE cl.count_id=?').all(id); return count; }
  updateCountLine(countId, productId, actual) { db.prepare('UPDATE count_lines SET actual=? WHERE count_id=? AND product_id=?').run(actual,countId,productId); return this.getCount(countId); }
  applyCount(countId,userId) { return tx(() => { const count=db.prepare("SELECT * FROM inventory_counts WHERE id=? AND status='OPEN'").get(countId); if(!count)throw new Error('COUNT_NOT_OPEN'); const lines=db.prepare('SELECT * FROM count_lines WHERE count_id=?').all(countId); for(const line of lines){const delta=line.actual-line.expected;if(delta)this.mutateStock(line.product_id,count.location_id,delta,'ADJUSTMENT',String(countId),userId);} db.prepare("UPDATE inventory_counts SET status='APPLIED' WHERE id=?").run(countId); return this.getCount(countId); }); }
}

export const core = new DemoInventoryCore();
