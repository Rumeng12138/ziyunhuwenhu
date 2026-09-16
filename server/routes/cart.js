const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const { quantity: validateQuantity } = require('../services/commerce');
const router = express.Router();

// 获取购物车列表
router.get('/', authRequired, (req, res) => {
  const list = db.prepare(`
    SELECT c.id, c.product_id, c.quantity, p.name, p.price, p.stock, p.spec, p.image, p.status
    FROM cart_items c
    JOIN products p ON c.product_id = p.id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);

  const totalAmount = list.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCount = list.reduce((sum, item) => sum + item.quantity, 0);

  res.json({
    code: 200,
    data: { list, totalAmount, totalCount },
  });
});

// 添加到购物车
router.post('/', authRequired, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  validateQuantity(quantity);
  if (!product_id) {
    return res.status(400).json({ code: 400, message: '商品ID不能为空' });
  }
  const product = db.prepare('SELECT id, stock FROM products WHERE id = ? AND status = 1').get(product_id);
  if (!product) {
    return res.status(404).json({ code: 404, message: '商品不存在' });
  }

  const exist = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, product_id);
  if (exist) {
    const newQty = exist.quantity + quantity;
    if (newQty > product.stock) {
      return res.status(400).json({ code: 400, message: '库存不足' });
    }
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, exist.id);
  } else {
    if (!product || quantity > product.stock) {
      return res.status(400).json({ code: 400, message: '库存不足' });
    }
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(req.user.id, product_id, quantity);
  }

  res.json({ code: 200, message: '已加入购物车' });
});

// 更新购物车商品数量
router.put('/:id', authRequired, (req, res) => {
  const { quantity } = req.body;
  validateQuantity(quantity);
  if (!quantity || quantity < 1) {
    return res.status(400).json({ code: 400, message: '数量不能小于1' });
  }
  const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) {
    return res.status(404).json({ code: 404, message: '购物车商品不存在' });
  }
  const product = db.prepare('SELECT stock FROM products WHERE id = ? AND status = 1').get(item.product_id);
  if (!product || quantity > product.stock) {
    return res.status(400).json({ code: 400, message: '库存不足' });
  }
  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, req.params.id);
  res.json({ code: 200, message: '更新成功' });
});

// 删除购物车商品
router.delete('/:id', authRequired, (req, res) => {
  const result = db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ code: 404, message: '购物车商品不存在' });
  }
  res.json({ code: 200, message: '已删除' });
});

// 清空购物车
router.delete('/', authRequired, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
  res.json({ code: 200, message: '购物车已清空' });
});

module.exports = router;
