const db = require('../config/db');
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function quantity(value, allowZero = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1000000) {
    fail(allowZero ? '库存必须是 0 到 1000000 的整数' : '数量必须是 1 到 1000000 的整数');
  }
  return value;
}
function cents(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) fail('金额必须是最多两位小数的非负数');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount > 10000000000) fail('金额超出范围');
  return amount;
}
function orderDetail(order) {
  if (!order) return null;
  const items = db.prepare(`SELECT oi.*, COALESCE(NULLIF(oi.image, ''), p.image, '') AS image
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(order.id);
  const {manual_confirmed_by,manual_transaction_reference,...publicOrder} = order;
  let after_sale = null;
  try { after_sale = db.prepare('SELECT id,request_no,type,status,requested_amount,admin_note,return_tracking_company,return_tracking_no,created_at,updated_at FROM after_sales WHERE order_id=? ORDER BY id DESC LIMIT 1').get(order.id) || null; } catch {}
  return { ...publicOrder, items, after_sale };
}
function paymentVerified(order) {
  return !!order.payment_transaction_id || (['alipay_personal','wechat_personal'].includes(order.payment_method) && !!order.manual_confirmed_at && !!order.manual_confirmed_by);
}
// Call only after provider verification. A callback never decrements stock again.
const settlePayment = db.transaction((method, payment) => {
  if (!['alipay','wechat'].includes(method)) fail('普通收款不能使用平台自动验证');
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(payment.orderNo);
  if (!order || order.payment_method !== method || cents(order.total_amount) !== payment.amountCents || !payment.transactionId) fail('支付订单、渠道或金额不匹配');
  if (order.payment_transaction_id && order.payment_transaction_id !== payment.transactionId) fail('支付流水不匹配');
  if (['paid', 'shipped', 'completed'].includes(order.status) && order.payment_transaction_id) return order;
  if (order.status !== 'pending') fail('订单状态不可收款');
  db.prepare("UPDATE orders SET status = 'paid', payment_transaction_id = ?, paid_at = datetime('now','localtime') WHERE id = ? AND status = 'pending'").run(payment.transactionId, order.id);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
});
const releaseOrder = db.transaction(id => {
  const changed = db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
  if (!changed.changes) fail('订单已支付或已取消，请刷新状态', 409);
  for (const item of db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id)) {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
  }
});
module.exports = { fail, quantity, cents, orderDetail, settlePayment, releaseOrder, paymentVerified };
