const db = require('../config/db');
const { decrypt } = require('./payment-settings');
function activeBinding(channel) { return db.prepare('SELECT * FROM merchant_bindings WHERE channel = ? AND active = 1').get(channel); }
function publicBinding(binding) {
  if (!binding) return null;
  return { id: binding.id, channel: binding.channel, merchantId: binding.merchant_id,
    boundAt: binding.created_at, expiresAt: binding.expires_at,
    status: binding.expires_at && binding.expires_at <= Date.now() ? 'expired' : 'bound' };
}
function paymentConfig(channel) {
  const binding = activeBinding(channel);
  if (!binding) return null;
  const payload = decrypt(binding.payload);
  const operator = require('../config/merchant-connect')[channel]();
  // Do not silently apply an existing grant to a different service-provider application.
  const currentId = channel === 'alipay' ? operator.appId : operator.mchid;
  const enabled = currentId === payload.operatorId && (!binding.expires_at || binding.expires_at > Date.now());
  if (channel === 'alipay') return { ...operator, enabled, bindingId: binding.id,
    sellerId: binding.merchant_id, authAppId: payload.authAppId, appAuthToken: payload.appAuthToken,
    authorizationExpiresAt: binding.expires_at };
  return { ...operator, enabled, bindingId: binding.id, subMchid: binding.merchant_id };
}
module.exports = { activeBinding, publicBinding, paymentConfig };
