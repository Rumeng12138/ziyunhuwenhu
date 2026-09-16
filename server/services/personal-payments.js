const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/db');
const {uploadDir}=require('../config/storage');
const {fail,cents,releaseOrder,orderDetail} = require('./commerce');
const names = {alipay_personal:'普通支付宝',wechat_personal:'普通微信'};
const isPersonal = method => Object.hasOwn(names,method);
function qrExists(url) {
  return typeof url === 'string' && /^\/uploads\/personal-[a-z0-9-]+\.(png|jpg)$/.test(url)
    && fs.existsSync(path.join(uploadDir,path.basename(url)));
}
function settings() {
  return db.prepare('SELECT * FROM personal_payment_settings ORDER BY channel').all().map(row=>({...row,enabled:!!row.enabled,configured:qrExists(row.qr_url)}));
}
function methods() { return settings().map(row=>({id:row.channel,name:names[row.channel],mode:'manual',enabled:row.enabled && row.configured})); }
function start(order) {
  let receipt;
  if (order.manual_receipt) receipt = JSON.parse(order.manual_receipt);
  else {
    const config = settings().find(row=>row.channel===order.payment_method);
    if (!config?.enabled || !config.configured) fail('此普通收款渠道尚未启用',503);
    receipt = {qrUrl:config.qr_url,recipient:config.recipient,instructions:config.instructions};
    db.prepare('UPDATE orders SET manual_receipt=? WHERE id=? AND manual_receipt IS NULL').run(JSON.stringify(receipt),order.id);
  }
  if (!qrExists(receipt.qrUrl)) fail('订单收款码暂不可用，请联系商家，不要向其他账户付款',503);
  return {mode:'manual',...receipt,amount:order.total_amount,message:'请核对收款人和金额，付款备注订单号。提交转账信息仅表示申请核实，不代表已到账。'};
}
function shortText(value,max,label,required=false) {
  if (typeof value !== 'string' || value.trim().length>max || (required && !value.trim())) fail(label+'填写不正确');
  return value.trim();
}
const claim = db.transaction((id,userId,input)=>{
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id,userId);
  if (!order) fail('订单不存在',404);
  if (!isPersonal(order.payment_method) || !order.manual_receipt) fail('此订单不是普通收款码订单');
  if (order.status==='payment_review') return orderDetail(order);
  if (order.status!=='pending') fail('此订单不能提交转账信息',409);
  const reference=shortText(input.reference,100,'付款账单流水号',true);
  const note=shortText(input.note||'',300,'说明');
  db.prepare("UPDATE orders SET status='payment_review',manual_claim_reference=?,manual_claim_note=?,manual_review_note=NULL WHERE id=? AND status='pending'").run(reference,note,id);
  return orderDetail(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
});
const review = db.transaction((id,adminId,input)=>{
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) fail('订单不存在',404);
  if (!isPersonal(order.payment_method) || !order.manual_receipt) fail('仅普通收款订单可以人工核实');
  const decision=input.decision;
  if (!['confirm','reject','cancel'].includes(decision)) fail('核实操作无效');
  if (input.verified!==true) fail('请先在支付宝或微信账单中核实实际到账情况');
  const note=shortText(input.note||'',300,'核实说明',decision!=='confirm');
  if (decision==='confirm') {
    const reference=shortText(input.reference,100,'实际收款流水号',true);
    const amount=cents(input.amount);
    if (amount!==cents(order.total_amount)) fail('实收金额与订单应付金额不一致');
    if (order.manual_confirmed_at && ['paid','shipped','completed'].includes(order.status)) {
      if (reference!==order.manual_transaction_reference) fail('此订单已使用其他流水核实',409);
      return orderDetail(order);
    }
    if (!['pending','payment_review'].includes(order.status)) fail('当前状态不可确认到账',409);
    if (db.prepare('SELECT id FROM orders WHERE payment_method=? AND manual_transaction_reference=? AND id<>?').get(order.payment_method,reference,id)) fail('该收款流水已用于其他订单',409);
    db.prepare("UPDATE orders SET status='paid',paid_at=datetime('now','localtime'),manual_confirmed_at=datetime('now','localtime'),manual_confirmed_by=?,manual_transaction_reference=?,manual_review_note=? WHERE id=?").run(adminId,reference,note,id);
    db.prepare('INSERT INTO manual_payment_audit(order_id,admin_id,decision,reference,amount_cents,note) VALUES(?,?,?,?,?,?)').run(id,adminId,decision,reference,amount,note);
  } else {
    if (!['pending','payment_review'].includes(order.status)) fail('当前状态不可退回或取消',409);
    if (decision==='reject' && order.status!=='payment_review') fail('只有待核实订单可以退回',409);
    db.prepare("UPDATE orders SET status='pending',manual_review_note=? WHERE id=?").run(note,id);
    if (decision==='cancel') releaseOrder(id);
    db.prepare('INSERT INTO manual_payment_audit(order_id,admin_id,decision,note) VALUES(?,?,?,?)').run(id,adminId,decision,note);
  }
  return orderDetail(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
});
module.exports = {names,isPersonal,qrExists,settings,methods,start,claim,review,shortText};
