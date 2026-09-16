const fs = require('node:fs');
const path = require('node:path');
// Private configuration remains untouched. Environment variables take priority.
let legacy = {};
try { legacy = require('./payment.config'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const { readSettings } = require('../services/payment-settings');
function pem(name, fallback) {
  const file = process.env[name + '_PATH'];
  return file ? fs.readFileSync(path.resolve(file), 'utf8') : (process.env[name] || fallback || '').replace(/\\n/g, '\n').trim();
}
function valid(...values) { return values.every(v => typeof v === 'string' && v.trim() && !/你的|请填|your[-_ ]|示例|example\.com/i.test(v)); }
function httpsUrl(value) { try { return new URL(value).protocol === 'https:' && valid(value); } catch { return false; } }
module.exports = {
  valid, httpsUrl,
  get alipay() {
    const bound = require('../services/merchant-bindings').paymentConfig('alipay');
    if (bound) return bound;
    const a = { ...legacy.alipay, ...readSettings().alipay };
    return {
    appId: process.env.ALIPAY_APP_ID || a.appId, sellerId: process.env.ALIPAY_SELLER_ID || a.sellerId,
    privateKey: pem('ALIPAY_PRIVATE_KEY', a.privateKey), alipayPublicKey: pem('ALIPAY_PUBLIC_KEY', a.alipayPublicKey),
    keyType: process.env.ALIPAY_KEY_TYPE || a.keyType || 'PKCS8',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || a.notifyUrl, returnUrl: process.env.ALIPAY_RETURN_URL || a.returnUrl,
    enabled: a.enabled !== false,
  }; },
  get wechat() {
    const bound = require('../services/merchant-bindings').paymentConfig('wechat');
    if (bound) return bound;
    const w = { ...legacy.wechat, ...readSettings().wechat };
    return {
    appid: process.env.WECHAT_APP_ID || w.appid, mchid: process.env.WECHAT_MCH_ID || w.mchid,
    apiV3Key: process.env.WECHAT_API_V3_KEY || w.apiV3Key,
    merchantSerialNumber: process.env.WECHAT_MERCHANT_SERIAL || w.merchantSerialNumber,
    privateKey: pem('WECHAT_PRIVATE_KEY', w.privateKey), platformPublicKey: pem('WECHAT_PLATFORM_PUBLIC_KEY', w.platformPublicKey),
    platformSerial: process.env.WECHAT_PLATFORM_SERIAL || w.platformSerial, notifyUrl: process.env.WECHAT_NOTIFY_URL || w.notifyUrl,
    enabled: w.enabled !== false,
  }; },
};
