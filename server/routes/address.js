const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
const validate = require('../services/validation');

function normalize(body, partial=false) {
  const result={};
  for(const [key,label,max] of [['name','收货人',60],['phone','联系电话',30],['country','国家/地区',60],['province','省/州',60],['city','城市',60],['district','区县',60],['detail','详细地址',300]]) {
    if(!partial || body[key]!==undefined) result[key]=validate.text(body[key],label,{required:['name','phone','country','detail'].includes(key),max});
  }
  if(result.phone!==undefined && !/^\+?[0-9][0-9\s()-]{5,28}$/.test(result.phone)) require('../services/commerce').fail('请填写有效的联系电话');
  if(body.is_default!==undefined) result.is_default=validate.boolean(body.is_default,'默认地址');
  return result;
}

// 获取地址列表
router.get('/', authRequired, (req, res) => {
  const list = db.prepare(
    'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
  ).all(req.user.id);
  res.json({ code: 200, data: list });
});

// 新增地址
router.post('/', authRequired, (req, res) => {
  const { name, phone, country, province, city, district, detail, is_default = false } = normalize({...req.body,country:req.body.country??'中国',is_default:req.body.is_default??false});

  // 如果设为默认，先取消其他默认
  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  const result = db.prepare(
    'INSERT INTO addresses (user_id, name, phone, country, province, city, district, detail, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name, phone, country, province || '', city || '', district || '', detail, is_default ? 1 : 0);

  res.json({ code: 200, message: '地址添加成功', data: { id: result.lastInsertRowid } });
});

// 更新地址
router.put('/:id', authRequired, (req, res) => {
  const { name, phone, country, province, city, district, detail, is_default } = normalize(req.body,true);
  const item = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) {
    return res.status(404).json({ code: 404, message: '地址不存在' });
  }

  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(`
    UPDATE addresses SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      country = COALESCE(?, country),
      province = COALESCE(?, province),
      city = COALESCE(?, city),
      district = COALESCE(?, district),
      detail = COALESCE(?, detail),
      is_default = COALESCE(?, is_default)
    WHERE id = ? AND user_id = ?
  `).run(name??null, phone??null, country??null, province??null, city??null, district??null, detail??null, is_default===undefined?null:(is_default?1:0), req.params.id, req.user.id);

  res.json({ code: 200, message: '地址更新成功' });
});

// 删除地址
router.delete('/:id', authRequired, (req, res) => {
  const result = db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ code: 404, message: '地址不存在' });
  }
  res.json({ code: 200, message: '地址已删除' });
});

// 设为默认地址
router.put('/:id/default', authRequired, (req, res) => {
  const item = db.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) {
    return res.status(404).json({ code: 404, message: '地址不存在' });
  }
  db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(req.params.id);
  res.json({ code: 200, message: '已设为默认地址' });
});

module.exports = router;
