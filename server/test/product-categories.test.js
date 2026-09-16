const test = require('node:test');
const assert = require('node:assert/strict');

test('product categories are configurable and drive the public catalog', async t => {
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'isolated-product-categories-test';
  require('../config/initDB');
  const db = require('../config/db');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/products', require('../routes/products'));
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (url, { method = 'GET', token, body } = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, ...(await response.json()) };
  };

  const initial = await request('/products/categories');
  assert.deepEqual(initial.data.list.map(category => category.code), ['pen', 'ink', 'paper', 'inkstone', 'other']);
  assert.deepEqual(initial.data.list.map(category => category.name_zh), ['毛笔', '墨品', '宣纸', '砚台', '其他']);
  const initialPens=initial.data.list.find(category => category.code === 'pen');
  assert.deepEqual(initialPens.children.map(child => child.code), ['mixed-hair', 'weasel-hair', 'goat-hair', 'brush-other']);
  assert.equal(initialPens.children.reduce((sum,child)=>sum+child.product_count,0),initialPens.product_count);

  const login = await request('/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert.equal(login.code, 200);
  const token = login.data.token;

  const createdCategory = await request('/admin/products/categories', {
    method: 'POST', token,
    body: { code: 'seal', name_zh: '印章', name_en: 'Seals', sort_order: 2, enabled: true },
  });
  assert.equal(createdCategory.code, 200);
  assert.equal(createdCategory.data.sort_order, 2);

  const createdSubcategory = await request('/admin/products/categories/seal/subcategories', {
    method: 'POST', token,
    body: { code: 'stone-seal', name_zh: '石印', name_en: 'Stone Seals', enabled: true },
  });
  assert.equal(createdSubcategory.code, 200);
  assert.equal(createdSubcategory.data.category_code, 'seal');

  const invalidProduct = await request('/admin/products', {
    method: 'POST', token,
    body: { name: '无分类商品', category: 'missing', price: 10, stock: 1 },
  });
  assert.equal(invalidProduct.status, 400);
  assert.match(invalidProduct.message, /商品分类不存在/);
  const invalidSubcategory = await request('/admin/products', {
    method: 'POST', token,
    body: { name: '错配子分类', category: 'ink', subcategory: 'stone-seal', price: 10, stock: 1 },
  });
  assert.equal(invalidSubcategory.status, 400);
  assert.match(invalidSubcategory.message, /子分类不存在或不属于/);

  const createdProduct = await request('/admin/products', {
    method: 'POST', token,
    body: { name: '篆刻印章', category: 'seal', subcategory: 'stone-seal', price: 88, stock: 5, status: 1 },
  });
  assert.equal(createdProduct.code, 200);

  const filtered = await request('/products?category=seal&pageSize=20');
  assert.equal(filtered.data.list.length, 1);
  assert.equal(filtered.data.list[0].name, '篆刻印章');
  assert.equal(filtered.data.list[0].category_name_zh, '印章');
  assert.equal(filtered.data.list[0].category_name_en, 'Seals');
  assert.equal(filtered.data.list[0].subcategory_name_zh, '石印');
  assert.equal((await request('/products?category=seal&subcategory=stone-seal&pageSize=20')).data.list.length, 1);

  const publicWithSeal = await request('/products/categories');
  assert.equal(publicWithSeal.data.list.find(category => category.code === 'seal').product_count, 1);

  const updated = await request('/admin/products/categories/seal', {
    method: 'PUT', token,
    body: { name_zh: '篆刻印章', name_en: 'Seal Carving', sort_order: 1, enabled: false },
  });
  assert.equal(updated.code, 200);
  assert.equal(updated.data.sort_order, 1);
  assert.equal(updated.data.enabled, 0);
  assert.equal((await request('/products/categories')).data.list.some(category => category.code === 'seal'), false);

  const detail = await request('/products/' + createdProduct.data.id);
  assert.equal(detail.data.category_name_zh, '篆刻印章');
  assert.equal(detail.data.category_name_en, 'Seal Carving');

  const usedSubcategoryDelete = await request('/admin/products/categories/seal/subcategories/stone-seal', { method: 'DELETE', token });
  assert.equal(usedSubcategoryDelete.status, 409);
  assert.match(usedSubcategoryDelete.message, /仍有1件商品/);

  const usedDelete = await request('/admin/products/categories/seal', { method: 'DELETE', token });
  assert.equal(usedDelete.status, 409);
  assert.match(usedDelete.message, /仍有1件商品/);

  assert.equal((await request('/admin/products/categories', {
    method: 'POST', token,
    body: { code: 'gift', name_zh: '礼盒', name_en: 'Gift Sets', enabled: true },
  })).code, 200);
  assert.equal((await request('/admin/products/categories/gift', { method: 'DELETE', token })).code, 200);
  const adminCategories = await request('/admin/products/categories', { token });
  assert.equal(adminCategories.data.list.find(category => category.code === 'seal').product_count, 1);
  assert.equal(adminCategories.data.list.find(category => category.code === 'seal').children[0].product_count, 1);
});
