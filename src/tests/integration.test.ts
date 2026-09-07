import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";

const dbPath = "/tmp/openboots-vitest.db";
try {
  fs.rmSync(dbPath);
} catch {}
try {
  fs.rmSync("/tmp/openboots-vitest-uploads", { recursive: true, force: true });
} catch {}
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = dbPath;
process.env.OPENBOOTS_UPLOADS_PATH = "/tmp/openboots-vitest-uploads";
process.env.JWT_SECRET = "test-secret";
process.env.CORE_MODE = "demo";
const { app } = await import("../server.js");
const { deliveryNoteText, normalizeOcrText, parseLabelText, viberPreview } =
  await import("../services.js");
const { db } = await import("../db.js");

let server: any;
let base = "";
let cookie = "";
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
  });
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const body = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
}
const postJson = (path: string, data: any, headers?: HeadersInit) =>
  request(path, {
    method: "POST",
    body: JSON.stringify(data),
    headers: { Cookie: cookie, ...headers },
  });
const postForm = (path: string, form: FormData) =>
  request(path, {
    method: "POST",
    body: form,
    headers: { Cookie: cookie },
  });
const getJson = (path: string) =>
  request(path, { headers: { Cookie: cookie } });

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  expect(login.response.status).toBe(200);
});
afterAll(() => {
  server.close();
  db.close();
});

describe("OpenBoots critical workflows", () => {
  it("stores external InvenTree product ids in receiving events", () => {
    const productForeignKey = db
      .prepare("PRAGMA foreign_key_list(receiving_events)")
      .all()
      .find((foreignKey: any) => foreignKey.table === "products");
    expect(productForeignKey).toBeUndefined();

    const session = db
      .prepare(
        "INSERT INTO receiving_sessions(location_id,created_at) VALUES (?,?)",
      )
      .run(1, new Date().toISOString());
    expect(() =>
      db
        .prepare(
          "INSERT INTO receiving_events(session_id,product_id,quantity,barcode,created_at) VALUES (?,?,?,?,?)",
        )
        .run(
          session.lastInsertRowid,
          999999,
          1,
          "external-product",
          new Date().toISOString(),
        ),
    ).not.toThrow();
    db.prepare("DELETE FROM receiving_sessions WHERE id=?").run(
      session.lastInsertRowid,
    );
  });

  it("scans known and unknown barcodes without duplicates", async () => {
    const known = await postJson("/api/scan", { barcode: "1234567890123" });
    expect(known.response.status).toBe(200);
    expect(known.body.product.id).toBe(1);
    const unknown = await postJson("/api/scan", { barcode: "9999999999999" });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.error).toBe("UNKNOWN_BARCODE");
    const created = await postJson("/api/products", {
      name: "Test Shoe",
      brand: "Test",
      article: "T-1",
      barcode: "9999999999999",
      sizes: [{ size: "40", quantity: 1 }],
      pairsPerBox: 1,
      salePrice: 10,
    });
    expect(created.response.status).toBe(201);
    const duplicate = await postJson("/api/products", {
      name: "Duplicate",
      barcode: "9999999999999",
    });
    expect(duplicate.response.status).toBe(400);
    const linked = await postJson("/api/products/1/link-barcode", {
      barcode: "8888888888888",
    });
    expect(linked.response.status).toBe(200);
    const alias = await postJson("/api/scan", { barcode: "8888888888888" });
    expect(alias.body.product.id).toBe(1);
    const blocked = await request("/api/products/1", { method: "DELETE", headers: { Cookie: cookie } });
    expect(blocked.response.status).toBe(409);
    const extra = await postJson("/api/products", { name: "Removable Shoe", barcode: "7777777777777" });
    const updated = await request(`/api/products/${extra.body.product.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Removable Shoe",
        brand: "Test",
        article: "EDIT-1",
        color: "Black",
        sizes: [{ size: "40", quantity: 1 }],
        pairsPerBox: 1,
        salePrice: 99.5,
        barcode: "7777777777777",
      }),
      headers: { Cookie: cookie },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.product.name).toBe("Updated Removable Shoe");
    expect(updated.body.product.salePrice).toBe(99.5);
    const removable = await request(`/api/products/${extra.body.product.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(removable.response.status).toBe(200);
    const missing = await getJson(`/api/products/${extra.body.product.id}`);
    expect(missing.response.status).toBe(404);
  });
  it("receives repeated and bulk quantities and undoes latest event", async () => {
    const session = (
      await postJson("/api/receiving/sessions", { locationId: 1 })
    ).body.session;
    const before = (await getJson("/api/products/1")).body.product.stock.find(
      (x: any) => x.location_id === 1,
    ).quantity;
    await postJson(
      `/api/receiving/sessions/${session.id}/scan`,
      { barcode: "1234567890123" },
      { "Idempotency-Key": "receive-1" },
    );
    await postJson(
      `/api/receiving/sessions/${session.id}/scan`,
      { barcode: "1234567890123" },
      { "Idempotency-Key": "receive-2" },
    );
    await postJson(
      `/api/receiving/sessions/${session.id}/quantity`,
      { barcode: "1234567890123", quantity: 20 },
      { "Idempotency-Key": "receive-bulk" },
    );
    const duplicate = await postJson(
      `/api/receiving/sessions/${session.id}/quantity`,
      { barcode: "1234567890123", quantity: 20 },
      { "Idempotency-Key": "receive-bulk" },
    );
    expect(duplicate.body.quantity).toBe(20);
    const after = (await getJson("/api/products/1")).body.product.stock.find(
      (x: any) => x.location_id === 1,
    ).quantity;
    expect(after - before).toBe(22);
    await postJson(`/api/receiving/sessions/${session.id}/undo`, {});
    const undone = (await getJson("/api/products/1")).body.product.stock.find(
      (x: any) => x.location_id === 1,
    ).quantity;
    expect(undone).toBe(after - 20);
  });
  it("uses a non-sellable Unassigned location for default receiving", async () => {
    const created = await postJson("/api/receiving/sessions", {});
    expect(created.response.status).toBe(201);
    expect(created.body.location.kind).toBe("UNASSIGNED");
    expect(created.body.location.salesEnabled).toBe(false);
    expect(created.body.location.receivingEnabled).toBe(true);
    const locations = await getJson("/api/locations");
    expect(
      locations.body.locations.some(
        (location: any) =>
          location.kind === "UNASSIGNED" && location.salesEnabled === false,
      ),
    ).toBe(true);
  });
  it("adds and removes one box for the active product in an Unassigned session", async () => {
    const created = await postJson("/api/receiving/sessions", {});
    const session = created.body.session;
    const locationId = session.locationId;
    const before = (await getJson("/api/products/1")).body.product.stock.find(
      (item: any) => item.location_id === locationId,
    ).quantity;
    await postJson(`/api/receiving/sessions/${session.id}/scan`, { barcode: "1234567890123" }, { "Idempotency-Key": "unassigned-one" });
    await postJson(`/api/receiving/sessions/${session.id}/quantity`, { barcode: "1234567890123", quantity: 3 }, { "Idempotency-Key": "unassigned-bulk" });
    const removed = await postJson(`/api/receiving/sessions/${session.id}/remove-one`, { barcode: "1234567890123" });
    expect(removed.response.status).toBe(200);
    expect(removed.body.quantity).toBe(-1);
    const after = (await getJson("/api/products/1")).body.product.stock.find(
      (item: any) => item.location_id === locationId,
    ).quantity;
    expect(after - before).toBe(3);
  });
  it("transfers atomically and rejects insufficient stock", async () => {
    const before = (await getJson("/api/products/1")).body.product.stock;
    const result = await postJson(
      "/api/transfers",
      {
        fromLocationId: 1,
        toLocationId: 2,
        lines: [{ productId: 1, quantity: 3 }],
      },
      { "Idempotency-Key": "transfer-1" },
    );
    const duplicate = await postJson(
      "/api/transfers",
      {
        fromLocationId: 1,
        toLocationId: 2,
        lines: [{ productId: 1, quantity: 3 }],
      },
      { "Idempotency-Key": "transfer-1" },
    );
    expect(result.response.status).toBe(200);
    expect(duplicate.response.status).toBe(200);
    const after = (await getJson("/api/products/1")).body.product.stock;
    expect(after.find((x: any) => x.location_id === 1).quantity).toBe(
      before.find((x: any) => x.location_id === 1).quantity - 3,
    );
    expect(after.find((x: any) => x.location_id === 2).quantity).toBe(
      before.find((x: any) => x.location_id === 2).quantity + 3,
    );
    const failed = await postJson("/api/transfers", {
      fromLocationId: 1,
      toLocationId: 2,
      lines: [{ productId: 1, quantity: 99999 }],
    });
    expect(failed.response.status).toBe(409);
  });
  it("keeps order draft, confirms once, and returns idempotent result", async () => {
    const order = (
      await postJson("/api/orders", {
        name: "Alexander",
        phone: "+380501112233",
        sourceLocationId: 1,
      })
    ).body.order;
    await postJson(`/api/orders/${order.id}/scan`, {
      barcode: "1234567890123",
    });
    await postJson(`/api/orders/${order.id}/scan`, {
      barcode: "1234567890123",
    });
    const draft = (await getJson(`/api/orders/${order.id}`)).body.order;
    expect(draft.status).toBe("DRAFT");
    const stockBefore = (
      await getJson("/api/products/1")
    ).body.product.stock.find((x: any) => x.location_id === 1).quantity;
    const first = await postJson(
      `/api/orders/${order.id}/confirm`,
      {},
      { "Idempotency-Key": "test-confirm-1" },
    );
    const second = await postJson(
      `/api/orders/${order.id}/confirm`,
      {},
      { "Idempotency-Key": "test-confirm-1" },
    );
    expect(first.response.status).toBe(200);
    expect(first.body.order.status).toBe("CONFIRMED");
    expect(second.body.order.delivery_number).toBe(
      first.body.order.delivery_number,
    );
    const stockAfter = (
      await getJson("/api/products/1")
    ).body.product.stock.find((x: any) => x.location_id === 1).quantity;
    expect(stockBefore - stockAfter).toBe(2);
  });
  it("keeps order draft, confirms once, and returns idempotent result", async () => {
    const order = (
      await postJson("/api/orders", {
        name: "Alexander",
        phone: "+380501112233",
        sourceLocationId: 1,
      })
    ).body.order;
    await postJson(`/api/orders/${order.id}/scan`, {
      barcode: "1234567890123",
    });
    await postJson(`/api/orders/${order.id}/scan`, {
      barcode: "1234567890123",
    });
    const draft = (await getJson(`/api/orders/${order.id}`)).body.order;
    expect(draft.status).toBe("DRAFT");
    const stockBefore = (
      await getJson("/api/products/1")
    ).body.product.stock.find((x: any) => x.location_id === 1).quantity;
    const first = await postJson(
      `/api/orders/${order.id}/confirm`,
      {},
      { "Idempotency-Key": "test-confirm-1" },
    );
    const second = await postJson(
      `/api/orders/${order.id}/confirm`,
      {},
      { "Idempotency-Key": "test-confirm-1" },
    );
    expect(first.response.status).toBe(200);
    expect(first.body.order.status).toBe("CONFIRMED");
    expect(second.body.order.delivery_number).toBe(
      first.body.order.delivery_number,
    );
    const stockAfter = (
      await getJson("/api/products/1")
    ).body.product.stock.find((x: any) => x.location_id === 1).quantity;
    expect(stockBefore - stockAfter).toBe(2);
    const emptyOrder = (
      await postJson("/api/orders", {
        name: "No Stock",
        phone: "+380501112244",
        sourceLocationId: 1,
      })
    ).body.order;
    await postJson(`/api/orders/${emptyOrder.id}/scan`, {
      barcode: "9999999999999",
    });
    const insufficient = await postJson(
      `/api/orders/${emptyOrder.id}/confirm`,
      {},
      { "Idempotency-Key": "test-insufficient" },
    );
    expect(insufficient.response.status).toBe(409);
  });
  it("creates price-free delivery note and priced Viber preview", async () => {
    const order = (await getJson("/api/orders/1")).body.order;
    const pdf = await getJson(`/api/orders/${order.id}/delivery-note.pdf`);
    expect(pdf.response.status).toBe(200);
    const raw = Buffer.from(pdf.body);
    expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
    const note = deliveryNoteText(order);
    expect(note).not.toContain("1250");
    expect(note).not.toContain("Ціна");
    const preview = viberPreview(
      (await getJson("/api/products/1")).body.product,
    );
    expect(preview).toContain("Ціна:");
    expect(preview).toContain("1 250");
  });
  it("searches customers, filters stock, renders labels, and applies reviewed counts", async () => {
    const customers = await getJson("/api/customers?query=%2B380501112233");
    expect(customers.body.customers[0].phone).toBe("+380501112233");
    const filtered = await getJson(
      "/api/products?brand=New%20Balance&locationId=1&inStock=true",
    );
    expect(filtered.body.products[0].brand).toBe("New Balance");
    const label = await getJson("/api/products/1/label");
    expect(label.response.status).toBe(200);
    expect(new TextDecoder().decode(label.body)).toContain("INV-000001824");
    const count = (await postJson("/api/counts", { locationId: 1 })).body.count;
    const line = count.lines.find((x: any) => x.product_id === 1);
    await postJson(`/api/counts/${count.id}/lines`, {
      productId: 1,
      actual: line.expected + 1,
    });
    const applied = await postJson(`/api/counts/${count.id}/apply`, {});
    expect(applied.body.count.status).toBe("APPLIED");
  });
  it("manages warehouses and exposes stock breakdowns and brand options", async () => {
    const brands = await getJson("/api/brands");
    expect(brands.body.brands).toContain("New Balance");
    const products = await getJson(
      "/api/products?query=New%20Balance&inStock=false",
    );
    expect(products.body.products[0].stock.length).toBeGreaterThan(0);
    const created = await postJson("/api/locations", {
      name: "Settings Test Warehouse",
      description: "temporary",
    });
    expect(created.response.status).toBe(201);
    const locationId = created.body.location.id;
    const updated = await request(`/api/locations/${locationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Settings Test Warehouse Updated",
        description: "updated",
      }),
      headers: { Cookie: cookie },
    });
    expect(updated.response.status).toBe(200);
    const removed = await request(`/api/locations/${locationId}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(removed.response.status).toBe(200);
    const protectedDelete = await request("/api/locations/1", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(protectedDelete.response.status).toBe(409);
  });
  it("saves a photo for a product and returns it to the authenticated client", async () => {
    const created = await postJson("/api/products", {
      name: "Photo test shoe",
      barcode: "4820000099911",
    });
    expect(created.response.status).toBe(201);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0U1kAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "shoe.png");
    const uploaded = await postForm(
      `/api/products/${created.body.product.id}/photo`,
      form,
    );
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body.product.photoUrl).toContain(
      `/api/products/${created.body.product.id}/photo`,
    );
    const image = await fetch(`${base}${uploaded.body.product.photoUrl}`, {
      headers: { Cookie: cookie },
    });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);

    const unsupported = new FormData();
    unsupported.append(
      "image",
      new Blob(["not an image"], { type: "image/jpeg" }),
      "fake.jpg",
    );
    const rejected = await postForm(
      `/api/products/${created.body.product.id}/photo`,
      unsupported,
    );
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toBe("UNSUPPORTED_IMAGE");
    const stillAvailable = await fetch(`${base}${uploaded.body.product.photoUrl}`, {
      headers: { Cookie: cookie },
    });
    expect(Buffer.from(await stillAvailable.arrayBuffer())).toEqual(png);
  });
});

describe("OCR and Viber deterministic boundaries", () => {
  it("parses partial labels safely and keeps fields editable", () => {
    const parsed = parseLabelText(
      "ART: B7201\nCOLOR: BLACK\nSIZES: 36 x 1\n37 x 2\nQTY: 3",
    );
    expect(parsed.article).toBe("B7201");
    expect(parsed.color).toBe("BLACK");
    expect(parsed.sizes).toHaveLength(1);
    expect(parsed.pairsPerBox).toBe(3);
    expect(parsed.rawText).toContain("ART:");
  });
  it("preserves Cyrillic and Latin while removing OCR noise", () => {
    const text = normalizeOcrText(
      "Бренд: New Balance !!!\n@@@\nМодель: Кросівки 720\na - - oi 3 TT aa BP TE TE RE",
    );
    expect(text).toContain("Бренд: New Balance");
    expect(text).toContain("Модель: Кросівки 720");
    expect(text).not.toContain("@@@");
    expect(text).not.toContain("a - - oi");
  });
  it("requires price before Viber publication", () => {
    expect(() => viberPreview({ name: "No Price", sizes: [] } as any)).toThrow(
      "PRICE_REQUIRED",
    );
  });
});
