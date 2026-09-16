const express = require('express');
const db = require('../config/db');
const { authRequired, authOptional } = require('../middleware/auth');

const router = express.Router();
const validate = require('../services/validation');
const { createWriteLimit } = require('../middleware/security');
const submitLimit = createWriteLimit({ windowMs: 60 * 60 * 1000, limit: 10 });

// 提交意见反馈（登录/未登录均可）
router.post('/', submitLimit, authOptional, (req, res) => {
  const { type, content, contact } = req.body;
  const safeContent=validate.text(content, '反馈内容', { max: 500 });
  const safeContact=validate.optionalText(contact, '联系方式', 120);
  const validTypes = ['suggestion', 'quality', 'logistics', 'aftersale', 'other'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ code: 400, message: '反馈类型不正确' });
  }
  const userId = req.user ? req.user.id : null;
  db.prepare(
    'INSERT INTO feedbacks (user_id, type, content, contact) VALUES (?, ?, ?, ?)'
  ).run(userId, type, safeContent, safeContact);

  res.json({ code: 200, message: '反馈提交成功，感谢您的宝贵意见' });
});

// 获取我的反馈列表（需登录）
router.get('/mine', authRequired, (req, res) => {
  const {page,pageSize,offset}=require('../services/pagination')(req.query,20);
  const total=db.prepare('SELECT COUNT(*) count FROM feedbacks WHERE user_id=?').get(req.user.id).count;
  const list = db.prepare('SELECT * FROM feedbacks WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?').all(req.user.id,pageSize,offset);
  res.json({ code: 200, data: {list,total,page,pageSize} });
});

module.exports = router;
