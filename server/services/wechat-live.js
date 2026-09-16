const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { wechat: config, valid, httpsUrl } = require('../config/payment-runtime');
const { fail } = require('./commerce');
function createWechat(settings = config, request = fetch) {
  const isReady = settings.enabled !== false && valid(settings.appid, settings.mchid, settings.privateKey, settings.platformPublicKey,
    settings.merchantSerialNumber, settings.platformSerial, settings.apiV3Key)
    && Buffer.byteLength(settings.apiV3Key) === 32 && httpsUrl(settings.notifyUrl);
  function verify(headers, body) {
    if (!isReady) fail('微信支付商户未配置', 503);
    const get = key => headers.get ? headers.get(key) : headers[key];
    const timestamp = get('wechatpay-timestamp'), nonce = get('wechatpay-nonce');
    if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !nonce
      || get('wechatpay-serial') !== settings.platformSerial) fail('微信支付签名时间或公钥标识无效');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), settings.platformPublicKey, Buffer.from(get('wechatpay-signature') || '', 'base64'))) fail('微信支付签名无效');
  }
  async function api(method, uri, data) {
    if (!isReady) fail('微信支付商户未配置，暂不可付款', 503);
    const body = data ? JSON.stringify(data) : '';
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${method}\n${uri}\n${timestamp}\n${nonce}\n${body}\n`), settings.privateKey).toString('base64');
    const response = await request('https://api.mch.weixin.qq.com' + uri, {
      method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Wechatpay-Serial': settings.platformSerial,
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${settings.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${settings.merchantSerialNumber}",signature="${signature}"` },
      body: body || undefined, signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    verify(response.headers, raw);
    const result = raw ? JSON.parse(raw) : {};
    if (!response.ok) { const error = new Error('微信支付请求未完成，请稍后重试'); error.status = 502; error.providerCode = result.code; throw error; }
    return result;
  }
  function payment(result) {
    const matchesMerchant = settings.subMchid
      ? result.sp_appid === settings.appid && result.sp_mchid === settings.mchid && result.sub_mchid === settings.subMchid
      : result.appid === settings.appid && result.mchid === settings.mchid;
    if (!matchesMerchant || result.amount?.currency !== 'CNY'
      || !Number.isSafeInteger(result.amount.total)) fail('微信支付商户或币种无效');
    return { orderNo: result.out_trade_no, amountCents: result.amount.total, transactionId: result.transaction_id };
  }
  return {
    isReady,
    requestApi:api,
    async create(order) {
      const merchant = settings.subMchid ? {sp_appid:settings.appid,sp_mchid:settings.mchid,sub_mchid:settings.subMchid} : {appid:settings.appid,mchid:settings.mchid};
      const result = await api('POST', settings.subMchid ? '/v3/pay/partner/transactions/native' : '/v3/pay/transactions/native', {
        ...merchant, description: '紫云湖文房商城订单', out_trade_no: order.order_no,
        notify_url: settings.notifyUrl, amount: { total: Math.round(order.total_amount * 100), currency: 'CNY' },
      });
      if (!result.code_url?.startsWith('weixin://wxpay/')) fail('微信支付未返回有效付款码', 502);
      return { qrCode: await QRCode.toDataURL(result.code_url, { width: 256, margin: 2 }) };
    },
    verifyNotify(headers, raw) {
      verify(headers, raw);
      const envelope = JSON.parse(raw);
      if (envelope.event_type !== 'TRANSACTION.SUCCESS') return null;
      const resource = envelope.resource;
      if (resource?.algorithm !== 'AEAD_AES_256_GCM') fail('微信回调加密算法不匹配');
      const encrypted = Buffer.from(resource.ciphertext, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(settings.apiV3Key), Buffer.from(resource.nonce));
      decipher.setAuthTag(encrypted.subarray(-16));
      decipher.setAAD(Buffer.from(resource.associated_data || ''));
      const result = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString());
      if (result.trade_state !== 'SUCCESS') fail('微信支付状态不匹配');
      return payment(result);
    },
    async query(orderNo) {
      try {
        const uri = settings.subMchid
          ? `/v3/pay/partner/transactions/out-trade-no/${encodeURIComponent(orderNo)}?sp_mchid=${encodeURIComponent(settings.mchid)}&sub_mchid=${encodeURIComponent(settings.subMchid)}`
          : `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(settings.mchid)}`;
        const result = await api('GET', uri);
        if (result.out_trade_no !== orderNo) fail('微信查单订单不匹配');
        return { state: result.trade_state, payment: result.trade_state === 'SUCCESS' ? payment(result) : null };
      } catch (error) { if (error.providerCode === 'ORDER_NOT_EXIST') return { state: 'NOTFOUND' }; throw error; }
    },
    async close(orderNo) {
      const uri = settings.subMchid ? `/v3/pay/partner/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close` : `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`;
      await api('POST',uri,settings.subMchid ? {sp_mchid:settings.mchid,sub_mchid:settings.subMchid} : {mchid:settings.mchid});
    },
  };
}
module.exports = createWechat();
module.exports.createWechat = createWechat;
