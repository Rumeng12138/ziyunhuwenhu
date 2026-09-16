const { AlipaySdk } = require('alipay-sdk');
const config = require('../config/merchant-connect');
const { fail } = require('./commerce');
function createAlipayConnector(settings = config.alipay(), sdkOverride) {
  const capability = config.readiness('alipay', settings);
  const sdk = sdkOverride || (capability.ready ? new AlipaySdk({ ...settings, gateway:'https://openapi.alipay.com/gateway.do', timeout:15000 }) : null);
  function requireReady() { if (!capability.ready || !sdk) fail('尚未配置支付宝第三方应用，无法发起扫码授权', 503); }
  function grant(result) {
    if (result.code !== '10000' || !result.appAuthToken || !/^2088\d+$/.test(result.userId || '') || !result.authAppId) fail('支付宝未返回有效的商户授权', 502);
    const ttl = Number(result.expiresIn);
    if (!Number.isSafeInteger(ttl) || (ttl <= 0 && ttl !== -1)) fail('支付宝授权有效期无效', 502);
    return { merchantId: result.userId, operatorId: settings.appId, authAppId: result.authAppId,
      appAuthToken: result.appAuthToken, appRefreshToken: result.appRefreshToken || '',
      expiresAt: ttl === -1 ? null : Date.now() + ttl * 1000 };
  }
  return {
    ...capability, kind:'oauth', operatorId:settings.appId,
    async start(state) {
      requireReady();
      const url = new URL('https://openauth.alipay.com/oauth2/appToAppAuth.htm');
      url.searchParams.set('app_id', settings.appId);
      // State is carried in the registered callback URL so it also works when the merchant authorizes on another device.
      const callback = new URL(settings.callbackUrl); callback.searchParams.set('state',state);
      url.searchParams.set('redirect_uri',callback.href);
      return { authorizationUrl:url.href };
    },
    async exchange(code) {
      requireReady();
      const result = await sdk.exec('alipay.open.auth.token.app', { bizContent:{grant_type:'authorization_code',code} }, {validateSign:true});
      return grant(result);
    },
  };
}
function createWechatConnector(settings = config.wechat(), clientOverride) {
  const capability = config.readiness('wechat',settings);
  const client = clientOverride || (capability.ready ? require('./wechat-live').createWechat(settings) : null);
  function requireReady() { if (!capability.ready || !client) fail('尚未配置微信支付服务商，无法获取签约二维码',503); }
  async function query(applymentId) {
    requireReady();
    const result = await client.requestApi('GET','/v3/applyment4sub/applyment/applyment_id/' + applymentId);
    if (String(result.applyment_id) !== applymentId) fail('微信进件申请不匹配',502);
    if (result.applyment_state === 'APPLYMENT_STATE_FINISHED') {
      if (!/^\d{6,20}$/.test(result.sub_mchid || '')) fail('微信未返回有效的特约商户号',502);
      return { grant:{merchantId:result.sub_mchid,operatorId:settings.mchid,applymentId,expiresAt:null} };
    }
    if (['APPLYMENT_STATE_REJECTED','APPLYMENT_STATE_CANCELED'].includes(result.applyment_state)) fail('微信商户申请未通过或已取消，请在服务商平台处理',409);
    let authorizationUrl;
    if (result.sign_url) {
      const url = new URL(result.sign_url);
      if (url.protocol !== 'https:' || !['pay.weixin.qq.com','pay.wechatpay.cn'].includes(url.hostname) || url.username || url.password) fail('微信未返回可信的签约地址',502);
      authorizationUrl = url.href;
    }
    return { authorizationUrl, providerState:result.applyment_state,
      message:authorizationUrl ? '请商户超级管理员扫码核实并签约' : '申请尚未生成签约链接，请等待微信审核后刷新' };
  }
  return {
    ...capability, kind:'wechat_applyment', operatorId:settings.mchid,
    async start(state, input) {
      const applymentId = input.applyment_id;
      if (typeof applymentId !== 'string' || !/^\d{1,20}$/.test(applymentId)) fail('请提供该服务商平台已有的微信进件申请单号（字符串）');
      return { ...(await query(applymentId)), context:{applymentId} };
    },
    async poll(context) { return query(context.applymentId); },
  };
}
module.exports = { createAlipayConnector, createWechatConnector };
