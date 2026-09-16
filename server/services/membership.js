const db = require('../config/db');
const { fail, cents } = require('./commerce');

const levels = Object.freeze([
  { level: 0, name: '普通会员', minSpent: 0, discount: 1, pointsRate: 1 },
  { level: 1, name: '银卡会员', minSpent: 500, discount: 0.98, pointsRate: 1.2 },
  { level: 2, name: '金卡会员', minSpent: 2000, discount: 0.95, pointsRate: 1.5 },
  { level: 3, name: '钻石会员', minSpent: 5000, discount: 0.9, pointsRate: 2 },
]);
const settings = () => db.prepare('SELECT membership_enabled, checkin_enabled, revision FROM member_settings WHERE id=1').get();
function features() {
  const value = settings();
  return { membership_enabled: !!value.membership_enabled, checkin_enabled: !!value.checkin_enabled, revision: value.revision };
}
const save = db.transaction(input => {
  if (typeof input.membership_enabled !== 'boolean' || typeof input.checkin_enabled !== 'boolean'
      || !Number.isSafeInteger(input.revision) || input.revision < 0) fail('请提交有效的会员、签到开关和配置版本');
  const changed = db.prepare('UPDATE member_settings SET membership_enabled=?,checkin_enabled=?,revision=revision+1 WHERE id=1 AND revision=?')
    .run(Number(input.membership_enabled), Number(input.checkin_enabled), input.revision);
  if (!changed.changes) fail('设置已被其他管理员更新，请刷新后重试', 409);
  return features();
});
function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function info(userId) {
  const user = db.prepare('SELECT member_level,points,total_spent FROM users WHERE id=?').get(userId);
  if (!user) fail('用户不存在', 404);
  const enabled = features();
  const current = levels.find(level => level.level === user.member_level) || levels[0];
  return { ...enabled, current: enabled.membership_enabled ? current : null,
    next: enabled.membership_enabled ? levels[current.level + 1] || null : null,
    levels: enabled.membership_enabled ? levels : [], points: user.points, totalSpent: user.total_spent,
    todaySigned: !!db.prepare('SELECT 1 FROM member_checkins WHERE user_id=? AND business_date=?').get(userId, businessDate()),
    checkinPoints: 10, businessDate: businessDate() };
}
const checkin = db.transaction(userId => {
  if (!features().checkin_enabled) fail('每日签到已关闭', 403);
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) fail('用户不存在', 404);
  const date = businessDate();
  const inserted = db.prepare('INSERT OR IGNORE INTO member_checkins(user_id,business_date,points) VALUES(?,?,10)').run(userId, date);
  if (inserted.changes) {
    db.prepare('UPDATE users SET points=points+10 WHERE id=?').run(userId);
    db.prepare("INSERT INTO points_ledger(user_id,event_key,delta,reason) VALUES(?,?,10,'checkin')").run(userId, 'checkin:' + date);
  }
  return { pointsEarned: inserted.changes ? 10 : 0, alreadySigned: !inserted.changes, ...info(userId) };
});
function pricingBenefit(userId) {
  const enabled = features().membership_enabled;
  const user = db.prepare('SELECT member_level FROM users WHERE id=?').get(userId);
  const current = levels.find(level => level.level === user?.member_level) || levels[0];
  return { membership_enabled: enabled, member_level: enabled ? current.level : null,
    member_discount: enabled ? current.discount : 1, points_rate: enabled ? current.pointsRate : 0 };
}
// Caller runs this within the order-confirmation transaction. Snapshots preserve
// promised benefits when the administrator changes the switch after checkout.
function awardOrder(order) {
  let snapshot = null;
  try { snapshot = JSON.parse(order.pricing_snapshot); } catch {}
  const rate = snapshot && typeof snapshot.points_rate === 'number' ? snapshot.points_rate : 1;
  if (rate <= 0) return 0;
  const points = Math.floor(cents(order.total_amount) * Math.round(rate * 100) / 10000);
  const inserted = db.prepare("INSERT OR IGNORE INTO points_ledger(user_id,event_key,delta,reason) VALUES(?,?,?,'order')")
    .run(order.user_id, 'order:' + order.id, points);
  if (!inserted.changes) return 0;
  db.prepare('UPDATE users SET points=points+?,total_spent=total_spent+? WHERE id=?').run(points, order.total_amount, order.user_id);
  const user = db.prepare('SELECT total_spent FROM users WHERE id=?').get(order.user_id);
  const level = [...levels].reverse().find(value => user.total_spent >= value.minSpent).level;
  db.prepare('UPDATE users SET member_level=MAX(member_level,?) WHERE id=?').run(level, order.user_id);
  return points;
}
module.exports = { features, save, info, checkin, pricingBenefit, awardOrder, businessDate, levels };
