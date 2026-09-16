const fs = require('node:fs');
const crypto = require('node:crypto');
// These are the operator's approved service-provider credentials, configured once.
// They are not the merchant's ordinary Alipay/WeChat login credentials.
function key(name) {
  const file = process.env[name + '_PATH'];
  return file ? fs.readFileSync(file, 'utf8') : (process.env[name] || '').replace(/\\n/g, '\n');
}
function alipay() {
  return {
    appId: process.env.PAYCONNECT_ALIPAY_APP_ID || '',
    privateKey: key('PAYCONNECT_ALIPAY_PRIVATE_KEY'),
    alipayPublicKey: key('PAYCONNECT_ALIPAY_PUBLIC_KEY'),
    keyType: process.env.PAYCONNECT_ALIPAY_KEY_TYPE || 'PKCS8',
    callbackUrl: process.env.PAYCONNECT_ALIPAY_CALLBACK_URL || '',
    notifyUrl: process.env.PAYCONNECT_ALIPAY_NOTIFY_URL || '',
    returnUrl: process.env.PAYCONNECT_ALIPAY_RETURN_URL || '',
  };
}
function wechat() {
  return {
    appid: process.env.PAYCONNECT_WECHAT_APP_ID || '',
    mchid: process.env.PAYCONNECT_WECHAT_MCH_ID || '',
    privateKey: key('PAYCONNECT_WECHAT_PRIVATE_KEY'),
    platformPublicKey: key('PAYCONNECT_WECHAT_PLATFORM_PUBLIC_KEY'),
    merchantSerialNumber: process.env.PAYCONNECT_WECHAT_MERCHANT_SERIAL || '',
    platformSerial: process.env.PAYCONNECT_WECHAT_PLATFORM_SERIAL || '',
    apiV3Key: process.env.PAYCONNECT_WECHAT_API_V3_KEY || '',
    notifyUrl: process.env.PAYCONNECT_WECHAT_NOTIFY_URL || '',
  };
}
function readiness(channel, config) {
  const required = channel === 'alipay'
    ? ['appId','privateKey','alipayPublicKey','callbackUrl','notifyUrl','returnUrl']
    : ['appid','mchid','privateKey','platformPublicKey','merchantSerialNumber','platformSerial','apiV3Key','notifyUrl'];
  const missing = required.filter(name => !config[name]);
  const invalid = [];
  for (const field of required.filter(name => name.endsWith('Url'))) {
    try { const url = new URL(config[field]); if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) invalid.push(field); }
    catch { if (config[field]) invalid.push(field); }
  }
  for (const field of ['privateKey',channel === 'alipay' ? 'alipayPublicKey' : 'platformPublicKey']) {
    if (!config[field]) continue;
    try { const parsed = (field === 'privateKey' ? crypto.createPrivateKey : crypto.createPublicKey)(config[field]); if (parsed.asymmetricKeyType !== 'rsa' || parsed.asymmetricKeyDetails.modulusLength < 2048) invalid.push(field); }
    catch { invalid.push(field); }
  }
  if (channel === 'wechat' && config.apiV3Key && Buffer.byteLength(config.apiV3Key) !== 32) invalid.push('apiV3Key');
  return { ready: !missing.length && !invalid.length, missing, invalid };
}
module.exports = { alipay, wechat, readiness };
