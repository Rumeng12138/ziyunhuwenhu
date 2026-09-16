const db = require('./db');
const { products: jdProducts } = require('../catalog/jd-products.cjs');
const editorialItemSeeds = require('../catalog/editorial-items.cjs');

// 用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nickname TEXT,
    avatar TEXT DEFAULT 'default',
    gender TEXT DEFAULT 'secret',
    birthday TEXT,
    bio TEXT,
    member_level INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    is_owner INTEGER NOT NULL DEFAULT 0,
    admin_active INTEGER NOT NULL DEFAULT 1,
    admin_permissions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 兼容旧数据库：增加 is_admin 字段
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN admin_active INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN admin_permissions TEXT NOT NULL DEFAULT '[]'"); } catch(e) {}

// 初始化默认管理员账号
const bcrypt = require('bcryptjs');
const adminExist = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD || '';
function validInitialAdminPassword(value) {
  return typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72
    && /[a-zA-Z]/.test(value) && /\d/.test(value) && value !== 'admin123';
}
if (!adminExist) {
  if (process.env.NODE_ENV === 'production' && !validInitialAdminPassword(initialAdminPassword)) {
    throw new Error('生产环境首次启动必须设置 ADMIN_INITIAL_PASSWORD（12至72位，包含字母和数字）');
  }
  const password = validInitialAdminPassword(initialAdminPassword) ? initialAdminPassword : 'admin123';
  const hashed = bcrypt.hashSync(password, 12);
  db.prepare(
    "INSERT INTO users (username, password, nickname, is_admin, is_owner) VALUES ('admin', ?, '管理员', 1, 1)"
  ).run(hashed);
  console.log(password === 'admin123' ? '已创建仅限本机使用的默认管理员账号: admin / admin123' : '已使用部署密钥创建管理员账号: admin');
} else if (validInitialAdminPassword(initialAdminPassword)) {
  const current=db.prepare("SELECT id,password FROM users WHERE username='admin' AND is_admin=1").get();
  if (current && bcrypt.compareSync('admin123',current.password)) {
    db.prepare('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?').run(bcrypt.hashSync(initialAdminPassword,12),current.id);
    console.log('已使用 ADMIN_INITIAL_PASSWORD 替换默认管理员密码');
  }
}
db.prepare("UPDATE users SET is_owner=1, admin_active=1 WHERE username='admin' AND is_admin=1").run();
const allAdminPermissions=JSON.stringify(['dashboard','products','orders','users','feedbacks','after_sales','payments','marketing','membership','editorial','store_profile']);
db.prepare("UPDATE users SET admin_permissions=? WHERE is_admin=1 AND is_owner=0 AND admin_permissions='[]'").run(allAdminPermissions);

// 商品分类表：分类代码用于稳定关联，前台名称、顺序和可见性由后台配置。
db.exec(`
  CREATE TABLE IF NOT EXISTS product_categories (
    code TEXT PRIMARY KEY COLLATE NOCASE,
    name_zh TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);
const defaultProductCategories = [
  ['pen', '毛笔', 'Brushes'],
  ['ink', '墨品', 'Ink'],
  ['paper', '宣纸', 'Xuan Paper'],
  ['inkstone', '砚台', 'Inkstones'],
  ['other', '其他', 'Other'],
];
if (db.prepare('SELECT COUNT(*) count FROM product_categories').get().count === 0) {
  const insertCategory = db.prepare('INSERT INTO product_categories(code,name_zh,name_en,sort_order) VALUES(?,?,?,?)');
  db.transaction(() => defaultProductCategories.forEach((category, index) => insertCategory.run(...category, index + 1)))();
}
db.exec(`
  CREATE TABLE IF NOT EXISTS product_subcategories (
    category_code TEXT NOT NULL COLLATE NOCASE,
    code TEXT NOT NULL COLLATE NOCASE,
    name_zh TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY(category_code, code),
    FOREIGN KEY(category_code) REFERENCES product_categories(code) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id='product_hierarchy_v1'").get()) {
  const defaultSubcategories = [
    ['pen', 'mixed-hair', '兼毫', 'Mixed Hair'],
    ['pen', 'weasel-hair', '狼毫', 'Weasel Hair'],
    ['pen', 'goat-hair', '羊毫', 'Goat Hair'],
    ['pen', 'brush-other', '其他毛笔', 'Other Brushes'],
    ['ink', 'ink-stick', '墨锭', 'Ink Sticks'],
    ['ink', 'liquid-ink', '墨汁', 'Liquid Ink'],
    ['paper', 'raw-xuan', '生宣', 'Raw Xuan'],
    ['paper', 'sized-xuan', '熟宣', 'Sized Xuan'],
    ['paper', 'semi-sized-xuan', '半生熟', 'Semi-sized Xuan'],
    ['inkstone', 'duan', '端砚', 'Duan Inkstones'],
    ['inkstone', 'she', '歙砚', 'She Inkstones'],
    ['inkstone', 'inkstone-other', '其他砚台', 'Other Inkstones'],
    ['other', 'seal', '印章', 'Seals'],
    ['other', 'accessory', '文房配件', 'Accessories'],
  ];
  const migrateHierarchy = db.transaction(() => {
    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 value FROM product_categories').get().value;
    db.prepare('INSERT OR IGNORE INTO product_categories(code,name_zh,name_en,sort_order) VALUES(?,?,?,?)').run('other', '其他', 'Other', nextOrder);
    const insertSubcategory = db.prepare('INSERT OR IGNORE INTO product_subcategories(category_code,code,name_zh,name_en,sort_order) VALUES(?,?,?,?,?)');
    const orderByCategory = new Map();
    for (const subcategory of defaultSubcategories) {
      const order = (orderByCategory.get(subcategory[0]) || 0) + 1;
      orderByCategory.set(subcategory[0], order);
      insertSubcategory.run(...subcategory, order);
    }
    db.prepare("INSERT INTO schema_migrations(id) VALUES('product_hierarchy_v1')").run();
  });
  migrateHierarchy.immediate();
}

// 商品表
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    spec TEXT,
    description TEXT,
    image TEXT,
    status INTEGER DEFAULT 1,
    listed_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);
// 兼容旧数据库
try { db.exec('ALTER TABLE products ADD COLUMN status INTEGER DEFAULT 1'); } catch(e) {}
if (!db.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='listed_at')) {
  db.exec('ALTER TABLE products ADD COLUMN listed_at TEXT');
}
if (!db.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='subcategory')) {
  db.exec('ALTER TABLE products ADD COLUMN subcategory TEXT');
}
db.exec("UPDATE products SET listed_at=created_at WHERE status=1 AND listed_at IS NULL");
// 旧数据库若曾保存过其他分类，升级时保留并补入分类表，避免商品失去归属。
const insertLegacyCategory = db.prepare(`
  INSERT OR IGNORE INTO product_categories(code,name_zh,name_en,sort_order)
  VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM product_categories))
`);
for (const row of db.prepare("SELECT DISTINCT category FROM products WHERE TRIM(category)<>''").all()) {
  insertLegacyCategory.run(row.category, row.category, row.category);
}

// 订单表
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    freight REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    receiver_name TEXT NOT NULL,
    receiver_phone TEXT NOT NULL,
    receiver_address TEXT NOT NULL,
    payment_method TEXT,
    remark TEXT,
    tracking_company TEXT,
    tracking_no TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    paid_at TEXT,
    shipped_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
// 兼容旧数据库
try { db.exec('ALTER TABLE orders ADD COLUMN tracking_company TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE orders ADD COLUMN tracking_no TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE orders ADD COLUMN shipped_at TEXT'); } catch(e) {}

// 订单项表
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    spec TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  );
`);

// 收货地址表
// Commerce migrations preserve existing orders and never infer that old simulated payments were real.
db.exec(`CREATE TABLE IF NOT EXISTS payment_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, updated_by INTEGER, updated_at TEXT)`);
db.exec(`
  CREATE TABLE IF NOT EXISTS merchant_auth_sessions (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, admin_id INTEGER NOT NULL,
    state_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT, merchant_id TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    failure TEXT, binding_id TEXT
  );
  CREATE TABLE IF NOT EXISTS merchant_bindings (
    id TEXT PRIMARY KEY, channel TEXT NOT NULL, merchant_id TEXT NOT NULL,
    payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS merchant_binding_active ON merchant_bindings(channel) WHERE active = 1;
`);
for (const [table, name, type] of [
  ['order_items', 'image', "TEXT DEFAULT ''"],
  ['orders', 'payment_transaction_id', 'TEXT'],
  ['orders', 'payment_busy_until', 'INTEGER DEFAULT 0'],
  ['orders', 'checkout_key', 'TEXT'],
  ['orders', 'manual_receipt', 'TEXT'],
  ['orders', 'manual_claim_reference', 'TEXT'],
  ['orders', 'manual_claim_note', 'TEXT'],
  ['orders', 'manual_review_note', 'TEXT'],
  ['orders', 'manual_confirmed_at', 'TEXT'],
  ['orders', 'manual_confirmed_by', 'INTEGER'],
  ['orders', 'manual_transaction_reference', 'TEXT'],
  ['orders', 'subtotal_amount', 'REAL'],
  ['orders', 'promotion_discount', 'REAL DEFAULT 0'],
  ['orders', 'full_reduction_discount', 'REAL DEFAULT 0'],
  ['orders', 'coupon_discount', 'REAL DEFAULT 0'],
  ['orders', 'coupon_code', 'TEXT'],
  ['orders', 'pricing_snapshot', 'TEXT'],
  ['orders', 'receiver_country', "TEXT DEFAULT '中国'"],
  ['orders', 'receiver_province', 'TEXT'],
  ['orders', 'receiver_city', 'TEXT'],
  ['orders', 'receiver_district', 'TEXT'],
  ['orders', 'shipping_rule_id', 'INTEGER'],
  ['orders', 'shipping_rule_name', 'TEXT'],
]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

// 订单项保存了下单时的商品名称、价格、规格和图片快照，因此商品从目录删除后
// 可以安全保留历史订单，并将已失效的目录引用置空。
const orderItemProductColumn = db.prepare('PRAGMA table_info(order_items)').all().find(column => column.name === 'product_id');
const orderItemProductForeignKey = db.prepare('PRAGMA foreign_key_list(order_items)').all().find(key => key.from === 'product_id');
if (orderItemProductColumn?.notnull === 1 || String(orderItemProductForeignKey?.on_delete || '').toUpperCase() !== 'SET NULL') {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS order_items_next;
        CREATE TABLE order_items_next (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          product_id INTEGER,
          product_name TEXT NOT NULL,
          price REAL NOT NULL,
          quantity INTEGER NOT NULL,
          spec TEXT,
          image TEXT DEFAULT '',
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        );
        INSERT INTO order_items_next (id, order_id, product_id, product_name, price, quantity, spec, image)
        SELECT id, order_id, product_id, product_name, price, quantity, spec, image FROM order_items;
        DROP TABLE order_items;
        ALTER TABLE order_items_next RENAME TO order_items;
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyProblems.length) throw new Error('订单商品引用迁移后外键校验失败');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key ON orders(user_id, checkout_key) WHERE checkout_key IS NOT NULL');
if (!db.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='sort_order')) {
  db.exec('ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE products SET sort_order=id');
}
for (const [name, type] of [
  ['source_sku', 'TEXT'],
  ['source_url', 'TEXT'],
  ['source_checked_at', 'TEXT'],
]) {
  if (!db.prepare('PRAGMA table_info(products)').all().some(column => column.name === name)) {
    db.exec(`ALTER TABLE products ADD COLUMN ${name} ${type}`);
  }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS products_source_sku ON products(source_sku) WHERE source_sku IS NOT NULL');
db.exec(`
  CREATE TRIGGER IF NOT EXISTS products_default_sort AFTER INSERT ON products WHEN NEW.sort_order=0
  BEGIN UPDATE products SET sort_order=NEW.id WHERE id=NEW.id; END;
  CREATE TABLE IF NOT EXISTS commerce_settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
  INSERT OR IGNORE INTO commerce_settings(id,payload) VALUES(1,'{"mode":"threshold","fee":12,"threshold":199}');
  CREATE TABLE IF NOT EXISTS shipping_rules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '*',
    regions TEXT NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL DEFAULT 'flat',
    fee_cents INTEGER NOT NULL DEFAULT 0,
    threshold_cents INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shipping_rules_enabled_order ON shipping_rules(enabled,sort_order,id);
  CREATE TABLE IF NOT EXISTS marketing_campaigns(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, code TEXT COLLATE NOCASE UNIQUE,
    min_spend_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0,
    rate_bps INTEGER NOT NULL DEFAULT 10000, product_ids TEXT NOT NULL DEFAULT '[]',
    starts_at INTEGER, ends_at INTEGER, max_uses INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupon_redemptions(
    order_id INTEGER PRIMARY KEY REFERENCES orders(id), campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id),
    user_id INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS coupon_redemptions_campaign ON coupon_redemptions(campaign_id,user_id);
`);
const normalizeExistingProductOrder=db.transaction(()=>{
  const rows=db.prepare('SELECT id FROM products ORDER BY sort_order ASC, id ASC').all();
  const update=db.prepare('UPDATE products SET sort_order=? WHERE id=?');
  rows.forEach((row,index)=>update.run(index+1,row.id));
});
normalizeExistingProductOrder();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_transaction ON orders(payment_method, payment_transaction_id) WHERE payment_transaction_id IS NOT NULL');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS orders_manual_transaction ON orders(payment_method,manual_transaction_reference) WHERE manual_transaction_reference IS NOT NULL;
  CREATE TABLE IF NOT EXISTS personal_payment_settings (
    channel TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, qr_url TEXT NOT NULL DEFAULT '',
    recipient TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS manual_payment_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, admin_id INTEGER NOT NULL,
    decision TEXT NOT NULL, reference TEXT, amount_cents INTEGER, note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);
for (const channel of ['alipay_personal','wechat_personal']) {
  const platform = channel.split('_')[0];
  const image = '/uploads/personal-' + platform + '-initial.png';
  const exists = require('node:fs').existsSync(require('node:path').join(__dirname,'..','public',image));
  db.prepare('INSERT OR IGNORE INTO personal_payment_settings(channel,qr_url) VALUES(?,?)').run(channel,exists ? image : '');
}

// 收货地址表
db.exec(`
  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '中国',
    province TEXT,
    city TEXT,
    district TEXT,
    detail TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
if (!db.prepare('PRAGMA table_info(addresses)').all().some(column=>column.name==='country')) {
  db.exec("ALTER TABLE addresses ADD COLUMN country TEXT NOT NULL DEFAULT '中国'");
}

// 购物车表
db.exec(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// 收藏夹表
db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// 意见反馈表
db.exec(`
  CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    contact TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// 新数据库不再创建银行卡表。旧库如存在 bank_cards，须由数据负责人审计备份后单独清理，
// 避免在一次普通代码升级中不可恢复地删除可能受合规要求约束的历史数据。

// 初始化商品数据（仅在商品表为空时插入）
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (productCount.count === 0) {
  const insertProduct = db.prepare(`
    INSERT INTO products (
      name, category, price, stock, spec, description, image, status,
      sort_order, listed_at, source_sku, source_url, source_checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    items.forEach((product, index) => insertProduct.run(
      product.name, product.category, product.price, product.stock, product.spec,
      product.description, product.image, product.status, index + 1,
      product.sourceSku, product.sourceUrl, product.sourceCheckedAt,
    ));
  });
  insertMany(jdProducts);
  console.log(`已初始化 ${jdProducts.length} 条京东来源商品数据`);
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id='classify_default_products_v1'").get()) {
  const classifyProducts = db.transaction(() => {
    db.prepare(`UPDATE products SET subcategory=CASE
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%兼毫%' THEN 'mixed-hair'
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%狼毫%' THEN 'weasel-hair'
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%羊毫%' THEN 'goat-hair'
      ELSE 'brush-other' END
      WHERE category='pen' COLLATE NOCASE AND (subcategory IS NULL OR TRIM(subcategory)='')`).run();
    db.prepare("INSERT INTO schema_migrations(id) VALUES('classify_default_products_v1')").run();
  });
  classifyProducts.immediate();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id='classify_default_products_v2'").get()) {
  const classifyRemainingProducts = db.transaction(() => {
    db.prepare(`UPDATE products SET subcategory=CASE WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%墨汁%' THEN 'liquid-ink' ELSE 'ink-stick' END
      WHERE category='ink' COLLATE NOCASE AND (subcategory IS NULL OR TRIM(subcategory)='')`).run();
    db.prepare(`UPDATE products SET subcategory=CASE
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%半生熟%' THEN 'semi-sized-xuan'
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%熟宣%' THEN 'sized-xuan'
      ELSE 'raw-xuan' END
      WHERE category='paper' COLLATE NOCASE AND (subcategory IS NULL OR TRIM(subcategory)='')`).run();
    db.prepare(`UPDATE products SET subcategory=CASE
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%端砚%' THEN 'duan'
      WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%歙砚%' THEN 'she'
      ELSE 'inkstone-other' END
      WHERE category='inkstone' COLLATE NOCASE AND (subcategory IS NULL OR TRIM(subcategory)='')`).run();
    db.prepare(`UPDATE products SET subcategory=CASE WHEN COALESCE(name,'')||COALESCE(spec,'') LIKE '%印%' THEN 'seal' ELSE 'accessory' END
      WHERE category='other' COLLATE NOCASE AND (subcategory IS NULL OR TRIM(subcategory)='')`).run();
    db.prepare("INSERT INTO schema_migrations(id) VALUES('classify_default_products_v2')").run();
  });
  classifyRemainingProducts.immediate();
}

// Additive migrations only: existing points, levels and order snapshots remain.
db.exec(`
  CREATE TABLE IF NOT EXISTS member_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), membership_enabled INTEGER NOT NULL DEFAULT 1,
    checkin_enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO member_settings(id) VALUES(1);
  CREATE TABLE IF NOT EXISTS member_checkins (
    user_id INTEGER NOT NULL REFERENCES users(id), business_date TEXT NOT NULL,
    points INTEGER NOT NULL, PRIMARY KEY(user_id,business_date)
  );
  CREATE TABLE IF NOT EXISTS points_ledger (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), event_key TEXT NOT NULL,
    delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id,event_key)
  );
  CREATE INDEX IF NOT EXISTS orders_user_created ON orders(user_id,id DESC);
  CREATE INDEX IF NOT EXISTS orders_status_paid ON orders(status,paid_at);
`);
if (!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name==='expires_at')) db.exec('ALTER TABLE orders ADD COLUMN expires_at INTEGER');
if (!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name==='refunded_amount')) db.exec('ALTER TABLE orders ADD COLUMN refunded_amount REAL NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS orders_expiry ON orders(status,expires_at)');
db.exec(`
  CREATE TABLE IF NOT EXISTS store_profile (
    id INTEGER PRIMARY KEY CHECK(id=1), display_name TEXT NOT NULL DEFAULT '紫云湖文房商城',
    store_description TEXT NOT NULL DEFAULT '',
    legal_name TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '', business_address TEXT NOT NULL DEFAULT '',
    service_hours TEXT NOT NULL DEFAULT '', icp_no TEXT NOT NULL DEFAULT '',
    privacy_policy TEXT NOT NULL DEFAULT '', terms_of_service TEXT NOT NULL DEFAULT '',
    return_policy TEXT NOT NULL DEFAULT '', shipping_policy TEXT NOT NULL DEFAULT '',
    artisans_copy_zh TEXT NOT NULL DEFAULT '', artisans_copy_en TEXT NOT NULL DEFAULT '',
    brand_story_copy_zh TEXT NOT NULL DEFAULT '', brand_story_copy_en TEXT NOT NULL DEFAULT '',
    culture_copy_zh TEXT NOT NULL DEFAULT '', culture_copy_en TEXT NOT NULL DEFAULT '',
    invoice_policy TEXT NOT NULL DEFAULT '', editorial_content_published INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
    profile_seed_version INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO store_profile(id) VALUES(1);
  CREATE TABLE IF NOT EXISTS after_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_no TEXT UNIQUE NOT NULL,
    order_id INTEGER NOT NULL REFERENCES orders(id), user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('refund','return_refund','exchange')),
    reason TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', requested_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','returning','refund_pending','completed','rejected','cancelled')),
    admin_note TEXT NOT NULL DEFAULT '', return_tracking_company TEXT NOT NULL DEFAULT '',
    return_tracking_no TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS after_sales_user_created ON after_sales(user_id,id DESC);
  CREATE INDEX IF NOT EXISTS after_sales_status_created ON after_sales(status,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS after_sales_order_active ON after_sales(order_id)
    WHERE status IN ('pending','approved','returning','refund_pending');
  CREATE TABLE IF NOT EXISTS refund_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, after_sale_id INTEGER NOT NULL UNIQUE REFERENCES after_sales(id),
    order_id INTEGER NOT NULL REFERENCES orders(id), amount REAL NOT NULL, channel TEXT NOT NULL,
    external_reference TEXT NOT NULL, handled_by INTEGER NOT NULL REFERENCES users(id),
    note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS refund_records_external ON refund_records(channel,external_reference);
  CREATE TABLE IF NOT EXISTS after_sale_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, after_sale_id INTEGER NOT NULL REFERENCES after_sales(id),
    actor_type TEXT NOT NULL, actor_id INTEGER NOT NULL, action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);
for (const column of ['store_description','shipping_policy','invoice_policy']) {
  if (!db.prepare('PRAGMA table_info(store_profile)').all().some(item => item.name === column)) db.exec(`ALTER TABLE store_profile ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
}
for (const column of ['artisans_copy_zh','artisans_copy_en','brand_story_copy_zh','brand_story_copy_en','culture_copy_zh','culture_copy_en']) {
  if (!db.prepare('PRAGMA table_info(store_profile)').all().some(item => item.name === column)) db.exec(`ALTER TABLE store_profile ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
}
if (!db.prepare('PRAGMA table_info(store_profile)').all().some(item => item.name === 'editorial_content_published')) db.exec("ALTER TABLE store_profile ADD COLUMN editorial_content_published INTEGER NOT NULL DEFAULT 0");
if (!db.prepare('PRAGMA table_info(store_profile)').all().some(item => item.name === 'profile_seed_version')) db.exec("ALTER TABLE store_profile ADD COLUMN profile_seed_version INTEGER NOT NULL DEFAULT 0");

// 将用户确认的经营资料应用一次；版本标记避免覆盖后台后续人工修改。
const storefrontProfileV1 = {
  display_name: '紫云湖文房商城',
  store_description: '以笔会友，以文会友',
  legal_name: '紫云湖笔庄',
  contact_phone: '13621294733',
  contact_email: '1968278027@qq.com',
  business_address: '北京紫云湖',
  service_hours: '9：00-18：00',
  icp_no: '2026.09.01.00',
  privacy_policy: '客户信息隐私',
  terms_of_service: '以笔会友，以文会友',
  return_policy: '7天无理由(定制类不支持)',
  shipping_policy: '正常物流运费，加急另算',
};
const storefrontProfileFields = Object.keys(storefrontProfileV1);
db.prepare(`UPDATE store_profile SET ${storefrontProfileFields.map(field => `${field}=?`).join(',')},published=1,profile_seed_version=1,revision=revision+1,updated_at=datetime('now','localtime') WHERE id=1 AND profile_seed_version<1`)
  .run(...storefrontProfileFields.map(field => storefrontProfileV1[field]));

const editorialCopyV2 = {
  artisans_copy_zh: '走近守艺人，聆听他们与文房四宝的半生之缘',
  artisans_copy_en: 'Meet the makers who have devoted their lives to the Four Treasures.',
  brand_story_copy_zh: '一方湖水，一脉匠心，千年文房薪火相传',
  brand_story_copy_en: 'Rooted by the lake, shaped by hand, and carried forward through generations.',
  culture_copy_zh: '品读文房四宝千年历史，传承中华书画艺术精髓',
  culture_copy_en: 'Explore the history, use, and care of the Four Treasures.',
};
const editorialCopyFields = Object.keys(editorialCopyV2);
db.prepare(`UPDATE store_profile SET ${editorialCopyFields.map(field => `${field}=?`).join(',')},profile_seed_version=2,revision=revision+1,updated_at=datetime('now','localtime') WHERE id=1 AND profile_seed_version<2`)
  .run(...editorialCopyFields.map(field => editorialCopyV2[field]));

db.exec(`
  CREATE TABLE IF NOT EXISTS editorial_sections (
    section_key TEXT PRIMARY KEY,
    eyebrow_zh TEXT NOT NULL DEFAULT '',
    eyebrow_en TEXT NOT NULL DEFAULT '',
    title_zh TEXT NOT NULL,
    title_en TEXT NOT NULL,
    intro_zh TEXT NOT NULL,
    intro_en TEXT NOT NULL,
    body_zh TEXT NOT NULL DEFAULT '',
    body_en TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL DEFAULT 'centered',
    items_layout TEXT NOT NULL DEFAULT 'auto',
    sort_order INTEGER NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);
try { db.exec("ALTER TABLE editorial_sections ADD COLUMN eyebrow_zh TEXT NOT NULL DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE editorial_sections ADD COLUMN eyebrow_en TEXT NOT NULL DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE editorial_sections ADD COLUMN items_layout TEXT NOT NULL DEFAULT 'auto'"); } catch(e) {}
const legacyEditorial=db.prepare('SELECT * FROM store_profile WHERE id=1').get();
const hadHomepageSections=Boolean(db.prepare("SELECT 1 FROM editorial_sections WHERE section_key='hero'").get());
const seedEditorial=db.prepare(`INSERT OR IGNORE INTO editorial_sections(section_key,title_zh,title_en,intro_zh,intro_en,layout,sort_order,published) VALUES(?,?,?,?,?,?,?,?)`);
seedEditorial.run('hero','紫云湖','Ziyun Lake','笔墨纸砚 · 传承东方文房雅器','Brush, Ink, Paper & Inkstone · Made for the Modern Scholar','left',1,1);
seedEditorial.run('treasures','文房四宝','The Four Treasures','笔、墨、纸、砚，千年文人书房的至珍之物','Brush, ink, paper, and inkstone—the enduring essentials of the scholar\'s studio.','centered',2,1);
seedEditorial.run('artisans','匠人访谈','Artisan Interviews',legacyEditorial.artisans_copy_zh,legacyEditorial.artisans_copy_en,'centered',1,1);
seedEditorial.run('culture','文房学堂','Culture Academy',legacyEditorial.culture_copy_zh,legacyEditorial.culture_copy_en,'centered',2,1);
seedEditorial.run('brand_story','品牌故事','Our Story',legacyEditorial.brand_story_copy_zh,legacyEditorial.brand_story_copy_en,'split',3,1);
const eyebrowDefaults={hero:['传承千年文脉','A LIVING LITERARY TRADITION'],treasures:['文房四宝','FOUR TREASURES OF THE STUDY'],artisans:['匠人访谈','ARTISAN INTERVIEW'],culture:['文房文化','CULTURE ACADEMY'],brand_story:['品牌故事','BRAND STORY']};
const setEyebrow=db.prepare("UPDATE editorial_sections SET eyebrow_zh=?,eyebrow_en=? WHERE section_key=? AND eyebrow_zh='' AND eyebrow_en=''");
for(const [key,[zh,en]] of Object.entries(eyebrowDefaults))setEyebrow.run(zh,en,key);
if(!hadHomepageSections){
  db.exec("UPDATE editorial_sections SET sort_order=CASE section_key WHEN 'hero' THEN 1 WHEN 'treasures' THEN 2 WHEN 'artisans' THEN 3 WHEN 'culture' THEN 4 WHEN 'brand_story' THEN 5 ELSE sort_order END");
  db.prepare("UPDATE editorial_sections SET body_zh=?,body_en=? WHERE section_key='hero'").run(
    '撷徽州山水灵气，凝百年匠人匠心。紫云湖臻选天下名笔、佳墨、宣纸、宝砚，让每一次落笔，皆是与千年文化的对话。',
    'Inspired by the landscapes of Huizhou and shaped by generations of makers, Ziyun Lake selects exceptional brushes, ink, Xuan paper, and inkstones—so every stroke becomes a conversation with a thousand years of culture.'
  );
}
db.prepare("UPDATE editorial_sections SET items_layout='two' WHERE section_key='hero' AND items_layout='auto'").run();
db.prepare("UPDATE editorial_sections SET items_layout='four' WHERE section_key='treasures' AND items_layout='auto'").run();
db.prepare("UPDATE editorial_sections SET items_layout='four' WHERE section_key='artisans' AND items_layout='auto'").run();
db.prepare("UPDATE editorial_sections SET items_layout='three' WHERE section_key IN ('culture','brand_story') AND items_layout='auto'").run();

db.exec(`
  CREATE TABLE IF NOT EXISTS editorial_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seed_key TEXT UNIQUE,
    section_key TEXT NOT NULL,
    symbol_zh TEXT NOT NULL DEFAULT '',
    symbol_en TEXT NOT NULL DEFAULT '',
    label_zh TEXT NOT NULL DEFAULT '',
    label_en TEXT NOT NULL DEFAULT '',
    title_zh TEXT NOT NULL,
    title_en TEXT NOT NULL,
    meta_zh TEXT NOT NULL DEFAULT '',
    meta_en TEXT NOT NULL DEFAULT '',
    summary_zh TEXT NOT NULL,
    summary_en TEXT NOT NULL,
    body_zh TEXT NOT NULL DEFAULT '',
    body_en TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(section_key) REFERENCES editorial_sections(section_key) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_editorial_items_section_sort ON editorial_items(section_key,sort_order,id);
`);
const seedEditorialItem=db.prepare(`INSERT OR IGNORE INTO editorial_items(seed_key,section_key,symbol_zh,symbol_en,label_zh,label_en,title_zh,title_en,meta_zh,meta_en,summary_zh,summary_en,body_zh,body_en,sort_order,published) VALUES(@seed_key,@section_key,@symbol_zh,@symbol_en,@label_zh,@label_en,@title_zh,@title_en,@meta_zh,@meta_en,@summary_zh,@summary_en,@body_zh,@body_en,@sort_order,1)`);
if(legacyEditorial.profile_seed_version<3){
  for(const item of editorialItemSeeds)seedEditorialItem.run({symbol_zh:'',symbol_en:'',label_zh:'',label_en:'',meta_zh:'',meta_en:'',body_zh:'',body_en:'',...item});
  db.prepare("UPDATE store_profile SET profile_seed_version=3 WHERE id=1").run();
}
if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id='homepage_content_independent_v1'").get()) {
  const publishHomepageContent = db.transaction(() => {
    db.prepare('UPDATE editorial_sections SET published=1').run();
    db.prepare('UPDATE editorial_items SET published=1').run();
    db.prepare("INSERT INTO schema_migrations(id) VALUES('homepage_content_independent_v1')").run();
  });
  publishHomepageContent.immediate();
}
console.log('数据库初始化完成');
module.exports = db;
