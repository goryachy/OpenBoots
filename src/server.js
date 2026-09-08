import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { db, passwordHash, timestamp, tx } from './db.js';
import { core as demoCore } from './core.js';
import { inventreeConfigured, InvenTreeInventoryCore } from './inventree.js';
import { makeDeliveryPdf, makeLabelHtml, officialViberPublish, parseLabelText, recognizeImage, viberPreview } from './services.js';

const app = express(); const port = Number(process.env.PORT || 3001); const coreMode = process.env.CORE_MODE || 'demo'; const core = coreMode === 'inventree' ? new InvenTreeInventoryCore() : demoCore; const jwtSecret = process.env.JWT_SECRET || 'dev-only-change-me'; if (process.env.NODE_ENV === 'production' && jwtSecret === 'dev-only-change-me') throw new Error('JWT_SECRET must be configured in production'); if (coreMode === 'inventree' && !inventreeConfigured) throw new Error('CORE_MODE=inventree requires INVENTREE_BASE_URL and INVENTREE_TOKEN_FILE or INVENTREE_TOKEN'); if (process.env.NODE_ENV === 'production' && coreMode === 'demo' && process.env.ALLOW_DEMO_PRODUCTION !== 'true') throw new Error('Demo inventory cannot run in production without explicit ALLOW_DEMO_PRODUCTION=true'); const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const productPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.use(helmet({ contentSecurityPolicy: false })); app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true })); app.use(express.json({ limit: '1mb' })); app.use(cookieParser()); app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false }));

const issueToken = (user) => jwt.sign({ sub: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '12h' });
const auth = (req, res, next) => { try { const token = req.cookies.openboots_session || req.headers.authorization?.replace(/^Bearer /, ''); if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Войдите в систему.' }); req.user = jwt.verify(token, jwtSecret); next(); } catch { return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Сессия истекла. Войдите снова.' }); } };
const adminOnly = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'FORBIDDEN', message: 'Недостаточно прав для настройки склада.' });
const validate = (schema) => (req, res, next) => { const result=schema.safeParse(req.body); if(!result.success)return res.status(400).json({error:'VALIDATION_ERROR',message:'Проверьте заполненные поля.',details:result.error.flatten()}); req.body=result.data; next(); };
const safeError = (error, res) => { const map={INSUFFICIENT_STOCK:['INSUFFICIENT_STOCK','Недостаточно товара на складе.'],LOCATION_NOT_EMPTY:['LOCATION_NOT_EMPTY','Нельзя удалить склад: на нём ещё есть остатки.'],LOCATION_NOT_FOUND:['LOCATION_NOT_FOUND','Склад не найден.'],LOCATION_REQUIRES_FLOOR:['LOCATION_REQUIRES_FLOOR','У этого склада настроены этажи. Выберите конкретный этаж.'],LOCATION_NOT_SELLABLE:['LOCATION_NOT_SELLABLE','Товар из «Нераспределено» сначала нужно распределить на склад.'],LOCATION_NOT_RECEIVABLE:['LOCATION_NOT_RECEIVABLE','В этот склад нельзя принимать товар.'],SYSTEM_LOCATION:['SYSTEM_LOCATION','Встроенное системное место нельзя изменить.'],NOTHING_TO_REMOVE:['NOTHING_TO_REMOVE','В этой приёмке уже нет коробок этого товара.'],PRODUCT_IN_USE:['PRODUCT_IN_USE','Товар нельзя удалить: сначала обнулите его остаток.'],PRODUCT_ARCHIVED:['PRODUCT_ARCHIVED','Товар находится в архиве. Сначала восстановите его.'],PRODUCT_HAS_HISTORY:['PRODUCT_HAS_HISTORY','Товар нельзя удалить: сначала обнулите его остаток.'],PRODUCT_HAS_ORDERS:['PRODUCT_HAS_ORDERS','Товар нельзя удалить: он используется в заказах.'],DUPLICATE_BARCODE:['DUPLICATE_BARCODE','Этот штрихкод уже привязан к товару.'],DUPLICATE_COLOR_VARIANT:['DUPLICATE_COLOR_VARIANT','Такой цвет с этим артикулом уже существует.'],UNKNOWN_BARCODE:['UNKNOWN_BARCODE','Штрихкод не найден.'],UNSUPPORTED_IMAGE:['UNSUPPORTED_IMAGE','Добавьте фото в формате JPEG, PNG или WebP.'],IMAGE_REQUIRED:['IMAGE_REQUIRED','Сделайте фото товара или выберите его из галереи.'],IMAGE_TOO_LARGE:['IMAGE_TOO_LARGE','Фото должно быть не больше 8 МБ.'],PRICE_REQUIRED:['PRICE_REQUIRED','Укажите цену товара перед публикацией.'],EMPTY_ORDER:['EMPTY_ORDER','Заказ не содержит товаров.'],ORDER_NOT_DRAFT:['ORDER_NOT_DRAFT','Заказ уже закрыт и не может быть изменён.'],SAME_LOCATION:['SAME_LOCATION','Выберите разные склады.'],NOTHING_TO_UNDO:['NOTHING_TO_UNDO','Нечего отменять.'],SESSION_CLOSED:['SESSION_CLOSED','Приёмка уже завершена. Обновите страницу.'],IDEMPOTENCY_KEY_REQUIRED:['IDEMPOTENCY_KEY_REQUIRED','Повторите сохранение цвета.'],IDEMPOTENCY_KEY_CONFLICT:['IDEMPOTENCY_KEY_CONFLICT','Повторите создание цвета из карточки товара.'],COLOR_OPERATION_INCOMPLETE:['COLOR_OPERATION_INCOMPLETE','Не удалось завершить создание цвета. Повторите с новым фото.'],COLOR_OPERATION_RECONCILIATION_REQUIRED:['COLOR_OPERATION_RECONCILIATION_REQUIRED','Статус прихода в InvenTree нужно проверить перед повтором: новая попытка заблокирована, чтобы не задвоить остаток.'],INVENTREE_NOT_CONFIGURED:['CORE_NOT_CONFIGURED','Inventory core не настроен для production.']}; const [code,message]=map[error.code]||['OPERATION_FAILED','Операция не выполнена. Попробуйте ещё раз.']; console.error(`[${code}]`, error.message); return res.status(code==='INSUFFICIENT_STOCK'||code==='LOCATION_NOT_EMPTY'||code.startsWith('PRODUCT_')||code==='LOCATION_REQUIRES_FLOOR'||code==='DUPLICATE_COLOR_VARIANT'||code==='COLOR_OPERATION_RECONCILIATION_REQUIRED'?409:code==='IMAGE_TOO_LARGE'?413:400).json({error:code,message}); };
const idempotencyLocks = new Map();
const withIdempotencyLock = async (key, operation) => {
  if (!key) return operation();
  const previous = idempotencyLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  idempotencyLocks.set(key, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (idempotencyLocks.get(key) === current) idempotencyLocks.delete(key); }
};
const productPayload = z.object({ name:z.string().min(1), brand:z.string().optional(), model:z.string().optional(), article:z.string().optional(), color:z.string().optional(), sizes:z.array(z.object({size:z.string().min(1),quantity:z.number().int().positive()})).optional(), pairsPerBox:z.number().int().positive().nullable().optional(), salePrice:z.number().nonnegative().nullable().optional(), barcode:z.string().trim().nullable().optional(), internalBarcode:z.string().trim().optional(), note:z.string().optional(), allowSharedBarcode:z.boolean().optional() });
const receivingColorPayload = z.object({ parentProductId:z.coerce.number().int().positive(), article:z.string().trim().min(1).max(120), color:z.string().trim().min(1).max(120), barcode:z.string().trim().min(4).max(120) });
const productsForBarcode = async (barcode) => {
  const ids = db.prepare('SELECT product_id FROM shared_supplier_barcodes WHERE barcode=?').all(barcode).map((row) => row.product_id);
  const direct = await core.findProductByBarcode(barcode);
  if (direct && !ids.includes(direct.id)) ids.unshift(direct.id);
  const products = [];
  for (const id of ids) { const product = await core.getProduct(id); if (product) products.push(product); }
  return products;
};
const resolveScannedProduct = async (barcode, productId) => {
  const products = await productsForBarcode(barcode);
  if (productId) { const selected = products.find((product) => product.id === Number(productId)); if (selected) return activeProduct(selected); }
  if (products.length > 1) throw Object.assign(new Error('VARIANT_SELECTION_REQUIRED'), { code:'VARIANT_SELECTION_REQUIRED', products });
  return products[0] ? activeProduct(products[0]) : null;
};

const locationMeta = (locationId) => db.prepare('SELECT * FROM location_meta WHERE location_id=?').get(Number(locationId));
const locationView = (location) => {
  const meta = locationMeta(location.id);
  const parent = meta?.parent_location_id ? db.prepare('SELECT id,name FROM locations WHERE id=?').get(meta.parent_location_id) : null;
  const floorLabel = meta?.floor_label || (meta?.floor_number ? `${meta.floor_number} этаж` : '');
  const isFloor = Boolean(parent);
  const hasFloors = Boolean(db.prepare('SELECT 1 FROM location_meta WHERE parent_location_id=? AND archived=0 LIMIT 1').get(location.id));
  const warehouseName = parent?.name || location.name;
  return {
    ...location,
    kind: meta?.kind || 'WAREHOUSE',
    receivingEnabled: meta ? Boolean(meta.receiving_enabled) : true,
    salesEnabled: meta ? Boolean(meta.sales_enabled) : true,
    archived: meta ? Boolean(meta.archived) : false,
    parentLocationId: parent?.id || null,
    isFloor,
    hasFloors,
    warehouseId: parent?.id || location.id,
    warehouseName,
    floorNumber: meta?.floor_number || null,
    floorName: isFloor ? floorLabel : null,
    fullLocation: isFloor ? `${warehouseName} · ${floorLabel}` : location.name,
    shortLocation: isFloor ? (meta?.floor_number ? `${meta.floor_number} эт.` : floorLabel) : location.name,
  };
};
const operationalLocations = async ({ includeArchived = false } = {}) => {
  const locations = await core.getLocations();
  if (coreMode === 'inventree') {
    const mirror = db.prepare('INSERT OR IGNORE INTO locations(id,name,active) VALUES (?,?,1)');
    const rename = db.prepare('UPDATE locations SET name=?,active=1 WHERE id=?');
    tx(() => locations.forEach((location) => { mirror.run(location.id, location.name); rename.run(location.name, location.id); }));
  }
  return locations.map(locationView).filter((location) => includeArchived || !location.archived);
};
const writeLocationMeta = (locationId, input = {}) => db.prepare(`INSERT INTO location_meta(location_id,kind,receiving_enabled,sales_enabled,sort_order,archived,parent_location_id,floor_number,floor_label)
  VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET kind=excluded.kind,receiving_enabled=excluded.receiving_enabled,sales_enabled=excluded.sales_enabled,sort_order=excluded.sort_order,archived=excluded.archived,parent_location_id=excluded.parent_location_id,floor_number=excluded.floor_number,floor_label=excluded.floor_label`).run(
  Number(locationId), input.kind || 'WAREHOUSE', input.receivingEnabled === false ? 0 : 1, input.salesEnabled === false ? 0 : 1, Number(input.sortOrder || 0), input.archived ? 1 : 0, input.parentLocationId || null, input.floorNumber || null, input.floorLabel || null,
);
const ensureUnassigned = async () => {
  const saved = db.prepare("SELECT location_id FROM location_meta WHERE kind='UNASSIGNED' AND archived=0 LIMIT 1").get();
  const locations = await core.getLocations();
  if (saved && locations.some((location) => location.id === saved.location_id)) return locationView(locations.find((location) => location.id === saved.location_id));
  const existing = locations.find((location) => location.name.trim().toLowerCase() === 'нераспределено');
  const location = existing || await core.createLocation({ name: 'Нераспределено', description: 'Системное место для принятого товара до распределения' });
  writeLocationMeta(location.id, { kind: 'UNASSIGNED', salesEnabled: false, receivingEnabled: true, sortOrder: -100 });
  return locationView(location);
};
const requireOperationalLocation = async (locationId, capability) => {
  const location = (await operationalLocations({ includeArchived: true })).find((item) => item.id === Number(locationId));
  if (!location || location.archived) throw Object.assign(new Error('LOCATION_NOT_FOUND'), { code: 'LOCATION_NOT_FOUND' });
  if (capability === 'sales' && !location.salesEnabled) throw Object.assign(new Error('LOCATION_NOT_SELLABLE'), { code: 'LOCATION_NOT_SELLABLE' });
  if (capability === 'receive' && !location.receivingEnabled) throw Object.assign(new Error('LOCATION_NOT_RECEIVABLE'), { code: 'LOCATION_NOT_RECEIVABLE' });
  if (location.hasFloors && !location.isFloor) throw Object.assign(new Error('LOCATION_REQUIRES_FLOOR'), { code: 'LOCATION_REQUIRES_FLOOR' });
  return location;
};
const productMeta = (productId) => db.prepare('SELECT * FROM product_meta WHERE product_id=?').get(Number(productId));
const productView = (product) => product ? { ...product, archived: Boolean(productMeta(product.id)?.archived), stock: product.stock?.map((row) => ({ ...row, ...locationView({ id: row.location_id, name: row.name }) })) } : null;
const archiveProduct = (productId, reason = null) => db.prepare(`INSERT INTO product_meta(product_id,archived,archived_at,archived_reason) VALUES (?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET archived=excluded.archived,archived_at=excluded.archived_at,archived_reason=excluded.archived_reason`).run(Number(productId), 1, timestamp(), reason);
const activeProduct = (product) => {
  if (productMeta(product?.id)?.archived) throw Object.assign(new Error('PRODUCT_ARCHIVED'), { code:'PRODUCT_ARCHIVED', product:productView(product) });
  return product;
};

app.post('/api/auth/login', validate(z.object({ username:z.string().min(1), password:z.string().min(1) })), (req,res)=> { const user=db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username); if(!user || passwordHash(req.body.password)!==user.password_hash)return res.status(401).json({error:'INVALID_LOGIN',message:'Неверный логин или пароль.'}); res.cookie('openboots_session',issueToken(user),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*60*60*1000}); res.json({user:{id:user.id,username:user.username,role:user.role}}); });
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('openboots_session');res.json({ok:true});}); app.get('/api/me',auth,(req,res)=>res.json({user:req.user,mode:process.env.CORE_MODE||'demo',inventreeConfigured}));
app.get('/api/health',(req,res)=>res.json({ok:true,mode:process.env.CORE_MODE||'demo',inventreeConfigured}));

const locationPayload = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(250).optional() });
const floorPayload = z.object({ label: z.string().trim().min(1).max(80) });
app.get('/api/locations',auth,async(req,res)=>{try{res.json({locations:await operationalLocations()});}catch(e){safeError(e,res);}});
app.get('/api/brands',auth,async(req,res)=>{try{res.json({brands:await core.getBrands()});}catch(e){safeError(e,res);}});
app.post('/api/locations',auth,adminOnly,validate(locationPayload),async(req,res)=>{try{const location=await core.createLocation(req.body);writeLocationMeta(location.id);res.status(201).json({location:locationView(location)});}catch(e){safeError(e,res);}});
app.post('/api/locations/:id/floors',auth,adminOnly,validate(floorPayload),async(req,res)=>{try{const parent=(await operationalLocations({includeArchived:true})).find((item)=>item.id===Number(req.params.id));if(!parent||parent.kind==='UNASSIGNED'||parent.isFloor||parent.archived)throw Object.assign(new Error('LOCATION_NOT_FOUND'),{code:'LOCATION_NOT_FOUND'});const existingFloors=(await operationalLocations({includeArchived:true})).filter((item)=>item.parentLocationId===parent.id);const next=existingFloors.reduce((max,item)=>Math.max(max,Number(item.floorNumber)||0),0)+1;const label=req.body.label;const parsedNumber=Number.parseInt(label,10);const floorNumber=Number.isInteger(parsedNumber)&&parsedNumber>0?parsedNumber:next;if(existingFloors.some((item)=>item.floorNumber===floorNumber||item.floorName?.trim().toLowerCase()===label.toLowerCase()))throw Object.assign(new Error('DUPLICATE_FLOOR'),{code:'DUPLICATE_FLOOR'});const location=await core.createLocation({name:`${parent.name} · ${label}`,description:`${parent.name}, ${label}`});writeLocationMeta(location.id,{parentLocationId:parent.id,floorNumber,floorLabel:label});res.status(201).json({location:locationView(location)});}catch(e){safeError(e,res);}});
app.patch('/api/locations/:id',auth,adminOnly,validate(locationPayload),async(req,res)=>{try{const current=await requireOperationalLocation(Number(req.params.id));if(current.kind==='UNASSIGNED')return res.status(400).json({error:'SYSTEM_LOCATION',message:'Системное место «Нераспределено» нельзя переименовать.'});res.json({location:locationView(await core.updateLocation(Number(req.params.id),req.body))});}catch(e){safeError(e,res);}});
app.delete('/api/locations/:id',auth,adminOnly,async(req,res)=>{try{const location=(await operationalLocations({includeArchived:true})).find((item)=>item.id===Number(req.params.id));if(location?.hasFloors)return res.status(409).json({error:'LOCATION_HAS_FLOORS',message:'Сначала удалите или архивируйте этажи этого склада.'});res.json(await core.deleteLocation(Number(req.params.id)));}catch(e){safeError(e,res);}});
app.get('/api/products',auth,async(req,res)=>{try{const archived=req.query.archived==='true';const products=(await core.searchProducts(String(req.query.query||''),{inStock:req.query.inStock==='true',brand:req.query.brand,color:req.query.color,size:req.query.size,locationId:req.query.locationId})).map(productView).filter((product)=>product.archived===archived);res.json({products});}catch(e){safeError(e,res);}});
app.get('/api/products/:id',auth,async(req,res)=>{try{const p=await core.getProduct(Number(req.params.id));if(!p)return res.status(404).json({error:'NOT_FOUND',message:'Товар не найден.'});const product=productView(coreMode==='inventree'?p:{...p,stock:core.getStock(p.id),movements:core.getMovementHistory(p.id)});res.json({product});}catch(e){safeError(e,res);}});
app.post('/api/products',auth,validate(productPayload),async(req,res)=>{try{const shared=req.body.allowSharedBarcode&&req.body.barcode&&await productsForBarcode(req.body.barcode);const product=shared?.length?await core.createProduct({...req.body,barcode:null}):await core.createProduct(req.body);if(shared?.length)db.prepare('INSERT OR IGNORE INTO shared_supplier_barcodes(barcode,product_id) VALUES (?,?)').run(req.body.barcode,product.id);res.status(201).json({product});}catch(e){safeError(e,res);}});
app.patch('/api/products/:id',auth,validate(productPayload),async(req,res)=>{try{res.json({product:await core.updateProduct(Number(req.params.id),req.body)});}catch(e){safeError(e,res);}});
app.delete('/api/products/:id',auth,async(req,res)=>{try{res.json(await core.deleteProduct(Number(req.params.id)));}catch(e){safeError(e,res);}});
app.post('/api/products/:id/restore',auth,validate(z.object({resetStock:z.boolean().optional(),reason:z.string().trim().max(250).optional()})),async(req,res)=>{try{const product=await core.getProduct(Number(req.params.id));if(!product)throw Object.assign(new Error('NOT_FOUND'),{code:'NOT_FOUND'});if(req.body.resetStock){for(const row of (await core.getStock(product.id)).filter((item)=>item.quantity>0))await core.mutateStock(product.id,row.location_id,-row.quantity,'WRITE_OFF',req.body.reason||'ARCHIVE_RESTART',req.user.sub);}db.prepare('UPDATE product_meta SET archived=0,archived_at=NULL,archived_reason=NULL WHERE product_id=?').run(Number(req.params.id));res.json({product:productView(await core.getProduct(Number(req.params.id)))});}catch(e){safeError(e,res);}});
app.post('/api/products/:id/close',auth,validate(z.object({action:z.enum(['archive','move','writeoff']),toLocationId:z.number().int().positive().optional(),reason:z.string().trim().max(250).optional()})),async(req,res)=>{try{const product=await core.getProduct(Number(req.params.id));if(!product)throw Object.assign(new Error('NOT_FOUND'),{code:'NOT_FOUND'});const stock=(await core.getStock(product.id)).filter((row)=>row.quantity>0);if(req.body.action==='archive'&&stock.length)throw Object.assign(new Error('PRODUCT_IN_USE'),{code:'PRODUCT_IN_USE'});if(req.body.action==='move'&&!req.body.toLocationId)throw new Error('LOCATION_NOT_FOUND');if(req.body.action==='move'){const target=await requireOperationalLocation(req.body.toLocationId);for(const row of stock)if(row.location_id!==target.id)await core.transfer([{productId:product.id,quantity:row.quantity}],row.location_id,target.id,crypto.randomUUID(),req.user.sub);}if(req.body.action==='writeoff'){for(const row of stock)await core.mutateStock(product.id,row.location_id,-row.quantity,'WRITE_OFF',req.body.reason||'ARCHIVE',req.user.sub);}archiveProduct(product.id,req.body.reason||req.body.action);res.json({product:productView(await core.getProduct(product.id))});}catch(e){safeError(e,res);}});
const imageMime = (buffer) => {
  if (buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer?.subarray(0, 4).toString() === 'RIFF' && buffer?.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
};
app.post('/api/products/:id/photo',auth,productPhotoUpload.single('image'),async(req,res)=>{try{if(!req.file)throw Object.assign(new Error('IMAGE_REQUIRED'),{code:'IMAGE_REQUIRED'});const mime=imageMime(req.file.buffer);if(!mime)throw Object.assign(new Error('UNSUPPORTED_IMAGE'),{code:'UNSUPPORTED_IMAGE'});req.file.mimetype=mime;res.json({product:await core.setProductPhoto(Number(req.params.id),req.file)});}catch(e){safeError(e,res);}});
app.get('/api/products/:id/photo',auth,async(req,res)=>{try{const photo=await core.getProductPhoto(Number(req.params.id));if(!photo)return res.status(404).json({error:'NOT_FOUND',message:'У товара ещё нет фотографии.'});res.set('Cache-Control','no-store').type(photo.mime).send(photo.buffer);}catch(e){safeError(e,res);}});
app.delete('/api/products/:id/photo',auth,async(req,res)=>{try{res.json({product:await core.removeProductPhoto(Number(req.params.id))});}catch(e){safeError(e,res);}});
app.post('/api/receiving/sessions/:id/colors',auth,productPhotoUpload.single('image'),async(req,res)=>{try{
  const input=receivingColorPayload.parse(req.body);
  const sessionId=Number(req.params.id); const key=String(req.headers['idempotency-key']||'');
  if(!key)throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'),{code:'IDEMPOTENCY_KEY_REQUIRED'});
  if(!req.file)throw Object.assign(new Error('IMAGE_REQUIRED'),{code:'IMAGE_REQUIRED'});
  const mime=imageMime(req.file.buffer); if(!mime)throw Object.assign(new Error('UNSUPPORTED_IMAGE'),{code:'UNSUPPORTED_IMAGE'}); req.file.mimetype=mime;
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(input)).update(req.file.buffer).digest('hex');
  const response=await withIdempotencyLock(`receiving-color:${sessionId}:${key}`,async()=>{
    let operation=db.prepare('SELECT * FROM receiving_color_operations WHERE session_id=? AND idempotency_key=?').get(sessionId,key);
    if(!operation){
      const interrupted=db.prepare("SELECT * FROM receiving_color_operations WHERE session_id=? AND parent_product_id=? AND barcode=? AND received=0 AND receive_started=0 ORDER BY created_at DESC LIMIT 1").get(sessionId,input.parentProductId,input.barcode);
      if(interrupted?.product_id){
        const interruptedProduct=await core.getProduct(interrupted.product_id);
        if(interruptedProduct&&String(interruptedProduct.article||'').trim()===input.article&&String(interruptedProduct.color||'').trim()===input.color){
          db.prepare('UPDATE receiving_color_operations SET idempotency_key=?,request_fingerprint=? WHERE session_id=? AND idempotency_key=?').run(key,fingerprint,sessionId,interrupted.idempotency_key);
          operation=db.prepare('SELECT * FROM receiving_color_operations WHERE session_id=? AND idempotency_key=?').get(sessionId,key);
        }
      }
    }
    if(operation?.parent_product_id!==undefined&&(operation.parent_product_id!==input.parentProductId||operation.request_fingerprint!==fingerprint))throw Object.assign(new Error('IDEMPOTENCY_KEY_CONFLICT'),{code:'IDEMPOTENCY_KEY_CONFLICT'});
    if(operation?.received){
      if(operation.response_json)return {status:200,body:JSON.parse(operation.response_json)};
      const product=await core.getProduct(operation.product_id);
      return {status:200,body:{product:productView(product),barcode:operation.barcode,quantity:1,stock:await core.getStock(operation.product_id),sessionId}};
    }
    const session=db.prepare("SELECT * FROM receiving_sessions WHERE id=? AND status='OPEN'").get(sessionId); if(!session)throw new Error('SESSION_CLOSED');
    let product;
    if(operation?.product_id){ product=await core.getProduct(operation.product_id); if(!product)throw Object.assign(new Error('COLOR_OPERATION_INCOMPLETE'),{code:'COLOR_OPERATION_INCOMPLETE'}); }
    else {
      const parent=activeProduct(await core.getProduct(input.parentProductId)); if(!parent)throw Object.assign(new Error('NOT_FOUND'),{code:'NOT_FOUND'});
      if((await productsForBarcode(input.barcode)).length)throw Object.assign(new Error('DUPLICATE_BARCODE'),{code:'DUPLICATE_BARCODE'});
      const normalized=(value)=>String(value||'').trim().toLocaleLowerCase();
      const duplicate=(await core.searchProducts(input.article)).find((candidate)=>normalized(candidate.brand)===normalized(parent.brand)&&normalized(candidate.name)===normalized(parent.name)&&normalized(candidate.model)===normalized(parent.model)&&normalized(candidate.article)===normalized(input.article)&&normalized(candidate.color)===normalized(input.color));
      if(duplicate)throw Object.assign(new Error('DUPLICATE_COLOR_VARIANT'),{code:'DUPLICATE_COLOR_VARIANT'});
      product=await core.createProduct({name:parent.name,brand:parent.brand,model:parent.model,article:input.article,color:input.color,sizes:parent.sizes,pairsPerBox:parent.pairsPerBox,salePrice:parent.salePrice,note:parent.note,barcode:input.barcode});
      db.prepare('INSERT INTO receiving_color_operations(session_id,idempotency_key,parent_product_id,request_fingerprint,product_id,barcode,created_at) VALUES (?,?,?,?,?,?,?)').run(sessionId,key,input.parentProductId,fingerprint,product.id,input.barcode,timestamp());
      operation=db.prepare('SELECT * FROM receiving_color_operations WHERE session_id=? AND idempotency_key=?').get(sessionId,key);
    }
    product=await core.setProductPhoto(product.id,req.file);
    if(coreMode==='inventree'){
      if(operation?.receive_started)throw Object.assign(new Error('COLOR_OPERATION_RECONCILIATION_REQUIRED'),{code:'COLOR_OPERATION_RECONCILIATION_REQUIRED'});
      db.prepare('UPDATE receiving_color_operations SET receive_started=1 WHERE session_id=? AND idempotency_key=?').run(sessionId,key);
      await core.receive(product.id,session.location_id,1,`color:${session.id}:${key}`);
      tx(()=>{db.prepare('INSERT INTO receiving_events(session_id,product_id,quantity,barcode,created_at) VALUES (?,?,?,?,?)').run(session.id,product.id,1,input.barcode,timestamp());db.prepare('UPDATE receiving_color_operations SET received=1 WHERE session_id=? AND idempotency_key=?').run(sessionId,key);});
    } else tx(()=>{core.mutateStock(product.id,session.location_id,1,'RECEIVE',String(session.id),req.user.sub);db.prepare('INSERT INTO receiving_events(session_id,product_id,quantity,barcode,created_at) VALUES (?,?,?,?,?)').run(session.id,product.id,1,input.barcode,timestamp());db.prepare('UPDATE receiving_color_operations SET received=1 WHERE session_id=? AND idempotency_key=?').run(sessionId,key);});
    const body={product:productView(product),barcode:input.barcode,quantity:1,stock:await core.getStock(product.id),sessionId};
    db.prepare('UPDATE receiving_color_operations SET received=1,response_json=? WHERE session_id=? AND idempotency_key=?').run(JSON.stringify(body),sessionId,key);
    return {status:201,body};
  });
  res.status(response.status).json(response.body);
}catch(e){if(e instanceof z.ZodError)return res.status(400).json({error:'VALIDATION_ERROR',message:'Проверьте заполненные поля.',details:e.flatten()});safeError(e,res);}});
app.post('/api/products/:id/link-barcode',auth,validate(z.object({barcode:z.string().min(4)})),async(req,res)=>{try{res.json({product:await core.linkBarcode(Number(req.params.id),req.body.barcode)});}catch(e){safeError(e,res);}});

app.post('/api/scan',auth,validate(z.object({barcode:z.string().trim().min(4),productId:z.number().int().positive().optional()})),async(req,res)=>{try{const product=await resolveScannedProduct(req.body.barcode,req.body.productId);if(!product)return res.status(404).json({error:'UNKNOWN_BARCODE',message:'Штрихкод не найден.',barcode:req.body.barcode});res.json({product,stock:await core.getStock(product.id)});}catch(e){if(e.code==='VARIANT_SELECTION_REQUIRED')return res.status(409).json({error:e.code,message:'Штрихкод соответствует нескольким цветам.',products:e.products,barcode:req.body.barcode});if(e.code==='PRODUCT_ARCHIVED')return res.status(409).json({error:e.code,message:'Товар находится в архиве.',product:e.product,barcode:req.body.barcode});safeError(e,res);}});
app.post('/api/receiving/sessions',auth,validate(z.object({locationId:z.number().int().positive().optional()})),async(req,res)=>{try{const location=req.body.locationId ? await requireOperationalLocation(req.body.locationId,'receive') : await ensureUnassigned();if(coreMode==='inventree')db.prepare('INSERT OR IGNORE INTO locations(id,name,active) VALUES (?,?,1)').run(location.id,location.name);const r=db.prepare('INSERT INTO receiving_sessions(location_id,created_at) VALUES (?,?)').run(location.id,timestamp());res.status(201).json({session:{id:r.lastInsertRowid,locationId:location.id,status:'OPEN',events:[]},location});}catch(e){safeError(e,res);}});
app.get('/api/receiving/sessions/:id',auth,async(req,res)=>{try{const session=db.prepare('SELECT * FROM receiving_sessions WHERE id=?').get(Number(req.params.id));if(!session)return res.status(404).json({error:'NOT_FOUND',message:'Приёмка не найдена.'});const rows=db.prepare('SELECT product_id,MAX(barcode) barcode,SUM(quantity) quantity FROM receiving_events WHERE session_id=? GROUP BY product_id').all(session.id);const lines=[];for(const row of rows){const product=await core.getProduct(row.product_id);if(product)lines.push({product,barcode:row.barcode,quantity:row.quantity});}res.json({session:{id:session.id,locationId:session.location_id,status:session.status,createdAt:session.created_at,lines}});}catch(e){safeError(e,res);}});
app.get('/api/receiving/batches',auth,async(req,res)=>{try{const source=await ensureUnassigned();const sessions=db.prepare("SELECT * FROM receiving_sessions WHERE status='COMPLETED' AND location_id=? ORDER BY id DESC").all(source.id);const batches=[];for(const session of sessions){const rows=db.prepare('SELECT e.product_id,MAX(e.barcode) barcode,SUM(e.quantity)-COALESCE((SELECT SUM(a.quantity) FROM receiving_allocations a WHERE a.session_id=e.session_id AND a.product_id=e.product_id),0) quantity FROM receiving_events e WHERE e.session_id=? GROUP BY e.product_id HAVING quantity>0').all(session.id);const lines=[];for(const row of rows){const product=await core.getProduct(row.product_id);if(product)lines.push({product,barcode:row.barcode,quantity:row.quantity});}if(lines.length)batches.push({id:session.id,createdAt:session.created_at,total:lines.reduce((sum,line)=>sum+line.quantity,0),lines});}res.json({batches});}catch(e){safeError(e,res);}});
const receiveScan = async (req,res,quantity=1) => {
  const sessionId=Number(req.params.id); const key=req.headers['idempotency-key'];
  try { await withIdempotencyLock(key ? `receive:${sessionId}:${String(key)}` : null, async()=>{
    const session=db.prepare("SELECT * FROM receiving_sessions WHERE id=? AND status='OPEN'").get(sessionId); if(!session)throw new Error('SESSION_CLOSED');
    const previous=key&&db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get(`receive:${session.id}`,String(key)); if(previous)return res.json(JSON.parse(previous.response_json));
    const product=await resolveScannedProduct(req.body.barcode,req.body.productId); if(!product) return res.status(404).json({error:'UNKNOWN_BARCODE',message:'Штрихкод не найден.',barcode:req.body.barcode});
    if(coreMode==='inventree')await core.receive(product.id,session.location_id,quantity,session.id);else tx(()=>core.mutateStock(product.id,session.location_id,quantity,'RECEIVE',String(session.id),req.user.sub));
    db.prepare('INSERT INTO receiving_events(session_id,product_id,quantity,barcode,created_at) VALUES (?,?,?,?,?)').run(session.id,product.id,quantity,req.body.barcode,timestamp());
    const response={product,barcode:req.body.barcode,quantity,stock:await core.getStock(product.id),sessionId:session.id}; if(key)db.prepare('INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)').run(`receive:${session.id}`,String(key),JSON.stringify(response),timestamp()); res.json(response);
  }); } catch(e){if(e.code==='VARIANT_SELECTION_REQUIRED')return res.status(409).json({error:e.code,message:'Штрихкод соответствует нескольким цветам.',products:e.products,barcode:req.body.barcode});if(e.code==='PRODUCT_ARCHIVED')return res.status(409).json({error:e.code,message:'Товар находится в архиве.',product:e.product,barcode:req.body.barcode});safeError(e,res);}
};
app.post('/api/receiving/sessions/:id/scan',auth,validate(z.object({barcode:z.string().trim().min(4),productId:z.number().int().positive().optional()})),(req,res)=>receiveScan(req,res));
app.post('/api/receiving/sessions/:id/quantity',auth,validate(z.object({barcode:z.string().trim().min(4),quantity:z.number().int().positive().max(10000)})),(req,res)=>receiveScan(req,res,req.body.quantity));
app.post('/api/receiving/sessions/:id/remove-one',auth,validate(z.object({barcode:z.string().trim().min(4),productId:z.number().int().positive().optional()})),async(req,res)=>{try{const session=db.prepare("SELECT * FROM receiving_sessions WHERE id=? AND status='OPEN'").get(Number(req.params.id));if(!session)throw new Error('SESSION_CLOSED');const product=await resolveScannedProduct(req.body.barcode,req.body.productId);if(!product)return res.status(404).json({error:'UNKNOWN_BARCODE',message:'Штрихкод не найден.'});const event=db.prepare('SELECT * FROM receiving_events WHERE session_id=? AND product_id=? ORDER BY id DESC LIMIT 1').get(session.id,product.id);if(!event)throw Object.assign(new Error('NOTHING_TO_REMOVE'),{code:'NOTHING_TO_REMOVE'});if(coreMode==='inventree')await core.mutateStock(product.id,session.location_id,-1,'RECEIVE_CORRECTION',String(session.id));else tx(()=>core.mutateStock(product.id,session.location_id,-1,'RECEIVE_CORRECTION',String(session.id),req.user.sub));if(event.quantity===1)db.prepare('DELETE FROM receiving_events WHERE id=?').run(event.id);else db.prepare('UPDATE receiving_events SET quantity=quantity-1 WHERE id=?').run(event.id);res.json({product,barcode:req.body.barcode,quantity:-1,stock:await core.getStock(product.id),sessionId:session.id});}catch(e){safeError(e,res);}});
app.post('/api/receiving/sessions/:id/set-quantity',auth,validate(z.object({barcode:z.string().trim().min(4),productId:z.number().int().positive().optional(),quantity:z.number().int().nonnegative().max(10000)})),async(req,res)=>{try{const session=db.prepare("SELECT * FROM receiving_sessions WHERE id=? AND status='OPEN'").get(Number(req.params.id));if(!session)throw new Error('SESSION_CLOSED');const product=await resolveScannedProduct(req.body.barcode,req.body.productId);if(!product)return res.status(404).json({error:'UNKNOWN_BARCODE',message:'Штрихкод не найден.'});const current=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM receiving_events WHERE session_id=? AND product_id=?').get(session.id,product.id).quantity;const delta=req.body.quantity-current;if(delta){if(coreMode==='inventree')await core.mutateStock(product.id,session.location_id,delta,'RECEIVE_CORRECTION',String(session.id));else tx(()=>core.mutateStock(product.id,session.location_id,delta,'RECEIVE_CORRECTION',String(session.id),req.user.sub));db.prepare('DELETE FROM receiving_events WHERE session_id=? AND product_id=?').run(session.id,product.id);if(req.body.quantity)db.prepare('INSERT INTO receiving_events(session_id,product_id,quantity,barcode,created_at) VALUES (?,?,?,?,?)').run(session.id,product.id,req.body.quantity,req.body.barcode,timestamp());}res.json({product,barcode:req.body.barcode,quantity:req.body.quantity,delta,sessionId:session.id});}catch(e){safeError(e,res);}});
app.post('/api/receiving/sessions/:id/undo',auth,async(req,res)=>{try{const event=db.prepare('SELECT * FROM receiving_events WHERE session_id=? ORDER BY id DESC LIMIT 1').get(Number(req.params.id));if(!event)return res.status(400).json({error:'NOTHING_TO_UNDO',message:'Нечего отменять.'});const session=db.prepare("SELECT * FROM receiving_sessions WHERE id=? AND status='OPEN'").get(event.session_id);if(!session)throw new Error('SESSION_CLOSED');if(coreMode==='inventree')await core.mutateStock(event.product_id,session.location_id,-event.quantity,'RECEIVE_UNDO',String(session.id));else tx(()=>core.mutateStock(event.product_id,session.location_id,-event.quantity,'RECEIVE_UNDO',String(session.id),req.user.sub));db.prepare('DELETE FROM receiving_events WHERE id=?').run(event.id);res.json({ok:true,product:await core.getProduct(event.product_id),quantity:event.quantity,stock:await core.getStock(event.product_id)});}catch(e){safeError(e,res);}});
app.post('/api/receiving/sessions/:id/complete',auth,(req,res)=>{db.prepare("UPDATE receiving_sessions SET status='COMPLETED' WHERE id=? AND status='OPEN'").run(Number(req.params.id));res.json({ok:true});});

app.post('/api/transfers',auth,validate(z.object({fromLocationId:z.number().int().positive(),toLocationId:z.number().int().positive(),lines:z.array(z.object({productId:z.number().int().positive(),quantity:z.number().int().positive()})).min(1)})),async(req,res)=>{
  if(req.body.fromLocationId===req.body.toLocationId)return res.status(400).json({error:'SAME_LOCATION',message:'Выберите разные места.'});
  const key=req.headers['idempotency-key'];
  try { await withIdempotencyLock(key ? `transfer:${String(key)}` : null, async()=>{
    if(key){const previous=db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get('transfer',String(key));if(previous)return res.json(JSON.parse(previous.response_json));}
    const transferId=crypto.randomUUID();
    if(coreMode==='inventree')await core.transfer(req.body.lines,req.body.fromLocationId,req.body.toLocationId,transferId);else tx(()=>core.transfer(req.body.lines,req.body.fromLocationId,req.body.toLocationId,transferId,req.user.sub));
    const result={ok:true};
    if(key)db.prepare('INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)').run('transfer',String(key),JSON.stringify(result),timestamp());
    res.json(result);
  }); } catch(e){safeError(e,res);}
});
app.post('/api/distributions',auth,validate(z.object({batchId:z.number().int().positive().optional(),toLocationId:z.number().int().positive(),lines:z.array(z.object({productId:z.number().int().positive(),quantity:z.number().int().positive()})).min(1)})),async(req,res)=>{
  const key=req.headers['idempotency-key'];
  try { await withIdempotencyLock(key ? `distribution:${String(key)}` : null, async()=>{
    if(key){const previous=db.prepare('SELECT response_json FROM idempotency WHERE scope=? AND key=?').get('distribution',String(key));if(previous)return res.json(JSON.parse(previous.response_json));}
    const source=await ensureUnassigned(); const destination=await requireOperationalLocation(req.body.toLocationId);
    if(destination.kind==='UNASSIGNED') throw Object.assign(new Error('SAME_LOCATION'),{code:'SAME_LOCATION'});
    const distributionId=crypto.randomUUID();
    if(req.body.batchId){for(const line of req.body.lines){const received=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM receiving_events WHERE session_id=? AND product_id=?').get(req.body.batchId,line.productId).quantity;const allocated=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM receiving_allocations WHERE session_id=? AND product_id=?').get(req.body.batchId,line.productId).quantity;if(line.quantity>received-allocated)throw Object.assign(new Error('INSUFFICIENT_STOCK'),{code:'INSUFFICIENT_STOCK'});}}
    if(coreMode==='inventree')await core.transfer(req.body.lines,source.id,destination.id,distributionId);else tx(()=>core.transfer(req.body.lines,source.id,destination.id,distributionId,req.user.sub));
    if(req.body.batchId)for(const line of req.body.lines)db.prepare('INSERT INTO receiving_allocations(session_id,product_id,location_id,quantity,created_at) VALUES (?,?,?,?,?)').run(req.body.batchId,line.productId,destination.id,line.quantity,timestamp());
    const result={ok:true,fromLocationId:source.id,toLocationId:destination.id};
    if(key)db.prepare('INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)').run('distribution',String(key),JSON.stringify(result),timestamp());res.json(result);
  }); }catch(e){safeError(e,res);}
});

app.get('/api/customers',auth,async(req,res)=>{try{res.json({customers:await core.searchCustomers(String(req.query.query||''))});}catch(e){safeError(e,res);}}); app.post('/api/customers',auth,validate(z.object({name:z.string().min(1),phone:z.string().min(5),note:z.string().optional()})),async(req,res)=>{try{res.status(201).json({customer:await core.createCustomer(req.body)});}catch(e){safeError(e,res);}});
app.post('/api/orders',auth,validate(z.object({customerId:z.number().int().positive().optional(),name:z.string().min(1).optional(),phone:z.string().min(5).optional(),sourceLocationId:z.number().int().positive(),note:z.string().optional()})),async(req,res)=>{try{res.status(201).json({order:await core.createOrder(req.body)});}catch(e){safeError(e,res);}});
app.get('/api/orders/:id',auth,async(req,res)=>{try{const order=await core.getOrder(Number(req.params.id));if(!order)return res.status(404).json({error:'NOT_FOUND',message:'Заказ не найден.'});res.json({order});}catch(e){safeError(e,res);}});
app.post('/api/orders/:id/scan',auth,validate(z.object({barcode:z.string().trim().min(4)})),async(req,res)=>{try{const p=await core.findProductByBarcode(req.body.barcode);if(!p)return res.status(404).json({error:'UNKNOWN_BARCODE',message:'Штрихкод не найден.',barcode:req.body.barcode});res.json({order:await core.addOrderLine(Number(req.params.id),p.id,1),product:p});}catch(e){safeError(e,res);}});
app.post('/api/orders/:id/confirm',auth,async(req,res)=>{try{const key=req.headers['idempotency-key']||crypto.randomUUID();res.json({order:await core.confirmOrder(Number(req.params.id),String(key),req.user.sub)});}catch(e){safeError(e,res);}}); app.post('/api/orders/:id/cancel',auth,async(req,res)=>{try{res.json({order:await core.cancelOrder(Number(req.params.id))});}catch(e){safeError(e,res);}});
app.get('/api/orders/:id/delivery-note.pdf',auth,async(req,res)=>{try{const order=await core.getOrder(Number(req.params.id));if(!order||order.status!=='CONFIRMED')return res.status(400).json({error:'NOT_CONFIRMED',message:'Сначала подтвердите продажу.'});makeDeliveryPdf(order,res);}catch(e){safeError(e,res);}});
app.get('/api/products/:id/label',auth,async(req,res)=>{try{const p=await core.getProduct(Number(req.params.id));if(!p)return res.status(404).send('Not found');res.type('html').send(await makeLabelHtml(p));}catch(e){safeError(e,res);}});
app.get('/api/products/:id/movements',auth,async(req,res)=>{try{res.json({movements:await core.getMovementHistory(Number(req.params.id))});}catch(e){safeError(e,res);}});

app.post('/api/ocr/parse',auth,validate(z.object({text:z.string()})),(req,res)=>res.json({fields:parseLabelText(req.body.text)}));
app.post('/api/ocr/recognize',auth,upload.single('image'),async(req,res)=>{try{if(!req.file && !req.body.text)return res.status(400).json({error:'IMAGE_REQUIRED',message:'Добавьте фото этикетки.'});const result=req.file?await recognizeImage(req.file.buffer):{text:req.body.text,confidence:1};res.json({...result,fields:parseLabelText(result.text)});}catch(e){safeError(e,res);}});
app.post('/api/viber/preview',auth,validate(productPayload),(req,res)=>{try{res.json({message:viberPreview(req.body)});}catch(e){safeError(e,res);}});
app.post('/api/viber/publish',auth,validate(z.object({message:z.string().min(1)})),async(req,res)=>{try{res.json(await officialViberPublish(req.body.message));}catch(e){safeError(e,res);}});
app.post('/api/counts',auth,validate(z.object({locationId:z.number().int().positive()})),async(req,res)=>{try{res.status(201).json({count:await core.beginCount(req.body.locationId)});}catch(e){safeError(e,res);}}); app.get('/api/counts/:id',auth,async(req,res)=>{try{res.json({count:await core.getCount(Number(req.params.id))});}catch(e){safeError(e,res);}}); app.post('/api/counts/:id/lines',auth,validate(z.object({productId:z.number().int().positive(),actual:z.number().int().nonnegative()})),async(req,res)=>{try{res.json({count:await core.updateCountLine(Number(req.params.id),req.body.productId,req.body.actual)});}catch(e){safeError(e,res);}}); app.post('/api/counts/:id/apply',auth,async(req,res)=>{try{res.json({count:await core.applyCount(Number(req.params.id),req.user.sub)});}catch(e){safeError(e,res);}});

const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist'); app.use(express.static(publicDir)); app.get(/^(?!\/api).*/, (req,res,next)=>res.sendFile(path.join(publicDir,'index.html'), (error)=>error?next():undefined)); app.use((err,req,res,next)=>{if(err instanceof multer.MulterError&&err.code==='LIMIT_FILE_SIZE')return safeError({code:'IMAGE_TOO_LARGE',message:err.message},res);console.error(err);res.status(500).json({error:'SERVER_ERROR',message:'Внутренняя ошибка сервера.'});});
if (process.env.NODE_ENV !== 'test') app.listen(port,()=>console.log(`OpenBoots server listening on http://localhost:${port}`));
export { app };
