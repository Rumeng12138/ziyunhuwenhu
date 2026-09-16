# 库存与真实收款上线说明

普通支付宝 / 普通微信的个人码和人工核实流程见 [PERSONAL_PAYMENTS.md](./PERSONAL_PAYMENTS.md)。商户接口与普通收款独立；下文的平台自动验证要求仅适用于商户方式。

## 本次功能

- 后台 `/admin` → 商品管理 → **调整库存**；库存为可售数量，不包含待支付订单已预留的商品。库存必须为 0–1000000 的整数。若库存被订单改变，过期的编辑会被拒绝。
- 商品详情、购物车支持加减及直接输入数量。服务端重新读取商品价格并校验库存，不信任买家提交的价格或名称。
- 创建订单时事务预留库存；未发起支付的订单取消后恢复库存。已发起支付的订单必须先由平台确认关单才能恢复库存。
- 后台 → **收款设置**：配置支付宝、微信商户；密钥使用 AES-256-GCM 加密保存，接口不回显密钥。留空密钥表示保留原值。
- 银行卡结算入口前往支付宝或微信官方商户平台。本站**没有直接银行卡收单通道**，不收集卡号、支付密码、CVV，也不能替支付机构审核绑卡。
- 支付宝正式电脑网站收银台、微信 Native 扫码；仅可信回调或服务端查单确认后标记付款。买家按钮、页面跳回、创建付款链接都不表示付款成功。
- 修复订单金额、商品数量、图片和日期字段映射；旧模拟付款订单标为“历史订单 · 收款未核实”，不计入真实营收，不能直接发货。

## 必须由商家完成

1. 在官方平台开通并签约支付宝**电脑网站支付**或微信**Native 支付**。普通个人收款码、支付宝登录账号、微信号、银行卡号不能代替商户 API 配置。
2. 部署后端与数据库，准备公网 HTTPS 域名。纯静态网页无法安全实现自动收款。推荐单个 Node 22 实例 + SQLite 持久化磁盘。
3. 在服务器 `.env` 中设置至少 32 位随机 `JWT_SECRET`，不要使用示例默认值。修改后重启并重新登录。
4. 登录后台，先在“收款设置 → 修改管理员密码”更换默认密码，再输入当前密码保存商户配置。
5. 将下列回调地址替换成自己的域名。必须可由支付平台从公网访问，不能要求网站登录，也不能修改微信通知原始正文：
   - 支付宝：`https://你的域名/api/payment/alipay/notify`
   - 微信：`https://你的域名/api/payment/wechat/notify`
   - 支付宝返回地址：`https://你的域名/`；返回后在“我的订单”查询结果。
6. 在官方商户平台绑定并验证结算银行卡。到账周期、提现条件和费用以该商户合同为准。
7. 商家自行做小额真实交易，核对**订单号、金额、商户平台流水与实际入账**，再开放销售。开发测试没有发起真实扣款，无法证明你的商户已开通或资金已到账。

## 后台字段

| 渠道 | 所需信息 |
| --- | --- |
| 支付宝 | APPID、收款商户 UID、应用私钥 PEM、支付宝公钥 PEM、PKCS8/PKCS1 格式、异步通知和返回地址 |
| 微信 | APPID、商户号、商户 API 证书序列号、商户 API 私钥 PEM、API v3 密钥（32字节）、微信支付公钥 PEM 及其公钥 ID（或平台证书序列号）、异步通知地址 |

注意：微信平台公钥与商户私钥不是同一把密钥。私钥 PEM 需保留 BEGIN/END 行和换行；后台支持粘贴多行。证书/密钥轮换前先处理该渠道的待支付订单。

后台仅做本地完整性和密钥格式检查。**“已配置 · 待实收验证”不是“已通过商户验证”。**

## 服务器环境变量方式（可选）

也可在服务器配置如下变量；检测到某渠道的环境变量时，后台不再允许编辑该渠道，避免覆盖冲突。不要把密钥放进前端或提交到版本库。

```dotenv
ALIPAY_APP_ID=
ALIPAY_SELLER_ID=
ALIPAY_PRIVATE_KEY_PATH=/secure/alipay-private.pem
ALIPAY_PUBLIC_KEY_PATH=/secure/alipay-public.pem
ALIPAY_KEY_TYPE=PKCS8
ALIPAY_NOTIFY_URL=https://你的域名/api/payment/alipay/notify
ALIPAY_RETURN_URL=https://你的域名/

WECHAT_APP_ID=
WECHAT_MCH_ID=
WECHAT_API_V3_KEY=
WECHAT_MERCHANT_SERIAL=
WECHAT_PRIVATE_KEY_PATH=/secure/wechat-private.pem
WECHAT_PLATFORM_PUBLIC_KEY_PATH=/secure/wechat-platform-public.pem
WECHAT_PLATFORM_SERIAL=
WECHAT_NOTIFY_URL=https://你的域名/api/payment/wechat/notify
```

## 密钥、数据与运维

- 后台保存的信息在数据库 `payment_settings` 表中加密。加密主密钥优先使用 `PAYMENT_CONFIG_KEY`（随机 32 字节的 Base64）；未设置时首次保存会生成 `server/data/payment-settings.key`。限制该文件操作系统权限，仅允许运行服务的账户读取。备份时数据库和密钥均须保存、分开保管。丢失密钥会导致已存配置无法解密。
- 不会覆盖现有 `payment.config.js` 或 `.env`。配置文件中原有占位符不构成可用商户配置。
- 旧版本可能保存过银行卡/CVV，停止使用旧卡接口不等于自动清理历史敏感数据；上线前应由管理员审查数据库与备份并清理不应保留的信息。
- 待支付订单不会自动释放库存。当前通过订单取消进行安全关单、释放；不要直接改数据库订单状态。支付宝已生成但未打开的付款链接可能尚未形成平台订单，无法确认关闭时系统保留库存并提示人工核实。不得绕过保护直接恢复库存。
- 当前不提供自动退款、账单对账任务、微信 JSAPI/手机 H5 支付和银行卡直接收单。退款需在商户平台处理；手机上的微信 Native 二维码需要另一台设备扫码。
- 收款设置变更会立即更新当前进程；多进程部署前需增加配置同步机制。上线后应定期核对商户账单与本地订单。

## 安装与测试

```sh
# Node 22
npm install
npm run build:admin
npm test
npm start
```

后台样式已生成 `public/admin.css`，不再依赖在线 Tailwind 脚本。修改后台模板或样式后重新构建。

自动化测试使用内存数据库和随机测试密钥，覆盖库存校验、重复下单、订单金额、防伪回调、重复通知、取消保护和加密配置；不会连接真实收款账户。

## 官方资料

- [支付宝官方 Node.js SDK：网页支付与通知验签](https://github.com/alipay/alipay-sdk-nodejs-all)
- [微信 Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)
- [微信支付签名与验签](https://pay.wechatpay.cn/doc/v3/merchant/4012365342)
- [微信支付关闭订单](https://pay.wechatpay.cn/doc/v3/merchant/4012526915)
# 扫码授权入口

后台现已提供支付宝第三方应用授权、微信服务商进件签约入口，原手动配置折叠为高级选项。前置资质、环境变量和接口详见 [MERCHANT_AUTH.md](./MERCHANT_AUTH.md)。普通个人账号扫码登录不能直接开通自动收款；新增入口仍需配置真实服务商后联调。
