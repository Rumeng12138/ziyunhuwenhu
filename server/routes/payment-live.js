const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const { providers, startPayment, refreshPayment } = require('../services/payments');
const { orderDetail, settlePayment } = require('../services/commerce');
const router = express.Router();
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
const personal = require('../services/personal-payments');
router.get('/methods', (req, res) => res.json({ code: 200, data: [...personal.methods(),...Object.entries(providers).map(([id, p]) => ({ id, enabled: p.isReady, mode:'provider', name: id === 'alipay' ? '商户支付宝' : '商户微信' }))] }));
router.post('/personal/:id/claim', authRequired, (req,res) => {
  res.json({code:200,message:'已提交转账信息，等待商家核实；请勿重复付款',data:personal.claim.immediate(req.params.id,req.user.id,req.body)});
});
router.post('/pay', authRequired, async (req, res, next) => {
  try {
    if(process.env.NODE_ENV==='production'&&!require('../services/store-profile').tradeReady()) return res.status(503).json({code:503,message:'经营资料或正式商品图片尚未通过上线检查，暂不可收款'});
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.body.order_id, req.user.id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    res.json({ code: 200, data: await startPayment(order.id, req.body.payment_method) });
  } catch (error) { next(error); }
});
router.get('/status/:orderNo', authRequired, async (req, res, next) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ? AND user_id = ?').get(req.params.orderNo, req.user.id);
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' });
    res.json({ code: 200, data: orderDetail(await refreshPayment(order)) });
  } catch (error) { next(error); }
});
router.post('/alipay/notify', (req, res) => {
  try {
    const payment = providers.alipay.verifyNotify(req.body);
    if (payment) settlePayment('alipay', payment);
    res.send('success');
  } catch { res.status(400).send('fail'); }
});
router.post('/wechat/notify', (req, res) => {
  try {
    if (!req.rawBody) throw new Error('缺少原始通知报文');
    const payment = providers.wechat.verifyNotify(req.headers, req.rawBody.toString('utf8'));
    if (payment) settlePayment('wechat', payment);
    res.status(204).end();
  } catch { res.status(400).json({ code: 'FAIL', message: '支付通知校验失败' }); }
});
// No raw card details are collected, stored or used for simulated payments.
router.get('/bankcards', authRequired, (req, res) => res.status(410).json({ code: 410, message: '本站不保存银行卡；请在支付宝或微信官方收银台选择银行卡' }));
router.post('/bankcards', authRequired, (req, res) => res.status(410).json({ code: 410, message: '请在支付宝或微信官方收银台使用银行卡，本网站不收集卡号或安全码' }));
router.delete('/bankcards/:id', authRequired, (req, res) => res.status(410).json({ code: 410, message: '银行卡功能已停用' }));
module.exports = router;
