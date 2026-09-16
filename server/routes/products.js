const express = require('express');
const db = require('../config/db');

const router = express.Router();
const pagination = require('../services/pagination');

function enrichProductCategories(products) {
  const categories = new Map(db.prepare('SELECT code,name_zh,name_en FROM product_categories').all().map(category => [category.code.toLowerCase(), category]));
  const subcategories = new Map(db.prepare('SELECT category_code,code,name_zh,name_en FROM product_subcategories').all()
    .map(subcategory => [`${subcategory.category_code.toLowerCase()}:${subcategory.code.toLowerCase()}`, subcategory]));
  return products.map(product => {
    const category = categories.get(String(product.category || '').toLowerCase());
    const subcategory = subcategories.get(`${String(product.category || '').toLowerCase()}:${String(product.subcategory || '').toLowerCase()}`);
    return {
      ...product,
      category_name_zh: category?.name_zh || product.category,
      category_name_en: category?.name_en || product.category,
      subcategory_name_zh: subcategory?.name_zh || product.subcategory || '',
      subcategory_name_en: subcategory?.name_en || product.subcategory || '',
    };
  });
}

// 前台分类导航由后台分类设置驱动，仅返回已启用分类。
router.get('/categories', (req, res) => {
  const list = db.prepare(`
    SELECT c.code,c.name_zh,c.name_en,c.sort_order,
      (SELECT COUNT(*) FROM products p WHERE p.category=c.code COLLATE NOCASE AND p.status=1) product_count
    FROM product_categories c WHERE c.enabled=1
    ORDER BY c.sort_order ASC,c.code ASC
  `).all();
  const children = db.prepare(`
    SELECT s.category_code,s.code,s.name_zh,s.name_en,s.sort_order,
      (SELECT COUNT(*) FROM products p WHERE p.category=s.category_code COLLATE NOCASE AND p.subcategory=s.code COLLATE NOCASE AND p.status=1) product_count
    FROM product_subcategories s
    JOIN product_categories c ON c.code=s.category_code COLLATE NOCASE
    WHERE s.enabled=1 AND c.enabled=1
    ORDER BY s.category_code ASC,s.sort_order ASC,s.code ASC
  `).all();
  for (const category of list) category.children = children.filter(child => child.category_code.toLowerCase() === category.code.toLowerCase());
  res.set('Cache-Control', 'no-store');
  res.json({ code: 200, data: { list } });
});

// 商品列表（支持分类筛选和搜索）
router.get('/', (req, res) => {
  const { category, subcategory, keyword } = req.query;
  const {page,pageSize,offset}=pagination(req.query);
  let sql = 'SELECT * FROM products WHERE status = 1';
  const params = [];

  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (subcategory && subcategory !== 'all') {
    sql += ' AND subcategory = ?';
    params.push(subcategory);
  }
  if (keyword) {
    sql += ' AND (name LIKE ? OR spec LIKE ? OR description LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }

  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as count')).get(...params).count;

  sql += ' ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = enrichProductCategories(db.prepare(sql).all(...params));

  res.json({
    code: 200,
    data: {
      list,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

// 搜索商品
router.get('/search', (req, res) => {
  const { q, category, subcategory } = req.query;
  const {page,pageSize,offset}=pagination(req.query,50);
  if (!q) {
    return res.json({ code: 200, data: { list: [], total: 0 } });
  }
  let sql = 'SELECT * FROM products WHERE status = 1 AND (name LIKE ? OR spec LIKE ? OR description LIKE ? OR category LIKE ? OR subcategory LIKE ?)';
  const kw = `%${q}%`;
  const params = [kw, kw, kw, kw, kw];
  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (subcategory && subcategory !== 'all') {
    sql += ' AND subcategory = ?';
    params.push(subcategory);
  }
  const total=db.prepare(sql.replace('SELECT *','SELECT COUNT(*) total')).get(...params).total;
  sql += ' ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?';
  const list = enrichProductCategories(db.prepare(sql).all(...params,pageSize,offset));
  res.json({ code: 200, data: { list, total, page, pageSize, totalPages:Math.ceil(total/pageSize) } });
});

// 固定路径 /search 必须先于 /:id 注册，否则搜索会被当成商品详情。
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = 1').get(req.params.id);
  if (!product) {
    return res.status(404).json({ code: 404, message: '商品不存在' });
  }
  res.json({ code: 200, data: enrichProductCategories([product])[0] });
});

module.exports = router;
