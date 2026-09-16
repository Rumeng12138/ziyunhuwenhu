const express = require('express');
const multer = require('multer');
const fs = require('fs');
const db = require('../config/db');
const { adminRequired, ownerRequired } = require('../middleware/admin');
const adminAccess = require('../services/admin-access');

const { quantity: validateQuantity, cents, paymentVerified } = require('../services/commerce');
const { cancelPayment } = require('../services/payments');
const router = express.Router();
const { loginLimit } = require('../middleware/login-limit');
const pagination = require('../services/pagination');
const validate = require('../services/validation');
const { saveImage } = require('../services/image-upload');
const {uploadDir}=require('../config/storage');

const normalizeProductOrder = db.transaction(() => {
  const products = db.prepare('SELECT id FROM products ORDER BY sort_order ASC, id ASC').all();
  const update = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
  products.forEach((product, index) => update.run(index + 1, product.id));
  return products.length;
});

const moveProductToPosition = db.transaction((id, targetPosition, expectedPosition) => {
  const products = db.prepare('SELECT id, sort_order FROM products ORDER BY sort_order ASC, id ASC').all();
  const currentIndex = products.findIndex(product => product.id === id);
  if (currentIndex === -1 || products[currentIndex].sort_order !== expectedPosition) return null;
  const [product] = products.splice(currentIndex, 1);
  products.splice(targetPosition - 1, 0, product);
  const update = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
  products.forEach((item, index) => update.run(index + 1, item.id));
  return { sort_order: targetPosition, total: products.length };
});

const normalizeCategoryOrder = db.transaction(() => {
  const categories = db.prepare('SELECT code FROM product_categories ORDER BY sort_order ASC, code ASC').all();
  const update = db.prepare('UPDATE product_categories SET sort_order=? WHERE code=?');
  categories.forEach((category, index) => update.run(index + 1, category.code));
  return categories.length;
});

const moveCategoryToPosition = db.transaction((code, targetPosition) => {
  const categories = db.prepare('SELECT code FROM product_categories ORDER BY sort_order ASC, code ASC').all();
  const currentIndex = categories.findIndex(category => category.code.toLowerCase() === code.toLowerCase());
  if (currentIndex < 0) return null;
  const [category] = categories.splice(currentIndex, 1);
  categories.splice(Math.max(0, Math.min(targetPosition - 1, categories.length)), 0, category);
  const update = db.prepare("UPDATE product_categories SET sort_order=?,updated_at=datetime('now','localtime') WHERE code=?");
  categories.forEach((item, index) => update.run(index + 1, item.code));
  return categories.length;
});

function categoryCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) {
    throw Object.assign(new Error('分类代码须为1至32位小写字母、数字、横线或下划线'), { status: 400 });
  }
  return code;
}

function productCategory(value) {
  const code = categoryCode(value);
  const category = db.prepare('SELECT code FROM product_categories WHERE code=? COLLATE NOCASE').get(code);
  if (!category) throw Object.assign(new Error('商品分类不存在，请先在分类设置中创建'), { status: 400 });
  return category.code;
}

function subcategoryCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) {
    throw Object.assign(new Error('子分类代码须为1至32位小写字母、数字、横线或下划线'), { status: 400 });
  }
  return code;
}

function productSubcategory(category, value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const code = subcategoryCode(value);
  const subcategory = db.prepare('SELECT code FROM product_subcategories WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE').get(category, code);
  if (!subcategory) throw Object.assign(new Error('商品子分类不存在或不属于所选主分类'), { status: 400 });
  return subcategory.code;
}

function categoryPosition(value, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position < 1 || position > max) {
    throw Object.assign(new Error(`分类位置须为1至${max}的整数`), { status: 400 });
  }
  return position;
}

function categoryList() {
  const categories = db.prepare(`
    SELECT c.code,c.name_zh,c.name_en,c.sort_order,c.enabled,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM products p WHERE p.category=c.code COLLATE NOCASE) product_count
    FROM product_categories c ORDER BY c.sort_order ASC,c.code ASC
  `).all();
  const subcategories = db.prepare(`
    SELECT s.category_code,s.code,s.name_zh,s.name_en,s.sort_order,s.enabled,s.created_at,s.updated_at,
      (SELECT COUNT(*) FROM products p WHERE p.category=s.category_code COLLATE NOCASE AND p.subcategory=s.code COLLATE NOCASE) product_count
    FROM product_subcategories s ORDER BY s.category_code ASC,s.sort_order ASC,s.code ASC
  `).all();
  for (const category of categories) category.children = subcategories.filter(subcategory => subcategory.category_code.toLowerCase() === category.code.toLowerCase());
  return categories;
}

const moveSubcategoryToPosition = db.transaction((categoryCodeValue, code, targetPosition) => {
  const subcategories = db.prepare('SELECT code FROM product_subcategories WHERE category_code=? COLLATE NOCASE ORDER BY sort_order ASC,code ASC').all(categoryCodeValue);
  const currentIndex = subcategories.findIndex(subcategory => subcategory.code.toLowerCase() === code.toLowerCase());
  if (currentIndex < 0) return null;
  const [subcategory] = subcategories.splice(currentIndex, 1);
  subcategories.splice(Math.max(0, Math.min(targetPosition - 1, subcategories.length)), 0, subcategory);
  const update = db.prepare("UPDATE product_subcategories SET sort_order=?,updated_at=datetime('now','localtime') WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE");
  subcategories.forEach((item, index) => update.run(index + 1, categoryCodeValue, item.code));
  return subcategories.length;
});

// ===== 文件上传配置 =====
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 },
});

// 管理员登录
router.post('/login', loginLimit, (req, res) => {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'ziyunhu_wenfang_secret_key_2026';
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || Buffer.byteLength(password)>72) {
    return res.status(400).json({ code: 400, message: '账号和密码不能为空' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_admin = 1 AND admin_active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ code: 401, message: '管理员账号或密码错误' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, is_admin: 1, session_version:user.session_version }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ code: 200, message: '登录成功', data: { token, admin: adminAccess.publicAdmin(user) } });
});

router.get('/me',adminRequired,(req,res)=>res.json({code:200,data:{admin:adminAccess.publicAdmin(req.admin),permission_options:adminAccess.PERMISSIONS}}));

function staffIdentity(input) {
  const username=String(input.username||'').trim();
  const nickname=validate.text(input.nickname,'显示名称',{min:1,max:40});
  if(!/^[A-Za-z0-9_.-]{3,32}$/.test(username)){
    throw Object.assign(new Error('子账号须为3至32位字母、数字、点、横线或下划线'),{status:400});
  }
  return {username,nickname,permissions:adminAccess.normalizePermissions(input.permissions)};
}

function staffPassword(password,required=true){
  if(!required&&(password===undefined||password===''))return null;
  if(typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72){
    throw Object.assign(new Error('子账号密码须为8至72个字节'),{status:400});
  }
  return password;
}

router.get('/staff',ownerRequired,(req,res)=>{
  const list=db.prepare("SELECT id,username,nickname,admin_permissions,created_at FROM users WHERE is_admin=1 AND is_owner=0 AND admin_active=1 ORDER BY id DESC").all()
    .map(row=>({...adminAccess.publicAdmin({...row,is_owner:0}),created_at:row.created_at}));
  res.json({code:200,data:{list,permission_options:adminAccess.PERMISSIONS}});
});

router.post('/staff',ownerRequired,(req,res)=>{
  const bcrypt=require('bcryptjs');
  const values=staffIdentity(req.body);
  const password=staffPassword(req.body.password);
  if(db.prepare('SELECT id FROM users WHERE username=?').get(values.username))return res.status(409).json({code:409,message:'账号已存在'});
  const result=db.prepare("INSERT INTO users(username,password,nickname,is_admin,is_owner,admin_active,admin_permissions) VALUES(?,?,?,1,0,1,?)")
    .run(values.username,bcrypt.hashSync(password,12),values.nickname,JSON.stringify(values.permissions));
  const row=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
  res.json({code:200,message:'子账号已创建',data:adminAccess.publicAdmin(row)});
});

router.put('/staff/:id',ownerRequired,(req,res)=>{
  const bcrypt=require('bcryptjs');
  const id=validate.id(req.params.id,'子账号ID');
  const target=db.prepare('SELECT * FROM users WHERE id=? AND is_admin=1 AND is_owner=0 AND admin_active=1').get(id);
  if(!target)return res.status(404).json({code:404,message:'子账号不存在'});
  const values=staffIdentity(req.body);
  const password=staffPassword(req.body.password,false);
  const duplicate=db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(values.username,id);
  if(duplicate)return res.status(409).json({code:409,message:'账号已存在'});
  db.prepare(`UPDATE users SET username=?,nickname=?,admin_permissions=?,password=COALESCE(?,password),session_version=session_version+1 WHERE id=?`)
    .run(values.username,values.nickname,JSON.stringify(values.permissions),password?bcrypt.hashSync(password,12):null,id);
  res.json({code:200,message:'子账号已更新，原登录会话已失效',data:adminAccess.publicAdmin(db.prepare('SELECT * FROM users WHERE id=?').get(id))});
});

router.delete('/staff/:id',ownerRequired,(req,res)=>{
  const id=validate.id(req.params.id,'子账号ID');
  const changed=db.prepare('UPDATE users SET admin_active=0,session_version=session_version+1 WHERE id=? AND is_admin=1 AND is_owner=0 AND admin_active=1').run(id);
  if(!changed.changes)return res.status(404).json({code:404,message:'子账号不存在'});
  res.json({code:200,message:'子账号已删除，其登录会话已失效'});
});

router.delete('/staff/:id',ownerRequired,(req,res)=>{
  const id=validate.id(req.params.id,'子账号ID');
  const changed=db.prepare('UPDATE users SET admin_active=0,session_version=session_version+1 WHERE id=? AND is_admin=1 AND is_owner=0 AND admin_active=1').run(id);
  if(!changed.changes)return res.status(404).json({code:404,message:'子账号不存在'});
  res.json({code:200,message:'子账号已删除，历史操作记录已保留'});
});

// ===== 仪表盘统计 =====
router.get('/dashboard', adminRequired, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0').get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const verifiedSql = "(payment_transaction_id IS NOT NULL OR (payment_method IN ('alipay_personal','wechat_personal') AND manual_confirmed_at IS NOT NULL AND manual_confirmed_by IS NOT NULL))";
  const grossRevenue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as sum FROM orders WHERE status IN ('paid', 'shipped', 'completed') AND " + verifiedSql).get().sum;
  const totalRefunds = db.prepare('SELECT COALESCE(SUM(amount),0) sum FROM refund_records').get().sum;
  const totalRevenue = Math.max(0,grossRevenue-totalRefunds);
  const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('pending','payment_review')").get().count;
  const paidOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'paid'").get().count;
  const shippedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'shipped'").get().count;
  const lowStock = db.prepare('SELECT COUNT(*) as count FROM products WHERE stock < 10').get().count;
  const pendingFeedback = db.prepare("SELECT COUNT(*) as count FROM feedbacks WHERE status = 'pending'").get().count;
  const todayOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now','localtime')").get().count;
  const todayGrossRevenue = db.prepare("SELECT COALESCE(SUM(total_amount),0) as sum FROM orders WHERE date(paid_at) = date('now','localtime') AND status IN ('paid','shipped','completed') AND " + verifiedSql).get().sum;
  const todayRefunds = db.prepare("SELECT COALESCE(SUM(amount),0) sum FROM refund_records WHERE date(created_at)=date('now','localtime')").get().sum;
  const todayRevenue = Math.max(0,todayGrossRevenue-todayRefunds);

  const trend = db.prepare(`
    SELECT date(paid_at) as date, COUNT(*) as count, COALESCE(SUM(total_amount),0) as gross_revenue,
      COALESCE((SELECT SUM(r.amount) FROM refund_records r WHERE date(r.created_at)=date(orders.paid_at)),0) AS refunds
    FROM orders WHERE date(paid_at) >= date('now', '-6 days', 'localtime')
      AND status IN ('paid','shipped','completed') AND ${verifiedSql}
    GROUP BY date(paid_at) ORDER BY date ASC
  `).all().map(row=>({...row,revenue:Math.max(0,row.gross_revenue-row.refunds)}));

  const topProducts = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name) AS name,
      COALESCE(NULLIF(p.image, ''), oi.image, '') AS image,
      SUM(oi.quantity) as sold, SUM(oi.quantity * oi.price) as revenue
    FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id
    JOIN orders o ON o.id=oi.order_id
    WHERE o.status IN ('paid','shipped','completed') AND COALESCE(o.refunded_amount,0)<o.total_amount AND ${verifiedSql}
    GROUP BY oi.product_id, oi.product_name ORDER BY sold DESC LIMIT 5
  `).all();

  res.json({
    code: 200,
    data: { totalUsers, totalProducts, totalOrders, grossRevenue, totalRefunds, totalRevenue, pendingOrders, paidOrders, shippedOrders, lowStock, pendingFeedback, todayOrders, todayGrossRevenue, todayRefunds, todayRevenue, trend, topProducts },
  });
});

// ===== 商品管理 =====
router.get('/products', adminRequired, (req, res) => {
  const { keyword, category, subcategory, status } = req.query;
  const { page, pageSize, offset } = pagination(req.query, 20);
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND name LIKE ?'; params.push(`%${keyword}%`); }
  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  if (subcategory && subcategory !== 'all') { sql += ' AND subcategory = ?'; params.push(subcategory); }
  if (status !== undefined && status !== '') { sql += ' AND status = ?'; params.push(Number(status)); }
  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as count')).get(...params).count;
  const orderTotal = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  sql += ' ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);
  const list = db.prepare(sql).all(...params);
  res.json({ code: 200, data: { list, total, orderTotal, page: Number(page), pageSize: Number(pageSize), totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
});

router.get('/products/categories', adminRequired, (req, res) => {
  res.json({ code: 200, data: { list: categoryList() } });
});

router.post('/products/categories', adminRequired, (req, res) => {
  const code = categoryCode(req.body.code);
  const nameZh = validate.text(req.body.name_zh, '中文分类名称', { max: 40 });
  const nameEn = validate.text(req.body.name_en, '英文分类名称', { max: 60 });
  const enabled = req.body.enabled === undefined ? true : validate.boolean(req.body.enabled, '分类状态');
  if (db.prepare('SELECT 1 FROM product_categories WHERE code=? COLLATE NOCASE').get(code)) {
    return res.status(409).json({ code: 409, message: '分类代码已存在' });
  }
  const nextPosition = db.prepare('SELECT COUNT(*) count FROM product_categories').get().count + 1;
  db.prepare(`INSERT INTO product_categories(code,name_zh,name_en,sort_order,enabled) VALUES(?,?,?,?,?)`)
    .run(code, nameZh, nameEn, nextPosition, enabled ? 1 : 0);
  moveCategoryToPosition.immediate(code, categoryPosition(req.body.sort_order, nextPosition, nextPosition));
  res.json({ code: 200, message: '商品分类已创建', data: categoryList().find(category => category.code === code) });
});

router.put('/products/categories/:code', adminRequired, (req, res) => {
  const code = categoryCode(req.params.code);
  const current = db.prepare('SELECT * FROM product_categories WHERE code=? COLLATE NOCASE').get(code);
  if (!current) return res.status(404).json({ code: 404, message: '商品分类不存在' });
  const nameZh = req.body.name_zh === undefined ? current.name_zh : validate.text(req.body.name_zh, '中文分类名称', { max: 40 });
  const nameEn = req.body.name_en === undefined ? current.name_en : validate.text(req.body.name_en, '英文分类名称', { max: 60 });
  const enabled = req.body.enabled === undefined ? Boolean(current.enabled) : validate.boolean(req.body.enabled, '分类状态');
  const count = db.prepare('SELECT COUNT(*) count FROM product_categories').get().count;
  const position = categoryPosition(req.body.sort_order, count, current.sort_order);
  db.prepare("UPDATE product_categories SET name_zh=?,name_en=?,enabled=?,updated_at=datetime('now','localtime') WHERE code=?")
    .run(nameZh, nameEn, enabled ? 1 : 0, current.code);
  moveCategoryToPosition.immediate(current.code, position);
  res.json({ code: 200, message: '商品分类已更新', data: categoryList().find(category => category.code.toLowerCase() === code) });
});

router.delete('/products/categories/:code', adminRequired, (req, res) => {
  const code = categoryCode(req.params.code);
  const category = db.prepare('SELECT code FROM product_categories WHERE code=? COLLATE NOCASE').get(code);
  if (!category) return res.status(404).json({ code: 404, message: '商品分类不存在' });
  const productCount = db.prepare('SELECT COUNT(*) count FROM products WHERE category=? COLLATE NOCASE').get(category.code).count;
  if (productCount) return res.status(409).json({ code: 409, message: `该分类仍有${productCount}件商品，请先调整商品分类` });
  if (db.prepare('SELECT COUNT(*) count FROM product_categories').get().count <= 1) {
    return res.status(409).json({ code: 409, message: '至少保留一个商品分类' });
  }
  db.prepare('DELETE FROM product_categories WHERE code=?').run(category.code);
  normalizeCategoryOrder.immediate();
  res.json({ code: 200, message: '商品分类已删除' });
});

router.post('/products/categories/:categoryCode/subcategories', adminRequired, (req, res) => {
  const category = db.prepare('SELECT code FROM product_categories WHERE code=? COLLATE NOCASE').get(categoryCode(req.params.categoryCode));
  if (!category) return res.status(404).json({ code: 404, message: '商品主分类不存在' });
  const code = subcategoryCode(req.body.code);
  const nameZh = validate.text(req.body.name_zh, '中文子分类名称', { max: 40 });
  const nameEn = validate.text(req.body.name_en, '英文子分类名称', { max: 60 });
  const enabled = req.body.enabled === undefined ? true : validate.boolean(req.body.enabled, '子分类状态');
  if (db.prepare('SELECT 1 FROM product_subcategories WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE').get(category.code, code)) {
    return res.status(409).json({ code: 409, message: '该主分类下的子分类代码已存在' });
  }
  const nextPosition = db.prepare('SELECT COUNT(*) count FROM product_subcategories WHERE category_code=? COLLATE NOCASE').get(category.code).count + 1;
  db.prepare('INSERT INTO product_subcategories(category_code,code,name_zh,name_en,sort_order,enabled) VALUES(?,?,?,?,?,?)')
    .run(category.code, code, nameZh, nameEn, nextPosition, enabled ? 1 : 0);
  moveSubcategoryToPosition.immediate(category.code, code, categoryPosition(req.body.sort_order, nextPosition, nextPosition));
  const result = categoryList().find(item => item.code.toLowerCase() === category.code.toLowerCase()).children.find(item => item.code === code);
  res.json({ code: 200, message: '商品子分类已创建', data: result });
});

router.put('/products/categories/:categoryCode/subcategories/:code', adminRequired, (req, res) => {
  const category = db.prepare('SELECT code FROM product_categories WHERE code=? COLLATE NOCASE').get(categoryCode(req.params.categoryCode));
  if (!category) return res.status(404).json({ code: 404, message: '商品主分类不存在' });
  const code = subcategoryCode(req.params.code);
  const current = db.prepare('SELECT * FROM product_subcategories WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE').get(category.code, code);
  if (!current) return res.status(404).json({ code: 404, message: '商品子分类不存在' });
  const nameZh = req.body.name_zh === undefined ? current.name_zh : validate.text(req.body.name_zh, '中文子分类名称', { max: 40 });
  const nameEn = req.body.name_en === undefined ? current.name_en : validate.text(req.body.name_en, '英文子分类名称', { max: 60 });
  const enabled = req.body.enabled === undefined ? Boolean(current.enabled) : validate.boolean(req.body.enabled, '子分类状态');
  const count = db.prepare('SELECT COUNT(*) count FROM product_subcategories WHERE category_code=? COLLATE NOCASE').get(category.code).count;
  const position = categoryPosition(req.body.sort_order, count, current.sort_order);
  db.prepare("UPDATE product_subcategories SET name_zh=?,name_en=?,enabled=?,updated_at=datetime('now','localtime') WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE")
    .run(nameZh, nameEn, enabled ? 1 : 0, category.code, current.code);
  moveSubcategoryToPosition.immediate(category.code, current.code, position);
  const result = categoryList().find(item => item.code.toLowerCase() === category.code.toLowerCase()).children.find(item => item.code.toLowerCase() === code);
  res.json({ code: 200, message: '商品子分类已更新', data: result });
});

router.delete('/products/categories/:categoryCode/subcategories/:code', adminRequired, (req, res) => {
  const category = db.prepare('SELECT code FROM product_categories WHERE code=? COLLATE NOCASE').get(categoryCode(req.params.categoryCode));
  if (!category) return res.status(404).json({ code: 404, message: '商品主分类不存在' });
  const code = subcategoryCode(req.params.code);
  const current = db.prepare('SELECT code FROM product_subcategories WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE').get(category.code, code);
  if (!current) return res.status(404).json({ code: 404, message: '商品子分类不存在' });
  const productCount = db.prepare('SELECT COUNT(*) count FROM products WHERE category=? COLLATE NOCASE AND subcategory=? COLLATE NOCASE').get(category.code, current.code).count;
  if (productCount) return res.status(409).json({ code: 409, message: `该子分类仍有${productCount}件商品，请先调整商品子分类` });
  db.prepare('DELETE FROM product_subcategories WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE').run(category.code, current.code);
  const remaining = db.prepare('SELECT code FROM product_subcategories WHERE category_code=? COLLATE NOCASE ORDER BY sort_order ASC,code ASC').all(category.code);
  const update = db.prepare("UPDATE product_subcategories SET sort_order=?,updated_at=datetime('now','localtime') WHERE category_code=? COLLATE NOCASE AND code=? COLLATE NOCASE");
  remaining.forEach((item, index) => update.run(index + 1, category.code, item.code));
  res.json({ code: 200, message: '商品子分类已删除' });
});

router.get('/products/:id', adminRequired, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ code: 404, message: '商品不存在' });
  res.json({ code: 200, data: product });
});

// 商品图片上传
router.post('/upload', adminRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ code: 400, message: '请选择图片文件' });
  const saved = saveImage(req.file.buffer, 'product');
  res.json({ code: 200, message: '上传成功', data: saved });
});

router.post('/products', adminRequired, (req, res) => {
  const { name, category, subcategory, price, stock, spec, description, image, status = 1 } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ code: 400, message: '商品名称、分类、价格不能为空' });
  }
  validate.text(name, '商品名称', { max: 120 });
  const normalizedCategory = productCategory(category);
  const normalizedSubcategory = productSubcategory(normalizedCategory, subcategory);
  validate.optionalText(spec, '商品规格', 200);
  validate.optionalText(description, '商品描述', 5000);
  validate.optionalText(image, '商品图片地址', 1000);
  validateQuantity(stock === undefined ? 0 : stock, true);
  if (cents(price) <= 0) return res.status(400).json({code:400,message:'价格必须大于0'});
  const normalizedStatus=status?1:0;
  const result = db.prepare(
    "INSERT INTO products (name, category, subcategory, price, stock, spec, description, image, status,sort_order,listed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,CASE WHEN ?=1 THEN datetime('now','localtime') END)"
  ).run(name, normalizedCategory, normalizedSubcategory, price, stock || 0, spec || '', description || '', image || '', normalizedStatus,db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM products').get().n,normalizedStatus);
  res.json({ code: 200, message: '商品添加成功', data: { id: result.lastInsertRowid } });
});

router.put('/products/:id', adminRequired, (req, res) => {
  const { name, category, subcategory, price, stock, spec, description, image, status } = req.body;
  const product = db.prepare('SELECT id,stock,status,category,subcategory FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ code: 404, message: '商品不存在' });
  if (stock !== undefined) validateQuantity(stock, true);
  if (price !== undefined && cents(price) <= 0) return res.status(400).json({code:400,message:'价格必须大于0'});
  if (name !== undefined) validate.text(name, '商品名称', { max: 120 });
  const normalizedCategory = category === undefined ? product.category : productCategory(category);
  const normalizedSubcategory = subcategory === undefined
    ? (category === undefined ? product.subcategory : null)
    : productSubcategory(normalizedCategory, subcategory);
  if (spec !== undefined) validate.optionalText(spec, '商品规格', 200);
  if (description !== undefined) validate.optionalText(description, '商品描述', 5000);
  if (image !== undefined) validate.optionalText(image, '商品图片地址', 1000);
  if (stock !== undefined) validateQuantity(req.body.expected_stock, true);
  const normalizedStatus=status === undefined ? null : (status ? 1 : 0);
  const changed = db.prepare(`
    UPDATE products SET
      name = COALESCE(?, name), category = ?, subcategory = ?,
      price = COALESCE(?, price), stock = COALESCE(?, stock),
      spec = COALESCE(?, spec), description = COALESCE(?, description),
      image = COALESCE(?, image),
      listed_at = CASE WHEN ?=1 AND status<>1 THEN datetime('now','localtime') ELSE listed_at END,
      status = COALESCE(?, status)
    WHERE id = ? AND (? IS NULL OR stock = ?)
  `).run(name ?? null, normalizedCategory, normalizedSubcategory, price ?? null, stock ?? null, spec ?? null, description ?? null, image ?? null, normalizedStatus, normalizedStatus, req.params.id, stock === undefined ? null : req.body.expected_stock, req.body.expected_stock ?? null);
  if (!changed.changes) return res.status(409).json({ code:409, message:'库存已变化，请刷新商品后重新编辑' });
  res.json({ code: 200, message: '商品更新成功' });
});

// 商品上下架切换
router.put('/products/:id/toggle', adminRequired, (req, res) => {
  const product = db.prepare('SELECT status FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ code: 404, message: '商品不存在' });
  const newStatus = product.status === 1 ? 0 : 1;
  db.prepare("UPDATE products SET status = ?, listed_at = CASE WHEN ?=1 THEN datetime('now','localtime') ELSE listed_at END WHERE id = ?").run(newStatus, newStatus, req.params.id);
  const updated=db.prepare('SELECT status,listed_at FROM products WHERE id=?').get(req.params.id);
  res.json({ code: 200, message: newStatus ? '已上架' : '已下架', data: updated });
});

router.delete('/products/:id', adminRequired, (req, res) => {
  const referenced=db.prepare('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1').get(req.params.id);
  if(referenced){db.prepare('UPDATE products SET status=0 WHERE id=?').run(req.params.id);return res.json({code:200,message:'商品已有历史订单，已安全下架并保留订单快照'});}
  const changed=db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if(!changed.changes)return res.status(404).json({code:404,message:'商品不存在'});
  normalizeProductOrder.immediate();
  res.json({ code: 200, message: '商品已删除' });
});

// ===== 订单管理 =====
router.get('/orders', adminRequired, (req, res) => {
  const { status, keyword } = req.query;
  const { page, pageSize, offset } = pagination(req.query, 20);
  if(status&&!['pending','payment_review','paid','shipped','completed','cancelled'].includes(status))return res.status(400).json({code:400,message:'订单状态无效'});
  let sql = `
    SELECT o.*, u.username, u.nickname FROM orders o
    LEFT JOIN users u ON o.user_id = u.id WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (keyword) {
    sql += ' AND (o.order_no LIKE ? OR o.receiver_name LIKE ? OR o.receiver_phone LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const total = db.prepare(sql.replace('SELECT o.*, u.username, u.nickname', 'SELECT COUNT(*) as count')).get(...params).count;
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);
  const list = db.prepare(sql).all(...params);
  res.json({ code: 200, data: { list, total, page: Number(page) } });
});

router.get('/orders/:id', adminRequired, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, u.username, u.nickname FROM orders o
    LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ code: 200, data: { ...order, items } });
});

// 发货（填写物流公司和单号）
router.put('/orders/:id/ship', adminRequired, (req, res) => {
  const { tracking_company, tracking_no } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
  if (order.status !== 'paid' || !paymentVerified(order)) return res.status(400).json({ code: 400, message: '只有平台已验证或管理员已核实到账的订单可以发货' });
  if (!tracking_company || !tracking_no) {
    return res.status(400).json({ code: 400, message: '请填写物流公司和物流单号' });
  }
  validate.text(tracking_company,'物流公司',{max:60});validate.text(tracking_no,'物流单号',{max:100});
  db.prepare(`
    UPDATE orders SET status = 'shipped', tracking_company = ?, tracking_no = ?, shipped_at = datetime('now','localtime') WHERE id = ?
  `).run(tracking_company, tracking_no, req.params.id);
  res.json({ code: 200, message: '发货成功' });
});

// Payment status is controlled exclusively by verified provider results.
router.put('/orders/:id/status', adminRequired, async (req, res, next) => {
  try {
    if (req.body.status !== 'cancelled') return res.status(400).json({code:400,message:'不可手动标记付款；发货请使用发货功能'});
    const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({code:404,message:'订单不存在'});
    await cancelPayment(order.id);
    res.json({code:200,message:'订单已取消，库存已恢复'});
  } catch (error) { next(error); }
});

router.put('/products/:id/stock', adminRequired, (req, res) => {
  validateQuantity(req.body.stock, true);
  validateQuantity(req.body.expected_stock, true);
  const changed = db.prepare('UPDATE products SET stock = ? WHERE id = ? AND stock = ?').run(req.body.stock, req.params.id, req.body.expected_stock);
  if (!changed.changes) return res.status(409).json({code:409,message:'库存已变化或商品不存在，请刷新后重试'});
  res.json({code:200,message:'可售库存已更新'});
});
router.put('/products/:id/sort',adminRequired,(req,res)=>{
  const id=Number(req.params.id);
  const targetPosition=req.body.sort_order;
  const expectedPosition=req.body.expected_sort_order;
  const total=db.prepare('SELECT COUNT(*) count FROM products').get().count;
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({code:400,message:'商品编号无效'});
  if(!Number.isSafeInteger(targetPosition)||targetPosition<1||targetPosition>total)return res.status(400).json({code:400,message:`目标位置必须是 1 至 ${total} 的整数`});
  if(!Number.isSafeInteger(expectedPosition)||expectedPosition<1)return res.status(400).json({code:400,message:'当前排序号无效，请刷新后重试'});
  const result=moveProductToPosition.immediate(id,targetPosition,expectedPosition);
  if(!result)return res.status(409).json({code:409,message:'排序已变化或商品不存在，请刷新后重试'});
  res.json({code:200,message:`已移动到第 ${targetPosition} 位，全部商品已从 1 连续编号`,data:result});
});

// ===== 用户管理 =====
router.get('/users', adminRequired, (req, res) => {
  const { keyword } = req.query;
  const { page, pageSize, offset } = pagination(req.query, 20);
  let where = ' WHERE u.is_admin = 0';
  const params = [];
  if (keyword) {
    where += ' AND (u.username LIKE ? OR u.nickname LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) count FROM users u${where}`).get(...params).count;
  const list = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.avatar, u.gender, u.member_level, u.points, u.total_spent, u.created_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) order_count,
      (SELECT COUNT(*) FROM feedbacks f WHERE f.user_id=u.id) feedback_count
    FROM users u${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);
  const summary=db.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN date(created_at)=date('now','localtime') THEN 1 ELSE 0 END),0) registered_today
    FROM users WHERE is_admin=0
  `).get();
  res.json({ code: 200, data: { list, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.max(1, Math.ceil(total / pageSize)), summary } });
});

router.put('/users/:id/level', adminRequired, (req, res) => {
  const { member_level } = req.body;
  if (![0, 1, 2, 3].includes(Number(member_level))) {
    return res.status(400).json({ code: 400, message: '无效的会员等级' });
  }
  const changed=db.prepare('UPDATE users SET member_level = ? WHERE id = ? AND is_admin = 0').run(member_level, req.params.id);
  if(!changed.changes)return res.status(404).json({code:404,message:'用户不存在'});
  res.json({ code: 200, message: '会员等级已更新' });
});

// ===== 反馈管理 =====
router.get('/feedbacks', adminRequired, (req, res) => {
  const { status, type, keyword } = req.query;
  const { page, pageSize, offset } = pagination(req.query, 20);
  if(status&&!['pending','handled'].includes(status))return res.status(400).json({code:400,message:'反馈状态无效'});
  const types=['suggestion','quality','logistics','aftersale','other'];
  if(type&&!types.includes(type))return res.status(400).json({code:400,message:'反馈类型无效'});
  let where=' WHERE 1=1';
  const params = [];
  if (status) { where += ' AND f.status = ?'; params.push(status); }
  if (type) { where += ' AND f.type = ?'; params.push(type); }
  if (keyword) {
    const kw=`%${keyword}%`;
    where += ' AND (f.content LIKE ? OR f.contact LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)';
    params.push(kw,kw,kw,kw);
  }
  const from=` FROM feedbacks f LEFT JOIN users u ON f.user_id = u.id${where}`;
  const total = db.prepare(`SELECT COUNT(*) count${from}`).get(...params).count;
  const list = db.prepare(`SELECT f.*, u.username, u.nickname${from} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`).all(...params,Number(pageSize),offset);
  const summary=db.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN status='handled' THEN 1 ELSE 0 END),0) handled
    FROM feedbacks
  `).get();
  res.json({ code: 200, data: { list, total, page: Number(page), pageSize: Number(pageSize), totalPages: Math.max(1, Math.ceil(total / pageSize)), summary } });
});

router.put('/feedbacks/:id/handle', adminRequired, (req, res) => {
  const changed=db.prepare("UPDATE feedbacks SET status = 'handled' WHERE id = ?").run(req.params.id);
  if(!changed.changes)return res.status(404).json({code:404,message:'反馈不存在'});
  res.json({ code: 200, message: '已标记为已处理' });
});

// 上传错误处理
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ code: 400, message: '文件上传错误: ' + err.message });
  }
  if (err) {
    const status = err.status || 400;
    return res.status(status).json({ code: status, message: err.message });
  }
  next();
});

module.exports = router;
