const { AlipaySdk } = require('alipay-sdk');
const { alipay: config, valid, httpsUrl } = require('../config/payment-runtime');
const { cents, fail } = require('./commerce');
const QRCode = require('qrcode');
function createAlipay(settings = config, sdkOverride) {
  let sdk;
  const configured = valid(settings.appId, settings.sellerId, settings.privateKey, settings.alipayPublicKey)
    && httpsUrl(settings.notifyUrl) && httpsUrl(settings.returnUrl);
  if (configured) sdk = sdkOverride || new AlipaySdk({ ...settings, gateway: 'https://openapi.alipay.com/gateway.do', signType: 'RSA2', timeout: 15000 });
  function requireReady() {
    if (!sdk || settings.enabled === false) fail('支付宝商户未配置或授权不可用，暂不可付款', 503);
    if (settings.authorizationExpiresAt && settings.authorizationExpiresAt <= Date.now()) fail('支付宝商户授权已到期，请重新授权',503);
  }
  return {
    isReady: !!sdk && settings.enabled !== false && (!settings.authorizationExpiresAt || settings.authorizationExpiresAt > Date.now()),
    async create(order) {
      requireReady();
      if (settings.appAuthToken) {
        // Never put a merchant app_auth_token into a browser-visible page-pay URL.
        // Delegated collection uses the server-side precreate API (requires 当面付授权).
        const result = await sdk.exec('alipay.trade.precreate', {
          appAuthToken:settings.appAuthToken, notifyUrl:settings.notifyUrl,
          bizContent:{out_trade_no:order.order_no,total_amount:Number(order.total_amount).toFixed(2),
            subject:`紫云湖文房订单 ${order.order_no}`,timeout_express:'30m'},
        },{validateSign:true});
        if (result.code !== '10000' || result.outTradeNo !== order.order_no) fail('支付宝未能创建付款码，请检查商户授权的当面付权限',502);
        const url = new URL(result.qrCode);
        if (url.protocol !== 'https:' || url.username || url.password || !['qr.alipay.com','render.alipay.com'].includes(url.hostname)) fail('支付宝付款码地址无效',502);
        return {qrCode:await QRCode.toDataURL(url.href,{width:256,margin:2})};
      }
      return { payUrl: sdk.pageExecute('alipay.trade.page.pay', 'GET', {
        notifyUrl: settings.notifyUrl, returnUrl: settings.returnUrl,
        bizContent: { out_trade_no: order.order_no, total_amount: Number(order.total_amount).toFixed(2),
          subject: `紫云湖文房订单 ${order.order_no}`, product_code: 'FAST_INSTANT_TRADE_PAY', timeout_express: '30m' },
      }) };
    },
    verifyNotify(params) {
      if (!sdk) fail('支付宝验签配置不可用',503);
      if (params.sign_type !== 'RSA2' || !sdk.checkNotifySignV2(params)) fail('支付宝签名无效');
      if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) return null;
      if (params.app_id !== settings.appId || params.seller_id !== settings.sellerId) fail('支付宝商户不匹配');
      if (settings.authAppId && params.auth_app_id !== settings.authAppId) fail('支付宝授权应用不匹配');
      return { orderNo: params.out_trade_no, amountCents: cents(params.total_amount), transactionId: params.trade_no };
    },
    async query(orderNo) {
      requireReady();
      const result = await sdk.exec('alipay.trade.query', { appAuthToken:settings.appAuthToken, bizContent: { out_trade_no: orderNo } }, { validateSign: true });
      if (result.subCode === 'ACQ.TRADE_NOT_EXIST') return { state: 'NOTFOUND' };
      if (result.code !== '10000') fail('支付宝查单失败，请稍后重试', 502);
      if (result.outTradeNo !== orderNo || (result.sellerUserId && result.sellerUserId !== settings.sellerId)) fail('支付宝查单订单不匹配');
      return { state: result.tradeStatus, payment: ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(result.tradeStatus)
        ? { orderNo, amountCents: cents(result.totalAmount), transactionId: result.tradeNo } : null };
    },
    async close(orderNo) {
      requireReady();
      const result = await sdk.exec('alipay.trade.close', { appAuthToken:settings.appAuthToken, bizContent: { out_trade_no: orderNo } }, { validateSign: true });
      // NOT_EXIST is unsafe: an issued page-pay URL can still create a trade.
      if (result.code !== '10000' && result.subCode !== 'ACQ.TRADE_HAS_CLOSE') fail('支付宝尚未确认关单；请打开付款页后重试取消，或联系商家核实', 409);
    },
  };
}
module.exports = createAlipay();
module.exports.createAlipay = createAlipay;
