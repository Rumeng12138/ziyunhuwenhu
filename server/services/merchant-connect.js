const crypto = require('node:crypto');
const QRCode = require('qrcode');
const db = require('../config/db');
const { encrypt, decrypt } = require('./payment-settings');
const { fail } = require('./commerce');
const { activeBinding, publicBinding } = require('./merchant-bindings');
const adapters = require('./merchant-connect-adapters');
const SESSION_TTL = 10 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function createMerchantConnect(getAdapter = channel => channel === 'alipay' ? adapters.createAlipayConnector() : adapters.createWechatConnector(), onBound = () => require('./payments').reloadProviders()) {
  function adapter(channel) {
    if (!['alipay','wechat'].includes(channel)) fail('不支持的商户授权渠道');
    return getAdapter(channel);
  }
  function session(id, adminId) {
    const row = db.prepare('SELECT * FROM merchant_auth_sessions WHERE id = ? AND admin_id = ?').get(id,adminId);
    if (!row) fail('授权会话不存在',404);
    if (row.expires_at <= Date.now() && !['confirmed','failed','expired'].includes(row.status)) {
      db.prepare("UPDATE merchant_auth_sessions SET status='expired',payload=NULL WHERE id=?").run(id);
      row.status = 'expired'; row.payload = null;
    }
    return row;
  }
  function publicSession(row) {
    return { id:row.id,channel:row.channel,status:row.status,merchantId:row.merchant_id,
      expiresAt:row.expires_at,bindingId:row.binding_id,message:row.failure || undefined };
  }
  function authorize(id, result) {
    const changed = db.prepare("UPDATE merchant_auth_sessions SET status='authorized',merchant_id=?,payload=? WHERE id=? AND status IN ('pending','exchanging') AND expires_at>?")
      .run(result.merchantId,encrypt({grant:result}),id,Date.now());
    if (!changed.changes) fail('授权会话已失效，请重新发起',409);
  }
  return {
    capabilities() {
      return ['alipay','wechat'].map(channel => {
        const connector = adapter(channel);
        return { channel,ready:connector.ready,kind:connector.kind,missing:connector.missing,invalid:connector.invalid,
          binding:publicBinding(activeBinding(channel)),
          message: channel === 'alipay' ? '第三方应用授权，需服务商开通当面付代调用权限' : '微信服务商进件签约，需服务商已有的进件申请单号；不是普通微信登录' };
      });
    },
    async start(channel, adminId, input = {}) {
      const connector = adapter(channel);
      if (!connector.ready) fail('服务商尚未配置，暂不能生成真实授权二维码',503);
      db.prepare("UPDATE merchant_auth_sessions SET status='expired',payload=NULL WHERE expires_at<=? AND status!='confirmed'").run(Date.now());
      const recent = db.prepare('SELECT COUNT(*) n FROM merchant_auth_sessions WHERE admin_id=? AND created_at>?').get(adminId,Date.now()-60000).n;
      if (recent >= 5) fail('发起授权过于频繁，请一分钟后重试',429);
      const id = crypto.randomUUID(), state = crypto.randomBytes(32).toString('base64url'), now = Date.now();
      const result = await connector.start(state,input);
      db.prepare("INSERT INTO merchant_auth_sessions(id,channel,admin_id,state_hash,payload,expires_at,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id,channel,adminId,hash(state),encrypt({context:result.context || {},operatorId:connector.operatorId}),now+SESSION_TTL,now);
      if (result.grant) authorize(id,result.grant);
      return { ...publicSession(session(id,adminId)), authorizationUrl:result.authorizationUrl,
        qrCode:result.authorizationUrl ? await QRCode.toDataURL(result.authorizationUrl,{width:256,margin:2}) : undefined,
        message:result.message };
    },
    async callback(state, code) {
      if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state) || typeof code !== 'string' || code.length < 8 || code.length > 2048) fail('授权回调参数无效');
      const row = db.prepare("SELECT * FROM merchant_auth_sessions WHERE state_hash=? AND channel='alipay'").get(hash(state));
      if (!row) fail('未知授权会话',400);
      const claimed = db.prepare("UPDATE merchant_auth_sessions SET status='exchanging' WHERE id=? AND status='pending' AND expires_at>?").run(row.id,Date.now());
      if (!claimed.changes) fail('授权会话已使用或已过期，请返回后台查看',409);
      try {
        const connector = adapter('alipay');
        if (connector.operatorId !== decrypt(row.payload).operatorId) fail('服务商应用已变更，请重新授权',409);
        const grant = await connector.exchange(code);
        authorize(row.id,grant);
      } catch {
        // Codes are one-use and an exchange timeout is ambiguous. Never retry or leak a provider error/token.
        db.prepare("UPDATE merchant_auth_sessions SET status='failed',payload=NULL,failure='平台授权未完成，请重新发起授权' WHERE id=?").run(row.id);
        fail('平台授权未完成，请返回后台重新发起',502);
      }
      return { status:'authorized',message:'授权已返回，请回到商城管理后台核对商户身份并确认绑定。此页面不会自动启用收款。' };
    },
    async status(id, adminId) {
      let row = session(id,adminId);
      let latest = {};
      if (row.channel === 'wechat' && row.status === 'pending') {
        const connector = adapter('wechat'), stored = decrypt(row.payload);
        if (connector.operatorId !== stored.operatorId) fail('服务商已变更，请重新发起',409);
        latest = await connector.poll(stored.context);
        if (latest.grant) authorize(id,latest.grant);
        row = session(id,adminId);
      }
      return { ...publicSession(row),authorizationUrl:latest.authorizationUrl,
        qrCode:latest.authorizationUrl ? await QRCode.toDataURL(latest.authorizationUrl,{width:256,margin:2}) : undefined,
        message:latest.message || row.failure || undefined };
    },
    confirm(id, adminId, expectedMerchantId) {
      const bind = db.transaction(() => {
        const row = session(id,adminId);
        if (row.status === 'confirmed') {
          const binding = activeBinding(row.channel);
          if (binding?.id === row.binding_id && binding.merchant_id === expectedMerchantId) return publicBinding(binding);
          fail('该授权不再是当前绑定，请刷新',409);
        }
        if (row.status !== 'authorized') fail('尚未获得有效商户授权',409);
        if (typeof expectedMerchantId !== 'string' || expectedMerchantId !== row.merchant_id) fail('请核对并确认实际授权的商户号');
        const grant = decrypt(row.payload).grant, connector = adapter(row.channel);
        if (!connector.ready || connector.operatorId !== grant.operatorId) fail('服务商配置已变更，请重新授权',409);
        if (grant.expiresAt && grant.expiresAt <= Date.now()) fail('商户授权已过期',409);
        const current = activeBinding(row.channel);
        const previous = current ? decrypt(current.payload) : null;
        // Renewing the same merchant/operator is safe and must remain possible when an expired token blocks pending orders.
        const sameMerchant = current?.merchant_id === row.merchant_id && previous?.operatorId === grant.operatorId
          && previous?.authAppId === grant.authAppId;
        if (!sameMerchant && db.prepare("SELECT id FROM orders WHERE payment_method=? AND status='pending' LIMIT 1").get(row.channel)) fail('原渠道仍有待支付订单，请先处理再变更绑定',409);
        const bindingId = crypto.randomUUID();
        db.prepare('UPDATE merchant_bindings SET active=0 WHERE channel=? AND active=1').run(row.channel);
        db.prepare('INSERT INTO merchant_bindings(id,channel,merchant_id,payload,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
          .run(bindingId,row.channel,row.merchant_id,encrypt(grant),adminId,Date.now(),grant.expiresAt || null);
        db.prepare("UPDATE merchant_auth_sessions SET status='confirmed',payload=NULL,binding_id=? WHERE id=?").run(bindingId,id);
        return publicBinding(activeBinding(row.channel));
      });
      const result = bind.immediate();
      onBound();
      return result;
    },
  };
}
module.exports = createMerchantConnect();
module.exports.createMerchantConnect = createMerchantConnect;
