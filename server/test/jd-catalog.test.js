const assert = require('node:assert/strict');
const { test } = require('node:test');

const { products, legacyMockNames, source } = require('../catalog/jd-products.cjs');

test('京东商品目录替换模拟数据并保留历史订单快照', () => {
  assert.equal(source.store, '紫云湖旗舰店');
  assert.equal(source.storeUrl, 'https://mall.jd.com/index-15454499.html');
  assert.equal(products.length, 23);
  assert.equal(new Set(products.map(product => product.sourceSku)).size, products.length);
  for (const product of products) {
    assert.match(product.sourceSku, /^\d{14}$/);
    assert.equal(product.sourceUrl, `https://item.jd.com/${product.sourceSku}.html`);
    assert.equal(product.sourceCheckedAt, source.checkedAt);
    assert.equal(product.category, 'pen');
    assert.ok(product.price > 0);
    assert.ok(product.stock > 0);
    assert.match(product.image, /^https:\/\/m\.360buyimg\.com\//);
    assert.doesNotMatch(product.image, /picsum\.photos/);
    assert.ok(product.name.startsWith('紫云湖'));
    assert.ok(product.spec.length > 0);
    assert.ok(product.description.length > 0);
  }
  assert.equal(products.some(product => legacyMockNames.includes(product.name)), false);

  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'isolated-jd-catalog-test';
  const db = require('../config/initDB');
  const { replaceCatalog } = require('../scripts/replace-products-from-jd.cjs');

  try {
    const seeded = db.prepare('SELECT * FROM products ORDER BY sort_order, id').all();
    assert.equal(seeded.length, products.length);
    assert.deepEqual(seeded.map(product => product.source_sku), products.map(product => product.sourceSku));

    const userId = Number(db.prepare("INSERT INTO users(username,password,nickname) VALUES('catalog-test-user','not-used','目录测试')").run().lastInsertRowid);
    const legacyId = Number(db.prepare(`
      INSERT INTO products(name,category,price,stock,spec,description,image,status,sort_order)
      VALUES('测试','ink',1,1,'模拟规格','模拟描述','https://picsum.photos/id/1/400/400',1,999)
    `).run().lastInsertRowid);
    const orderId = Number(db.prepare(`
      INSERT INTO orders(order_no,user_id,total_amount,receiver_name,receiver_phone,receiver_address)
      VALUES('JD-CATALOG-ORDER',?,1,'测试用户','13800000000','测试地址')
    `).run(userId).lastInsertRowid);
    db.prepare(`
      INSERT INTO order_items(order_id,product_id,product_name,price,quantity,spec,image)
      VALUES(?,?,'历史模拟商品',1,1,'历史规格','/history.jpg')
    `).run(orderId, legacyId);
    db.prepare('INSERT INTO cart_items(user_id,product_id,quantity) VALUES(?,?,1)').run(userId, legacyId);
    db.prepare('INSERT INTO favorites(user_id,product_id) VALUES(?,?)').run(userId, legacyId);
    db.prepare("INSERT INTO marketing_campaigns(name,type,product_ids,updated_at) VALUES('旧商品活动','discount',?,?)")
      .run(JSON.stringify([legacyId]), new Date().toISOString());

    const result = replaceCatalog(db);
    assert.equal(result.deletedLegacyProducts, 1);
    assert.equal(result.clearedCartItems, 1);
    assert.equal(result.clearedFavorites, 1);
    assert.equal(result.detachedOrderItems, 1);
    assert.equal(db.prepare('SELECT product_id FROM order_items WHERE order_id = ?').get(orderId).product_id, null);
    assert.equal(db.prepare('SELECT product_name FROM order_items WHERE order_id = ?').get(orderId).product_name, '历史模拟商品');
    assert.equal(db.prepare("SELECT product_ids FROM marketing_campaigns WHERE name='旧商品活动'").get().product_ids, '[]');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM products WHERE image LIKE '%picsum.photos%'").get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM products WHERE source_checked_at = ?').get(source.checkedAt).count, products.length);

    const liveProduct = db.prepare('SELECT id FROM products WHERE source_sku = ?').get(products[0].sourceSku);
    db.prepare(`
      INSERT INTO order_items(order_id,product_id,product_name,price,quantity,spec,image)
      VALUES(?,?,?,76,1,'下单规格','/snapshot.jpg')
    `).run(orderId, liveProduct.id, products[0].name);
    db.prepare('DELETE FROM products WHERE id = ?').run(liveProduct.id);
    const deletedReference = db.prepare('SELECT product_id,product_name,image FROM order_items WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
    assert.equal(deletedReference.product_id, null);
    assert.equal(deletedReference.product_name, products[0].name);
    assert.equal(deletedReference.image, '/snapshot.jpg');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});
