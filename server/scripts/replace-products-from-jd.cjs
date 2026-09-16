const fs = require('node:fs');
const path = require('node:path');
const { products, legacyMockNames, source } = require('../catalog/jd-products.cjs');
const {backupDir}=require('../config/storage');

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function replaceCatalog(db) {
  const legacyRows = db.prepare(`
    SELECT id, name FROM products
    WHERE image LIKE 'https://picsum.photos/%'
       OR name IN (${placeholders(legacyMockNames)})
  `).all(...legacyMockNames);
  const legacyIds = legacyRows.map(row => row.id);

  return db.transaction(() => {
    let clearedCartItems = 0;
    let clearedFavorites = 0;
    let detachedOrderItems = 0;

    if (legacyIds.length) {
      const idList = placeholders(legacyIds);
      clearedCartItems = db.prepare(`DELETE FROM cart_items WHERE product_id IN (${idList})`).run(...legacyIds).changes;
      clearedFavorites = db.prepare(`DELETE FROM favorites WHERE product_id IN (${idList})`).run(...legacyIds).changes;
      detachedOrderItems = db.prepare(`UPDATE order_items SET product_id = NULL WHERE product_id IN (${idList})`).run(...legacyIds).changes;

      const campaigns = db.prepare('SELECT id, product_ids FROM marketing_campaigns').all();
      const updateCampaign = db.prepare('UPDATE marketing_campaigns SET product_ids = ?, updated_at = ? WHERE id = ?');
      const legacySet = new Set(legacyIds);
      for (const campaign of campaigns) {
        const ids = JSON.parse(campaign.product_ids);
        const retained = ids.filter(id => !legacySet.has(id));
        if (retained.length !== ids.length) updateCampaign.run(JSON.stringify(retained), new Date().toISOString(), campaign.id);
      }

      db.prepare(`DELETE FROM products WHERE id IN (${idList})`).run(...legacyIds);
    }

    const findBySku = db.prepare('SELECT id FROM products WHERE source_sku = ?');
    const insertProduct = db.prepare(`
      INSERT INTO products (
        name, category, price, stock, spec, description, image, status,
        sort_order, listed_at, source_sku, source_url, source_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?, ?)
    `);
    const updateProduct = db.prepare(`
      UPDATE products SET
        name = ?, category = ?, price = ?, stock = ?, spec = ?, description = ?, image = ?,
        status = ?, sort_order = ?, listed_at = COALESCE(listed_at, datetime('now','localtime')),
        source_url = ?, source_checked_at = ?
      WHERE id = ?
    `);
    const catalogIds = [];

    products.forEach((product, index) => {
      const existing = findBySku.get(product.sourceSku);
      if (existing) {
        updateProduct.run(
          product.name, product.category, product.price, product.stock, product.spec,
          product.description, product.image, product.status, index + 1,
          product.sourceUrl, product.sourceCheckedAt, existing.id,
        );
        catalogIds.push(existing.id);
      } else {
        const result = insertProduct.run(
          product.name, product.category, product.price, product.stock, product.spec,
          product.description, product.image, product.status, index + 1,
          product.sourceSku, product.sourceUrl, product.sourceCheckedAt,
        );
        catalogIds.push(Number(result.lastInsertRowid));
      }
    });

    const catalogIdSet = new Set(catalogIds);
    const otherProducts = db.prepare('SELECT id FROM products ORDER BY sort_order, id').all().filter(row => !catalogIdSet.has(row.id));
    const setSortOrder = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?');
    catalogIds.forEach((id, index) => setSortOrder.run(index + 1, id));
    otherProducts.forEach((row, index) => setSortOrder.run(products.length + index + 1, row.id));

    return {
      deletedLegacyProducts: legacyIds.length,
      importedProducts: products.length,
      clearedCartItems,
      clearedFavorites,
      detachedOrderItems,
    };
  })();
}

async function main() {
  const db = require('../config/initDB');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `before-jd-products-${stamp}.db`);
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    await db.backup(backupPath);
    const result = replaceCatalog(db);
    const remainingMocks = db.prepare(`
      SELECT COUNT(*) count FROM products
      WHERE image LIKE 'https://picsum.photos/%'
         OR name IN (${placeholders(legacyMockNames)})
    `).get(...legacyMockNames).count;
    const imported = db.prepare('SELECT COUNT(*) count FROM products WHERE source_checked_at = ?').get(source.checkedAt).count;
    const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
    if (remainingMocks !== 0 || imported !== products.length || foreignKeyProblems.length) {
      throw new Error('替换后的商品目录校验失败，请从备份恢复');
    }
    console.log(JSON.stringify({ ...result, store: source.store, checkedAt: source.checkedAt, backupPath }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { replaceCatalog };
