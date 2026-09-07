import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dbPath = process.env.DATABASE_PATH || "./data/openboots.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
export const productPhotoDirectory = path.resolve(
  process.env.OPENBOOTS_UPLOADS_PATH || path.join(path.dirname(path.resolve(dbPath)), "uploads/products"),
);
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator');
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', article TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', sizes_json TEXT NOT NULL DEFAULT '[]', pairs_per_box INTEGER, sale_price_cents INTEGER, barcode TEXT UNIQUE, internal_barcode TEXT UNIQUE NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_aliases (barcode TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, source TEXT NOT NULL DEFAULT 'supplier');
CREATE TABLE IF NOT EXISTS stock (product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, location_id INTEGER NOT NULL REFERENCES locations(id), quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0), PRIMARY KEY(product_id, location_id));
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), source_location_id INTEGER NOT NULL REFERENCES locations(id), status TEXT NOT NULL DEFAULT 'DRAFT', idempotency_key TEXT, delivery_number TEXT UNIQUE, created_at TEXT NOT NULL, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS order_lines (order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(order_id, product_id));
CREATE TABLE IF NOT EXISTS receiving_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL REFERENCES locations(id), status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receiving_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES receiving_sessions(id) ON DELETE CASCADE, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), barcode TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id), location_id INTEGER NOT NULL REFERENCES locations(id), type TEXT NOT NULL, quantity INTEGER NOT NULL, related_id TEXT, created_at TEXT NOT NULL, user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS inventory_counts (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL REFERENCES locations(id), status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS count_lines (count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), expected INTEGER NOT NULL, actual INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(count_id, product_id));
CREATE TABLE IF NOT EXISTS idempotency (scope TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope, key));
CREATE TABLE IF NOT EXISTS inventree_order_context (inventree_order_id INTEGER PRIMARY KEY, source_location_id INTEGER NOT NULL, created_at TEXT NOT NULL);
`);

const productColumns = db.prepare("PRAGMA table_info(products)").all();
if (!productColumns.some((column) => column.name === "photo_path"))
  db.exec("ALTER TABLE products ADD COLUMN photo_path TEXT");
if (!productColumns.some((column) => column.name === "photo_updated_at"))
  db.exec("ALTER TABLE products ADD COLUMN photo_updated_at TEXT");

// Metadata is owned by OpenBoots: InvenTree locations do not expose the
// operational capabilities needed by the mobile workflow (e.g. UNASSIGNED).
// Keep it in the BFF so external location IDs remain the inventory authority.
db.exec(`
  CREATE TABLE IF NOT EXISTS location_meta (
    location_id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'WAREHOUSE',
    receiving_enabled INTEGER NOT NULL DEFAULT 1,
    sales_enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
`);

// In production product_id is an InvenTree ID, so it must not reference the
// demo-only products table. Rebuild legacy databases created with that FK.
const receivingEventForeignKeys = db
  .prepare("PRAGMA foreign_key_list(receiving_events)")
  .all();
if (
  receivingEventForeignKeys.some(
    (foreignKey) => foreignKey.table === "products",
  )
) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE receiving_events_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES receiving_sessions(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        barcode TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO receiving_events_v2(id,session_id,product_id,quantity,barcode,created_at)
        SELECT id,session_id,product_id,quantity,barcode,created_at FROM receiving_events;
      DROP TABLE receiving_events;
      ALTER TABLE receiving_events_v2 RENAME TO receiving_events;
    `);
  })();
}

const now = () => new Date().toISOString();
const hash = (value) =>
  crypto.scryptSync(value, "openboots-demo-salt", 32).toString("hex");
const seed = db.transaction(() => {
  if (!db.prepare("SELECT 1 FROM users LIMIT 1").get())
    db.prepare(
      "INSERT INTO users(username,password_hash,role) VALUES (?,?,?)",
    ).run("admin", hash("admin"), "operator");
  db.prepare("UPDATE users SET role='admin' WHERE username='admin'").run();
  if (!db.prepare("SELECT 1 FROM locations LIMIT 1").get()) {
    const add = db.prepare("INSERT INTO locations(name) VALUES (?)");
    ["Main Warehouse", "Showroom", "Warehouse 2"].forEach((name) =>
      add.run(name),
    );
  }
  if (!db.prepare("SELECT 1 FROM products LIMIT 1").get()) {
    const add = db.prepare(
      "INSERT INTO products(name,brand,model,article,color,sizes_json,pairs_per_box,sale_price_cents,barcode,internal_barcode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    const product = add.run(
      "9060",
      "New Balance",
      "9060",
      "NB9060-BLK",
      "Black",
      JSON.stringify([
        { size: "36", quantity: 1 },
        { size: "37", quantity: 1 },
        { size: "38", quantity: 2 },
        { size: "39", quantity: 2 },
        { size: "40", quantity: 1 },
        { size: "41", quantity: 1 },
      ]),
      8,
      125000,
      "1234567890123",
      "INV-000001824",
      now(),
    );
    const loc = db.prepare("SELECT id FROM locations ORDER BY id").all();
    const addStock = db.prepare(
      "INSERT INTO stock(product_id,location_id,quantity) VALUES (?,?,?)",
    );
    addStock.run(product.lastInsertRowid, loc[0].id, 18);
    addStock.run(product.lastInsertRowid, loc[1].id, 2);
    addStock.run(product.lastInsertRowid, loc[2].id, 7);
    db.prepare(
      "INSERT INTO product_aliases(barcode,product_id,source) VALUES (?,?,?)",
    ).run("1234567890123", product.lastInsertRowid, "manufacturer");
  }
});
seed();

export const tx = (fn) => db.transaction(fn)();
export const timestamp = now;
export const passwordHash = hash;
