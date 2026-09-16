const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// 获取收藏列表
router.get('/', authRequired, (req, res) => {
  const list = db.prepare(`
    SELECT f.id, f.product_id, f.created_at, p.name, p.price, p.spec, p.image, p.stock, p.status, p.category
    FROM favorites f
    JOIN products p ON f.product_id = p.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.json({ code: 200, data: list });
});

// 添加收藏
router.post('/', authRequired, (req, res) => {
  const { product_id } = req.body;
  if (!product_id) {
    return res.status(400).json({ code: 400, message: '商品ID不能为空' });
  }
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) {
    return res.status(404).json({ code: 404, message: '商品不存在' });
  }
  const exist = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.id, product_id);
  if (exist) {
    return res.json({ code: 200, message: '已收藏', data: { favorited: true } });
  }
  db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, product_id);
  res.json({ code: 200, message: '收藏成功', data: { favorited: true } });
});

// 取消收藏
router.delete('/:productId', authRequired, (req, res) => {
  const result = db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, req.params.productId);
  if (result.changes === 0) {
    return res.status(404).json({ code: 404, message: '未收藏该商品' });
  }
  res.json({ code: 200, message: '已取消收藏', data: { favorited: false } });
});

// 检查是否已收藏
router.get('/check/:productId', authRequired, (req, res) => {
  const exist = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.id, req.params.productId);
  res.json({ code: 200, data: { favorited: !!exist } });
});

module.exports = router;
