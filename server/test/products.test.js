const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pages = ['public/index.html', '../frontend/index.html'];
const product = {
  id: 9001, name: '后台新增测试毛笔', category: 'pen',
  price: 68.5, stock: 17, spec: '中楷', description: '后台商品描述',
  image: '/uploads/test-brush.jpg',
};

for (const page of pages) {
  const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
  const normalizer = html.slice(html.indexOf('  function normalizeProduct('), html.indexOf('  const formatPrice ='));
  function normalize(value, apiBase = '/api') {
    const context = { product: value, API_BASE_URL: apiBase, URL, window: { location: { href: 'https://shop.example.com/' } } };
    return vm.runInNewContext(normalizer + '\nnormalizeProduct(product)', context);
  }

  function mountProducts(get, props = {}) {
    const state = [];
    const body = html.slice(html.indexOf('  function Products('), html.indexOf('    const selectCategory=', html.indexOf('  function Products(')));
    const load = vm.runInNewContext(body + '\nreturn loadProducts; }\nProducts(props)', {
      props: { activeCat: 'all', searchKeyword: '', ...props },
      useState: initial => {
        const index = state.push(initial) - 1;
        return [initial, value => { state[index] = value; }];
      },
      useRef: current => ({ current }),
      useCallback: fn => fn,
      useEffect: () => {},
      useLanguage: () => ({ language: 'zh' }),
      translateUiText: value => String(value ?? ''),
      API: { get }, normalizeProduct: value => normalize(value),
    });
    return { state, load };
  }

  test(`${page}: API failures are visible and retry loads real products`, async () => {
    let failed = true;
    const component = mountProducts(async () => {
      if (failed) throw new Error('测试接口不可用');
      return { list: [product] };
    });
    await component.load();
    assert.equal(component.state[0].length, 0);
    assert.equal(component.state[1], false);
    assert.equal(component.state[2], '测试接口不可用');
    failed = false;
    await component.load();
    assert.equal(component.state[0][0].id, product.id);
    assert.equal(component.state[0][0].specs[0].price, product.price);
    assert.equal(component.state[2], '');
  });

  test(`${page}: search sends category and stale requests cannot replace newer data`, async () => {
    const pending = [];
    const component = mountProducts(url => {
      assert.equal(new URL(url, 'https://shop.example.com').searchParams.get('category'), 'pen');
      assert.equal(new URL(url, 'https://shop.example.com').searchParams.get('q'), '测试');
      return new Promise(resolve => pending.push(resolve));
    }, { activeCat: 'brush', searchKeyword: '测试' });
    const oldRequest = component.load();
    const newRequest = component.load();
    pending[1]({ list: [{ ...product, id: 2 }] });
    await newRequest;
    pending[0]({ list: [{ ...product, id: 1 }] });
    await oldRequest;
    assert.equal(component.state[0][0].id, 2);
    assert.equal(component.state[1], false);
  });

  test(`${page}: backend fields provide card and detail specs`, () => {
    const result = normalize(product);
    assert.equal(result.id, 9001);
    assert.equal(result.specs[0].label, '中楷');
    assert.equal(result.specs[0].price, 68.5);
    assert.equal(result.specs[0].stock, 17);
    assert.equal(result.catLabel, '毛笔');
    assert.equal(normalize({ ...product, subcategory_name_zh:'兼毫', subcategory:'mixed-hair' }).subcatLabel, '兼毫');
    assert.equal(result.desc, '后台商品描述');
    assert.equal(result.image, 'https://shop.example.com/uploads/test-brush.jpg');
  });

  test(`${page}: empty specs and zero stock remain valid`, () => {
    const result = normalize({ ...product, spec: '', specs: [], price: 0, stock: 0, image: '' });
    assert.equal(result.specs[0].label, '默认规格');
    assert.equal(result.specs[0].price, 0);
    assert.equal(result.specs[0].stock, 0);
    assert.equal(result.image, '');
  });

  test(`${page}: existing variants and external images are preserved`, () => {
    const variants = [{ label: '小楷', price: 20, stock: 3 }, { label: '大楷', price: 30, stock: 5 }];
    const result = normalize({ ...product, specs: variants, image: 'https://images.example.com/brush.jpg' });
    assert.equal(result.specs, variants);
    assert.equal(result.image, 'https://images.example.com/brush.jpg');
    assert.equal(normalize(product, 'https://api.example.com/api').image, 'https://api.example.com/uploads/test-brush.jpg');
  });

  test(`${page}: reveal observes asynchronously inserted cards and cleans up`, () => {
    const existing = { nodeType: 1, matches: () => true, querySelectorAll: () => [] };
    const inserted = { nodeType: 1, matches: () => true, querySelectorAll: () => [] };
    const observed = [];
    let onMutation, cleanup, disconnected = 0;
    const hook = html.slice(html.indexOf('  function useReveal()'), html.indexOf('  // ========== 主应用'));
    vm.runInNewContext(hook + '\nuseReveal()', {
      useEffect: fn => { cleanup = fn(); },
      document: { documentElement: existing, getElementById: () => existing },
      IntersectionObserver: class {
        observe(element) { observed.push(element); }
        disconnect() { disconnected++; }
      },
      MutationObserver: class {
        constructor(callback) { onMutation = callback; }
        observe() {}
        disconnect() { disconnected++; }
      },
    });
    onMutation([{ addedNodes: [inserted] }]);
    assert.deepEqual(observed, [existing, inserted]);
    cleanup();
    assert.equal(disconnected, 2);
  });
}

test('admin-created products are accessible through public list, search and detail', async t => {
  // Never open or modify a user's database or load their .env for these tests.
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'isolated-products-regression-test';
  require('../config/initDB');
  const db = require('../config/db');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/products', require('../routes/products'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(url, options) {
    const response = await fetch(base + url, options);
    return { status: response.status, ...(await response.json()) };
  }
  const login = await request('/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(login.code, 200);
  const created = await request('/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.data.token}` },
    body: JSON.stringify(product),
  });
  assert.equal(created.code, 200);
  const id = created.data.id;

  await t.test('public/admin lists and search sort IDs numerically ascending before pagination', async () => {
    for (const url of ['/products?pageSize=50','/products/search?q=pen','/admin/products?pageSize=50']) {
      const result=await request(url,{headers:{Authorization:`Bearer ${login.data.token}`}});
      const ids=result.data.list.map(item=>item.id);
      assert.ok(ids.length>1);assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
    }
    const page1=await request('/products?page=1&pageSize=10'),page2=await request('/products?page=2&pageSize=10');
    assert.equal(page1.data.list[0].id,1);assert.equal(page1.data.list[9].id,10);assert.equal(page2.data.list[0].id,11);
  });

  await t.test('list contains the new database product', async () => {
    const result = await request('/products?pageSize=50');
    assert.equal(result.code, 200);
    const found = result.data.list.find(item => item.id === id);
    assert.equal(found.name, product.name);
    assert.equal(found.price, product.price);
  });
  await t.test('search is not intercepted by the detail route', async () => {
    const result = await request('/products/search?q=' + encodeURIComponent(product.name));
    assert.equal(result.status, 200);
    assert.equal(result.data.list.length, 1);
    assert.equal(result.data.list[0].id, id);
  });
  await t.test('brush category uses the backend pen code for list and search', async () => {
    const result = await request('/products?category=pen&pageSize=100');
    assert.ok(result.data.list.some(item => item.id === id));
    assert.ok(result.data.list.every(item => item.category === 'pen'));
    const search = await request('/products/search?category=pen&q=' + encodeURIComponent(product.name));
    assert.equal(search.data.list[0].id, id);
  });
  await t.test('search respects category and handles empty keywords', async () => {
    const result = await request('/products/search?category=paper&q=' + encodeURIComponent(product.name));
    assert.deepEqual(result.data.list, []);
    const empty = await request('/products/search');
    assert.equal(empty.code, 200);
    assert.deepEqual(empty.data.list, []);
  });
  await t.test('detail returns actual price, stock and description', async () => {
    const result = await request('/products/' + id);
    assert.equal(result.data.price, product.price);
    assert.equal(result.data.stock, product.stock);
    assert.equal(result.data.description, product.description);
    assert.equal((await request('/products/999999999')).status, 404);
  });
});
