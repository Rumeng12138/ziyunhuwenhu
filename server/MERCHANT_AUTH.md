# 后台扫码 / 登录绑定商户

入口：后台 `/admin` → **收款设置**。原有私钥表单保留在“手动配置（高级）”中。

## 能做什么

- 支付宝：服务器生成第三方应用授权链接和二维码；商家在支付宝官方页面扫码或登录；服务端验签换取授权令牌。管理员回到后台，核对并输入商户号，再次验证管理员密码后才绑定。
- 微信：输入该服务商已有的进件申请单号，服务器签名查询微信申请状态并展示官方签约链接的二维码；只有申请状态为 `APPLYMENT_STATE_FINISHED` 才能确认绑定。此处不提交开户资料，也不是普通微信登录或任意存量商户的一键授权。
- 确认绑定后，支付宝使用服务端 `alipay.trade.precreate` 生成付款码，微信使用服务商 Native 支付。订单仍仅根据验签通知或服务端查单确认支付。

**普通支付宝 / 微信账号及个人收款码不等于网站支付接口。** 后台另设“普通支付宝 / 普通微信”收款码上传与人工核实入口，操作见 [PERSONAL_PAYMENTS.md](./PERSONAL_PAYMENTS.md)。商户账号本身也不等于已获得相应支付产品权限。银行卡仍需在支付平台绑定结算卡，本站不直接收集卡号、支付密码或 CVV。

## 运营方先配置一次

扫码入口不能替代支付机构审批。运营方需要获批的支付宝第三方应用 / 微信支付服务商资质、正式密钥、对应支付权限和公网 HTTPS 回调。没有这些配置时按钮禁用，接口返回未配置，不生成模拟授权码。

在服务器环境变量中配置下列值，不要填入浏览器、代码库或聊天消息。PEM 密钥优先使用 `_PATH` 指定受限文件；也支持同名无 `_PATH` 变量存放 PEM。

### 支付宝服务商

```dotenv
PAYCONNECT_ALIPAY_APP_ID=
PAYCONNECT_ALIPAY_PRIVATE_KEY_PATH=
PAYCONNECT_ALIPAY_PUBLIC_KEY_PATH=
PAYCONNECT_ALIPAY_KEY_TYPE=PKCS8
PAYCONNECT_ALIPAY_CALLBACK_URL=https://你的域名/api/admin/merchant-connect/alipay/callback
PAYCONNECT_ALIPAY_NOTIFY_URL=https://你的域名/api/payment/alipay/notify
PAYCONNECT_ALIPAY_RETURN_URL=https://你的域名/
```

确认第三方应用已发布、授权回调域名及路径符合平台要求，商户和服务商已开通 **当面付及代调用权限**。授权二维码的 `redirect_uri` 带随机 `state` 查询参数，不要让反向代理丢弃该参数。

此授权模式使用服务端预创建付款码，避免将 `app_auth_token` 放进浏览器支付链接。原手动直连模式仍为电脑网站支付，两种模式所需产品不同。

### 微信支付服务商

```dotenv
PAYCONNECT_WECHAT_APP_ID=
PAYCONNECT_WECHAT_MCH_ID=
PAYCONNECT_WECHAT_PRIVATE_KEY_PATH=
PAYCONNECT_WECHAT_PLATFORM_PUBLIC_KEY_PATH=
PAYCONNECT_WECHAT_MERCHANT_SERIAL=
PAYCONNECT_WECHAT_PLATFORM_SERIAL=
PAYCONNECT_WECHAT_API_V3_KEY=
PAYCONNECT_WECHAT_NOTIFY_URL=https://你的域名/api/payment/wechat/notify
```

提供服务商自己的 APPID、商户号、商户证书序列号，以及信任的微信支付公钥 / 平台证书公钥和匹配的标识。API v3 密钥须为32字节。

由服务商在官方平台完成进件，并把申请单号提供给管理员。商户超级管理员扫码核对、签约。申请完成不代表所有产品均已获批，须确认该商户授权了 **Native 支付**。只有线下收款权限时不能假定网站支付可用。

## 接口

除支付宝授权回调外，全部要求管理员 Bearer Token。POST 发起和确认还需要 `admin_password`。拒绝默认管理员密码和弱 / 默认 JWT_SECRET。

| 方法及路径（前缀 `/api/admin/merchant-connect`） | 用途 |
| --- | --- |
| `GET /` | 配置是否就绪、当前绑定；不返回令牌或私钥 |
| `POST /alipay/sessions` | 发起支付宝授权 |
| `POST /wechat/sessions` | 发起微信签约查询；另传字符串 `applyment_id` |
| `GET /sessions/:id` | 会话所有者查询状态；微信会签名查单 |
| `GET /alipay/callback` | 官方返回 `state`、`app_auth_code`，只创建待确认候选，不启用收款 |
| `POST /sessions/:id/confirm` | 传入实际 `merchant_id` 和管理员密码，确认绑定 |

会话10分钟过期；每个管理员每分钟最多发起5次。授权码只交换一次；交换超时应重新发起，不重放旧码。后台页面刷新后可重新发起授权。

## 安全和运维边界

- 授权令牌和刷新令牌在数据库中加密，使用现有 `PAYMENT_CONFIG_KEY` 或 `data/payment-settings.key`。备份数据库时也要安全备份加密密钥，丢失后无法恢复令牌。
- 回调后必须由登录管理员再次确认商户号，适配跨设备扫码，同时避免回调直接改变收款账户。
- 原渠道有待支付订单时禁止更换商户，防止付款落入错误商户；允许同一商户、同一服务商应用重新授权以续期。已绑定渠道禁止用高级手动配置覆盖。
- 本版本不自动刷新支付宝授权令牌；到期需重新授权。不包含授权撤销通知、退款自动化、完整进件申请或结算卡管理。平台撤销授权后实际调用会失败；后台显示的绑定记录不是实时产品权限证明。
- 当前仅本地测试及官方协议结构核对，**没有用真实商户完成授权、支付或到账验收**。配置后先完成官方授权和支付产品验收，再由运营方授权进行小额实单核对；不要把“已绑定”当作“已到账”。
- 生产使用 HTTPS、强随机 JWT_SECRET、非默认管理员密码；限制环境变量和密钥文件访问，禁止代理日志记录完整授权回调查询参数。

## 官方参考

- [支付宝开放平台服务商接入说明](https://open.alipay.com/operatingGuide.htm)
- [支付宝应用授权令牌接口](https://developer.alibaba.com/docs/api.htm?apiId=1020&docType=4)
- [微信特约商户进件与签约流程](https://pay.wechatpay.cn/doc/v3/partner/4012062375)
- [微信服务商 Native 下单](https://pay.wechatpay.cn/doc/v3/partner/4012738659)

## 本地验证

在 `server` 下运行 `npm test`（当前 SQLite 原生模块需要 Node 22）。测试使用内存数据库、临时测试密钥和模拟平台响应，不发生真实交易。运行 `npm run build:admin` 重新生成后台样式。
