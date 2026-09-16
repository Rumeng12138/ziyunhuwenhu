const db = require('../config/db');
const { fail, cents, settlePayment, releaseOrder } = require('./commerce');
const personal = require('./personal-payments');
const providers = { alipay: require('./alipay-live'), wechat: require('./wechat-live') };
function reloadProviders() {
  const config = require('../config/payment-runtime');
  Object.assign(providers.alipay, require('./alipay-live').createAlipay(config.alipay));
  Object.assign(providers.wechat, require('./wechat-live').createWechat(config.wechat));
}
const withLock = async (id, fn) => {
  const now = Date.now();
  if (!db.prepare('UPDATE orders SET payment_busy_until = ? WHERE id = ? AND COALESCE(payment_busy_until, 0) < ?').run(now + 60000, id, now).changes) fail('支付正在处理中，请稍后再试', 409);
  try { return await fn(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)); }
  finally { db.prepare('UPDATE orders SET payment_busy_until = 0 WHERE id = ? AND payment_busy_until = ?').run(id, now + 60000); }
};
async function startPayment(id, method) {
  const provider = providers[method];
  if (!provider && !personal.isPersonal(method)) fail('请选择普通或商户支付宝 / 微信收款方式');
  if (provider && !provider.isReady) fail('该支付渠道尚未配置商户，暂不可付款', 503);
  return withLock(id, async order => {
    if (order.status !== 'pending') fail('当前订单不可付款', 409);
    if (order.payment_method && order.payment_method !== method) fail('订单已绑定另一支付渠道，请使用原渠道或取消后重新下单', 409);
    if (cents(order.total_amount) <= 0) fail('订单金额不正确');
    if (personal.isPersonal(method)) {
      const result = db.transaction(() => {
        const receipt = personal.start({...order,payment_method:method});
        db.prepare('UPDATE orders SET payment_method=? WHERE id=?').run(method,id);
        return receipt;
      }).immediate();
      return {...result,order_id:id,order_no:order.order_no,payment_method:method};
    }
    db.prepare('UPDATE orders SET payment_method = ? WHERE id = ?').run(method, id);
    // Retain method on a timeout: provider may already have created a payable trade.
    const result = await provider.create(order);
    return { ...result, order_id: id, order_no: order.order_no, payment_method: method };
  });
}
async function refreshPayment(order) {
  if (order.status === 'pending' && order.payment_method && !personal.isPersonal(order.payment_method)) {
    const provider = providers[order.payment_method];
    if (!provider?.isReady) fail('原支付渠道不可用，暂时无法核实支付状态', 503);
    const result = await provider.query(order.order_no);
    if (result.payment) settlePayment(order.payment_method, result.payment);
  }
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}
async function cancelPayment(id) {
  return withLock(id, async order => {
    if (personal.isPersonal(order.payment_method) && order.manual_receipt) fail('普通收款码已展示，须由商家核对未到账后取消，请联系商家',409);
    if (order.status !== 'pending') fail('只有待支付订单可以取消', 409);
    if (order.payment_method) {
      const provider = providers[order.payment_method];
      if (!provider?.isReady) fail('支付渠道不可用，无法安全关闭付款单，请联系商家核实', 503);
      const result = await provider.query(order.order_no);
      if (result.payment) { settlePayment(order.payment_method, result.payment); fail('订单已付款，不能取消，请联系客服申请退款', 409); }
      if (!['CLOSED', 'TRADE_CLOSED'].includes(result.state)) await provider.close(order.order_no);
    }
    releaseOrder(id);
  });
}
module.exports = { providers, startPayment, refreshPayment, cancelPayment, reloadProviders };
