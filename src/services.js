import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { db, timestamp } from './db.js';

export const parseLabelText = (text = '') => {
  const source = text.replace(/\r/g, '');
  const get = (keys) => { const re = new RegExp(`(?:^|\\n)\\s*(?:${keys.join('|')})\\s*[:#-]?\\s*([^\\n]+)`, 'i'); return source.match(re)?.[1]?.trim() || ''; };
  const sizeText = get(['SIZES?', 'РОЗМІРИ', 'РАЗМЕРЫ']);
  const qtyText = get(['QTY', 'PRS', 'PAIRS', 'КІЛЬКІСТЬ', 'КОЛИЧЕСТВО']);
  const article = get(['ART(?:ICLE)?', 'ITEM', 'STYLE(?: NO)?', 'MODEL', 'АРТИКУЛ']);
  const color = get(['COLOR', 'COL', 'CLR', 'КОЛІР', 'ЦВЕТ']);
  const brand = get(['BRAND', 'MANUFACTURER', 'БРЕНД', 'ВИРОБНИК']);
  const name = get(['NAME', 'PRODUCT', 'MODEL NAME', 'ТОВАР']);
  const sizeMatches = [...sizeText.matchAll(/(\d{2}(?:[.,]\d)?)[ ]*[xх×:]?[ ]*(\d+)?/g)];
  const sizes = sizeMatches.map((m) => ({ size: m[1].replace(',', '.'), quantity: Number(m[2] || 1) }));
  const pairsPerBox = qtyText.match(/\d+/)?.[0] ? Number(qtyText.match(/\d+/)[0]) : (sizes.length ? sizes.reduce((sum, s) => sum + s.quantity, 0) : null);
  return { name, brand, model: article, article, color, sizes, pairsPerBox, rawText: source, confidence: { name: !!name ? 0.8 : 0.1, article: !!article ? 0.85 : 0.1, color: !!color ? 0.75 : 0.1, sizes: sizes.length ? 0.75 : 0.1, pairsPerBox: pairsPerBox ? 0.7 : 0.1 } };
};

export const viberPreview = (product) => {
  if (product.salePrice == null) throw Object.assign(new Error('PRICE_REQUIRED'), { code: 'PRICE_REQUIRED' });
  const sizes = (product.sizes || []).map((s) => s.size).join('-') || '—';
  const price = Number(product.salePrice).toLocaleString('uk-UA', { minimumFractionDigits: Number(product.salePrice) % 1 ? 2 : 0, maximumFractionDigits: 2 }).replace(/\u00a0/g, ' ');
  return `НОВИНКА\n\n${product.brand ? `${product.brand} ` : ''}${product.name}\n\nКолір: ${product.color || '—'}\nРозміри: ${sizes}\nРостовка: ${product.pairsPerBox || '—'} пар\n\nЦіна: ${price} грн\n\nАртикул: ${product.article || '—'}`;
};

export const deliveryNoteText = (order) => {
  const lines = [`DELIVERY NOTE #${order.delivery_number || order.id}`, new Date(order.confirmed_at || order.created_at).toLocaleDateString('uk-UA'), `Customer: ${order.customer_name}`, order.customer_phone];
  let total = 0;
  for (const line of order.lines) { total += line.quantity; lines.push(`${line.brand ? `${line.brand} ` : ''}${line.name}`, `${line.color || ''}  ${line.sizes?.map((s) => s.size).join('-') || ''}  Article: ${line.article || '—'}  Quantity: ${line.quantity} boxes`); }
  lines.push(`Total: ${total} boxes`);
  return lines.join('\n');
};

export const officialViberPublish = async (message) => {
  const token = process.env.VIBER_BOT_TOKEN; const receiver = process.env.VIBER_RECEIVER_ID;
  if (!token || !receiver) return { published: false, fallback: true, reason: 'OFFICIAL_TARGET_NOT_CONFIGURED' };
  const response = await fetch(process.env.VIBER_API_URL || 'https://chatapi.viber.com/pa/send_message', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token }, body: JSON.stringify({ receiver, sender: { name: 'OpenBoots' }, type: 'text', text: message }) });
  if (!response.ok) return { published: false, fallback: true, reason: 'VIBER_API_ERROR' };
  const body = await response.json(); return { published: body.status === 0, fallback: body.status !== 0, reason: body.status_message };
};

export const makeDeliveryPdf = (order, res) => {
  const doc = new PDFDocument({ size: 'A4', margin: 48, compress: false }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="delivery-note-${order.delivery_number || order.id}.pdf"`); doc.pipe(res);
  doc.fontSize(22).text(`DELIVERY NOTE #${order.delivery_number || order.id}`); doc.moveDown(0.5).fontSize(11).text(new Date(order.confirmed_at || order.created_at).toLocaleDateString('uk-UA')); doc.moveDown(); doc.fontSize(13).text(`Customer: ${order.customer_name}`); doc.fontSize(11).text(order.customer_phone); doc.moveDown();
  let total=0; for(const line of order.lines){ total += line.quantity; doc.fontSize(13).text(`${line.brand ? `${line.brand} ` : ''}${line.name}`); doc.fontSize(10).text(`${line.color || ''}  ${line.sizes?.map((s)=>s.size).join('-') || ''}  Article: ${line.article || '—'}  Quantity: ${line.quantity} boxes`); doc.moveDown(0.5); } doc.moveDown(); doc.fontSize(13).text(`Total: ${total} boxes`); doc.end();
};

export const makeLabelHtml = async (product) => {
  const png = await bwipjs.toBuffer({ bcid: 'code128', text: product.internal_barcode, scale: 3, height: 12, includetext: true, textxalign: 'center' });
  const image = `data:image/png;base64,${png.toString('base64')}`;
  return `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Label ${product.internal_barcode}</title><style>body{font-family:Arial;text-align:center;width:320px;margin:25px auto}h2{margin:4px}p{margin:8px}img{max-width:100%}@media print{button{display:none}}</style><h2>${escapeHtml(product.brand ? `${product.brand} ${product.name}` : product.name)}</h2><p>${escapeHtml(product.color)}<br>${escapeHtml((product.sizes||[]).map(s=>s.size).join('-'))}</p><img src="${image}" alt="${product.internal_barcode}"><button onclick="print()">Print</button></html>`;
};
const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const recognizeImage = async (buffer) => {
  try { const { createWorker } = await import('tesseract.js'); const worker = await createWorker('eng'); const result = await worker.recognize(buffer); await worker.terminate(); return { text: result.data.text, confidence: result.data.confidence / 100 }; }
  catch { return { text: '', confidence: 0, unavailable: true }; }
};

export const idempotency = (scope, key) => db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get(scope,key);
export const randomKey = () => crypto.randomUUID();
