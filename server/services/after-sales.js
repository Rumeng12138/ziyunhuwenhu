const crypto = require('node:crypto');
const db = require('../config/db');
const { cents, fail, paymentVerified } = require('./commerce');
const validate = require('./validation');

const activeStatuses = ['pending','approved','returning','refund_pending'];
const publicColumns = `a.*,o.order_no,o.total_amount,o.refunded_amount,o.payment_method,o.status AS order_status`;

function audit(id, actorType, actorId, action, detail = '') {
  db.prepare('INSERT INTO after_sale_audit(after_sale_id,actor_type,actor_id,action,detail) VALUES(?,?,?,?,?)')
    .run(id, actorType, actorId, action, detail);
}

function detail(id, userId) {
  const params = [id];
  let where = 'a.id=?';
  if (userId) { where += ' AND a.user_id=?'; params.push(userId); }
  const item = db.prepare(`SELECT ${publicColumns} FROM after_sales a JOIN orders o ON o.id=a.order_id WHERE ${where}`).get(...params);
  if (!item) fail('售后申请不存在', 404);
  item.refund = db.prepare('SELECT amount,channel,external_reference,note,created_at FROM refund_records WHERE after_sale_id=?').get(id) || null;
  item.audit = db.prepare("SELECT actor_type,action,detail,created_at FROM after_sale_audit WHERE after_sale_id=? ORDER BY id").all(id);
  return item;
}

const create = db.transaction((userId, input) => {
  const orderId = validate.id(input.order_id, '订单');
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(orderId, userId);
  if (!order) fail('订单不存在', 404);
  if (!['paid','shipped','completed'].includes(order.status) || !paymentVerified(order)) fail('只有已核实付款的订单可以申请售后', 409);
  if (db.prepare(`SELECT id FROM after_sales WHERE order_id=? AND status IN (${activeStatuses.map(()=>'?').join(',')})`).get(orderId, ...activeStatuses)) fail('该订单已有处理中售后申请', 409);
  const remaining = Math.max(0, cents(order.total_amount) - cents(order.refunded_amount || 0));
  const requested = cents(input.requested_amount);
  if (requested < 1 || requested > remaining) fail('申请金额超过订单可售后金额');
  const type = validate.oneOf(input.type, ['refund','return_refund','exchange'], '售后类型');
  if (type === 'exchange' && requested !== cents(order.total_amount)) fail('换货申请金额应填写订单实付总额');
  const reason = validate.text(input.reason, '售后原因', { max: 100 });
  const description = validate.optionalText(input.description, '问题说明', 1000);
  const requestNo = 'AS' + Date.now() + crypto.randomBytes(5).toString('hex');
  const result = db.prepare('INSERT INTO after_sales(request_no,order_id,user_id,type,reason,description,requested_amount) VALUES(?,?,?,?,?,?,?)')
    .run(requestNo, orderId, userId, type, reason, description, requested / 100);
  audit(result.lastInsertRowid, 'user', userId, 'created', reason);
  return detail(result.lastInsertRowid, userId);
});

const cancel = db.transaction((id, userId) => {
  id = validate.id(id, '售后申请');
  const changed = db.prepare("UPDATE after_sales SET status='cancelled',updated_at=datetime('now','localtime') WHERE id=? AND user_id=? AND status='pending'").run(id, userId);
  if (!changed.changes) fail('仅待审核的售后申请可以撤销', 409);
  audit(id, 'user', userId, 'cancelled');
  return detail(id, userId);
});

const shipment = db.transaction((id, userId, input) => {
  id = validate.id(id, '售后申请');
  const company = validate.text(input.tracking_company, '退货物流公司', { max: 60 });
  const number = validate.text(input.tracking_no, '退货物流单号', { max: 100 });
  const changed = db.prepare("UPDATE after_sales SET status='returning',return_tracking_company=?,return_tracking_no=?,updated_at=datetime('now','localtime') WHERE id=? AND user_id=? AND status IN ('approved','returning') AND type IN ('return_refund','exchange')")
    .run(company, number, id, userId);
  if (!changed.changes) fail('当前售后状态不能填写退货物流', 409);
  audit(id, 'user', userId, 'return_shipped', `${company} ${number}`);
  return detail(id, userId);
});

const update = db.transaction((id, adminId, input) => {
  id = validate.id(id, '售后申请');
  const current = db.prepare('SELECT * FROM after_sales WHERE id=?').get(id);
  if (!current) fail('售后申请不存在', 404);
  const next = validate.oneOf(input.status, ['approved','rejected','refund_pending','completed'], '售后状态');
  const note = validate.text(input.admin_note, '处理说明', { max: 1000 });
  const allowed = (current.status === 'pending' && ['approved','rejected'].includes(next))
    || (['approved','returning'].includes(current.status) && next === 'refund_pending' && current.type !== 'exchange')
    || (['approved','returning'].includes(current.status) && next === 'completed' && current.type === 'exchange');
  if (!allowed) fail('不允许进行该售后状态变更', 409);
  db.prepare("UPDATE after_sales SET status=?,admin_note=?,updated_at=datetime('now','localtime'),completed_at=CASE WHEN ?='completed' THEN datetime('now','localtime') ELSE completed_at END WHERE id=?")
    .run(next, note, next, id);
  audit(id, 'admin', adminId, next, note);
  return detail(id);
});

const recordRefund = db.transaction((id, adminId, input) => {
  id = validate.id(id, '售后申请');
  const current = db.prepare(`SELECT a.*,o.payment_method,o.total_amount,o.refunded_amount FROM after_sales a JOIN orders o ON o.id=a.order_id WHERE a.id=?`).get(id);
  if (!current) fail('售后申请不存在', 404);
  if (current.type === 'exchange' || !['approved','returning','refund_pending'].includes(current.status)) fail('当前售后不能登记退款', 409);
  const amount = cents(input.amount);
  if (amount < 1 || amount > cents(current.requested_amount)) fail('退款金额超过申请金额');
  if (cents(current.refunded_amount || 0) + amount > cents(current.total_amount)) fail('累计退款金额超过订单实付金额');
  const reference = validate.text(input.external_reference, '支付平台退款流水号', { max: 120 });
  const note = validate.optionalText(input.note, '退款说明', 500);
  const channel = current.payment_method || 'manual';
  try {
    db.prepare('INSERT INTO refund_records(after_sale_id,order_id,amount,channel,external_reference,handled_by,note) VALUES(?,?,?,?,?,?,?)')
      .run(id, current.order_id, amount / 100, channel, reference, adminId, note);
  } catch (error) {
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) fail('该退款申请或平台流水号已登记', 409);
    throw error;
  }
  db.prepare('UPDATE orders SET refunded_amount=refunded_amount+? WHERE id=?').run(amount / 100, current.order_id);
  db.prepare("UPDATE after_sales SET status='completed',admin_note=?,updated_at=datetime('now','localtime'),completed_at=datetime('now','localtime') WHERE id=?").run(note, id);
  audit(id, 'admin', adminId, 'refund_recorded', `${channel} ${reference} ¥${(amount/100).toFixed(2)}`);
  return detail(id);
});

module.exports = { create, cancel, shipment, update, recordRefund, detail, activeStatuses };
