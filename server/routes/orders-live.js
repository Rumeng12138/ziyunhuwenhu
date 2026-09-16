const express = require('express');
const crypto = require('node:crypto');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { fail, orderDetail } = require('../services/commerce');
const { cancelPayment } = require('../services/payments');
const router = express.Router();
const pricing = require('../services/pricing');
router.use(authRequired);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.post('/quote',(req,res)=>res.json({code:200,data:pricing.quote(req.user.id,req.body)}));
router.get('/', (req, res) => {
  const {page,pageSize}=require('../services/pagination')(req.query,10);
  const status = req.query.status || '';
  if(status && !['pending','payment_review','paid','shipped','completed','cancelled'].includes(status)) return res.status(400).json({code:400,message:'订单状态无效'});
  const where = "user_id = ? AND (? = '' OR status = ?)";
  const params = [req.user.id, status, status];
  const total = db.prepare(`SELECT COUNT(*) count FROM orders WHERE ${where}`).get(...params).count;
  const list = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Math.floor(pageSize), Math.floor((page - 1) * pageSize)).map(orderDetail);
  res.json({ code: 200, data: { list, total, page, pageSize } });
});
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
  res.json({ code: 200, data: orderDetail(order) });
});
const createOrder = db.transaction((userId, body) => {
  const { receiver_name, receiver_phone, receiver_address, receiver_country = '', receiver_province = '', receiver_city = '', receiver_district = '', remark = '', checkout_key } = body;
  if (![receiver_name, receiver_phone, receiver_address].every(v => typeof v === 'string' && v.trim() && v.length <= 500)
    || !/^\+?[0-9][0-9\s()-]{5,28}$/.test(receiver_phone)
    || [receiver_country,receiver_province,receiver_city,receiver_district].some(v=>typeof v!=='string'||v.length>60)
    || typeof remark !== 'string' || remark.length > 1000) fail('请填写有效的收货姓名、联系电话和完整地址');
  if (checkout_key !== undefined && (typeof checkout_key !== 'string' || !/^[\w-]{16,100}$/.test(checkout_key))) fail('下单请求标识无效');
  if (checkout_key) {
    const existing = db.prepare('SELECT * FROM orders WHERE user_id = ? AND checkout_key = ?').get(userId, checkout_key);
    if (existing) return orderDetail(existing);
  }
  if(process.env.NODE_ENV==='production'){
    const open=db.prepare("SELECT COUNT(*) count FROM orders WHERE user_id=? AND status IN ('pending','payment_review')").get(userId).count;
    if(open>=5)fail('待支付或待核实订单过多，请先处理已有订单',429);
  }
  const fromCart = body.items === undefined;
  const quote=pricing.quote(userId,body),items=quote.items;
  if(body.quote_hash!==undefined&&body.quote_hash!==quote.quote_hash)fail('商品或优惠规则已变化，请刷新金额后重新确认',409);
  const orderNo = 'ZYH' + Date.now() + crypto.randomBytes(6).toString('hex');
  const result = db.prepare(`INSERT INTO orders (order_no,user_id,total_amount,freight,receiver_name,receiver_phone,receiver_address,receiver_country,receiver_province,receiver_city,receiver_district,shipping_rule_id,shipping_rule_name,remark,checkout_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderNo,userId,quote.total_amount,quote.freight,receiver_name.trim(),receiver_phone,receiver_address.trim(),receiver_country.trim()||'中国',receiver_province.trim(),receiver_city.trim(),receiver_district.trim(),quote.shipping_rule_id,quote.shipping_rule_name,remark,checkout_key||null);
  const id = result.lastInsertRowid;
  db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(Date.now()+30*60*1000,id);
  const {items:ignored,...snapshot}=quote;
  db.prepare('UPDATE orders SET subtotal_amount=?,promotion_discount=?,full_reduction_discount=?,coupon_discount=?,coupon_code=?,pricing_snapshot=? WHERE id=?').run(quote.subtotal_amount,quote.promotion_discount,quote.full_reduction_discount,quote.coupon_discount,quote.coupon_code,JSON.stringify(snapshot),id);
  if(quote.coupon_id)db.prepare('INSERT INTO coupon_redemptions(order_id,campaign_id,user_id) VALUES(?,?,?)').run(id,quote.coupon_id,userId);
  for (const item of items) {
    if (!db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? AND status = 1').run(item.quantity, item.id, item.quantity).changes) fail('库存已变化，请重新下单', 409);
    db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, quantity, spec, image) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, item.id, item.name, item.price, item.quantity, item.spec || '', item.image || '');
  }
  if (fromCart) db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
  return orderDetail(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
});
router.post('/', (req, res) => res.json({ code: 200, message: '订单已创建，库存已预留', data: createOrder.immediate(req.user.id, req.body) }));
router.put('/:id/cancel', async (req, res, next) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    await cancelPayment(order.id);
    res.json({ code: 200, message: '订单已取消，库存已恢复' });
  } catch (error) { next(error); }
});
router.put('/:id/confirm', (req, res) => {
  const confirm = db.transaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'shipped'").get(req.params.id, req.user.id);
    if (!order) fail('仅已发货订单可确认收货');
    db.prepare("UPDATE orders SET status = 'completed' WHERE id = ? AND status = 'shipped'").run(order.id);
    const points = require('../services/membership').awardOrder(order);
    return points;
  });
  res.json({ code: 200, message: '已确认收货', data: { pointsEarned: confirm.immediate() } });
});
module.exports = router;
