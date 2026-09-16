const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../config/db');
const { adminRequired } = require('../middleware/admin');
const { fail } = require('../services/commerce');
const settings = require('../services/payment-settings');
const config = require('../config/payment-runtime');
const { providers } = require('../services/payments');
const { createAlipay } = require('../services/alipay-live');
const { createWechat } = require('../services/wechat-live');
const router = express.Router();
router.use(adminRequired, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fields = {
  alipay: ['appId', 'sellerId', 'privateKey', 'alipayPublicKey', 'keyType', 'notifyUrl', 'returnUrl'],
  wechat: ['appid', 'mchid', 'apiV3Key', 'merchantSerialNumber', 'privateKey', 'platformPublicKey', 'platformSerial', 'notifyUrl'],
};
const secrets = new Set(['privateKey', 'alipayPublicKey', 'apiV3Key', 'platformPublicKey']);
const { activeBinding } = require('../services/merchant-bindings');
function reauthenticate(req) {
  const admin = db.prepare('SELECT password FROM users WHERE id = ?').get(req.admin.id);
  if (typeof req.body.admin_password !== 'string' || !bcrypt.compareSync(req.body.admin_password, admin.password)) fail('请输入当前管理员密码确认操作', 403);
  return admin;
}
router.get('/', (req, res) => {
  const data = {};
  for (const channel of Object.keys(fields)) {
    const current = config[channel];
    data[channel] = { enabled: current.enabled, configured: providers[channel].isReady, fields: {}, secretSet: {}, authorizationManaged:!!activeBinding(channel), environmentManaged: Object.keys(process.env).some(name => name.startsWith(channel === 'alipay' ? 'ALIPAY_' : 'WECHAT_')) };
    for (const field of fields[channel]) {
      if (secrets.has(field)) {
        try {
          if (field === 'apiV3Key') data[channel].secretSet[field] = config.valid(current[field]) && Buffer.byteLength(current[field]) === 32;
          else { (field === 'privateKey' ? crypto.createPrivateKey : crypto.createPublicKey)(current[field] || ''); data[channel].secretSet[field] = true; }
        } catch { data[channel].secretSet[field] = false; }
      }
      else data[channel].fields[field] = config.valid(current[field]) ? current[field] : '';
    }
  }
  data.bank = { mode: 'provider_settlement', message: '结算银行卡需在支付宝/微信商户平台完成绑定和验证。本网站不收集完整卡号或CVV。' };
  data.updatedAt = db.prepare('SELECT updated_at FROM payment_settings WHERE id=1').get()?.updated_at || null;
  res.json({ code: 200, data });
});
router.put('/password', (req, res) => {
  reauthenticate(req);
  const password = req.body.new_password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 72 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) fail('新密码须为12至72位，包含字母和数字');
  db.prepare('UPDATE users SET password = ?,session_version=session_version+1 WHERE id = ?').run(bcrypt.hashSync(password, 12), req.admin.id);
  res.json({ code: 200, message: '管理员密码已更新，请重新登录', data:{reauthenticate:true} });
});
router.put('/:channel', (req, res) => {
  const admin = reauthenticate(req);
  if (bcrypt.compareSync('admin123', admin.password)) fail('请先修改默认管理员密码，再绑定收款商户', 403);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('ziyunhu_wenfang_secret')) fail('请先在服务器设置至少32位的随机 JWT_SECRET，再绑定真实收款商户', 403);
  const channel = req.params.channel;
  if (!fields[channel]) fail('不支持此收款渠道');
  if (activeBinding(channel)) fail('此渠道由扫码授权管理，请使用重新授权流程，不能用手动配置覆盖',409);
  if (Object.keys(process.env).some(name => name.startsWith(channel === 'alipay' ? 'ALIPAY_' : 'WECHAT_'))) fail('此渠道由服务器环境变量管理，请在服务器修改，避免覆盖冲突', 409);
  if (db.prepare("SELECT id FROM orders WHERE status='pending' AND payment_method=? LIMIT 1").get(channel)) fail('此渠道仍有待支付订单，请先核实或取消这些订单再变更配置', 409);
  const input = req.body.settings;
  if (!input || typeof input.enabled !== 'boolean') fail('收款配置无效');
  const all = settings.readSettings();
  const next = { ...config[channel], enabled: input.enabled };
  for (const field of fields[channel]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].length > 12000) fail('配置字段格式错误');
      // An empty secret means keep existing; secrets are never sent back to the browser.
      if (!secrets.has(field) || input[field].trim()) next[field] = input[field].trim().replace(/\\n/g, '\n');
    }
  }
  if (next.enabled) {
    if (!fields[channel].every(field => config.valid(next[field]))) fail('请填写完整商户信息和密钥');
    if (!config.httpsUrl(next.notifyUrl) || (channel === 'alipay' && !config.httpsUrl(next.returnUrl))) fail('回调和返回地址必须是公网 HTTPS 地址');
    try {
      const privateKey = crypto.createPrivateKey(next.privateKey);
      const publicKey = crypto.createPublicKey(channel === 'alipay' ? next.alipayPublicKey : next.platformPublicKey);
      if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048 || publicKey.asymmetricKeyDetails.modulusLength < 2048) fail('请使用至少2048位的RSA密钥');
    } catch { fail('密钥格式无效，请粘贴完整的RSA PEM密钥（包含BEGIN/END行）'); }
    if (channel === 'wechat' && Buffer.byteLength(next.apiV3Key) !== 32) fail('API v3密钥必须是32字节');
    if (channel === 'alipay' && !['PKCS1', 'PKCS8'].includes(next.keyType)) fail('请选择正确的私钥格式');
  }
  const provider = channel === 'alipay' ? createAlipay(next) : createWechat(next);
  all[channel] = next;
  settings.saveSettings(all, req.admin.id);
  Object.assign(providers[channel], provider);
  res.json({ code: 200, message: '配置已加密保存。仅完成本地格式检查，商户开通状态与实际到账仍需在官方平台核实。' });
});
module.exports = router;
