/**
 * 支付网关配置
 * 使用前请将本文件复制为 payment.config.js 并填入真实商户信息
 * 或通过环境变量配置
 */

module.exports = {
  // 支付宝配置
  alipay: {
    appId: process.env.ALIPAY_APP_ID || '你的支付宝APPID',
    // 应用私钥（支付宝开放平台生成的应用私钥，RSA2格式）
    privateKey: process.env.ALIPAY_PRIVATE_KEY || `
-----BEGIN RSA PRIVATE KEY-----
你的应用私钥内容
-----END RSA PRIVATE KEY-----
    `,
    // 支付宝公钥（从支付宝开放平台获取）
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || `
-----BEGIN PUBLIC KEY-----
支付宝公钥内容
-----END PUBLIC KEY-----
    `,
    // 签名类型
    signType: 'RSA2',
    // 编码
    charset: 'utf-8',
    // 网关地址（沙箱环境用 https://openapi.alipaydev.com/gateway.do）
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    // 支付成功异步回调地址（需公网可访问）
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://your-domain.com/api/payment-gateway/alipay/notify',
    // 支付成功同步返回地址
    returnUrl: process.env.ALIPAY_RETURN_URL || 'https://your-domain.com/payment/success',
  },

  // 微信支付配置
  wechat: {
    // 商户号
    mchid: process.env.WECHAT_MCHID || '你的微信商户号',
    // 公众号/小程序APPID
    appid: process.env.WECHAT_APPID || '你的公众号APPID',
    // APIv3密钥（在商户平台设置）
    apiV3Key: process.env.WECHAT_API_V3_KEY || '你的APIv3密钥',
    // 商户证书序列号（从商户平台下载证书后获取）
    merchantSerialNumber: process.env.WECHAT_SERIAL_NO || '你的商户证书序列号',
    // 商户私钥（apiclient_key.pem 文件内容）
    privateKey: process.env.WECHAT_PRIVATE_KEY || `
-----BEGIN PRIVATE KEY-----
商户私钥内容
-----END PRIVATE KEY-----
    `,
    // 支付回调地址
    notifyUrl: process.env.WECHAT_NOTIFY_URL || 'https://your-domain.com/api/payment-gateway/wechat/notify',
  },
};
