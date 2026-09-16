# 紫云湖文房商城 - 后端 API 服务

会员与签到开关、计价规则及本轮更新部署步骤见 [优化修改说明](../优化修改说明.md)。正式运营前必须完成 [生产投入使用清单](PRODUCTION_READINESS.md)。修改前台后请运行 `pnpm run sync:frontend` 生成部署文件，不要直接覆盖 `public/index.html`。

库存、后台收款设置及正式支付请先阅读 [PAYMENT_SETUP.md](PAYMENT_SETUP.md)。模拟支付已关闭；商户资料未配置时不能收款。

为紫云湖文房四宝独立站配套的后端服务，基于 **Node.js + Express + SQLite** 构建，开箱即用，无需额外安装数据库。

## 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js 22.22+ 或 24.x | 与依赖和 Render 配置匹配 |
| Web 框架 | Express 4.x | 轻量高效 |
| 数据库 | SQLite (better-sqlite3) | 文件型数据库，零配置 |
| 认证 | JWT (jsonwebtoken) | 无状态 Token 认证 |
| 密码加密 | bcryptjs | 加盐哈希 |
| 跨域 | cors | 可配置白名单 |

## 快速开始

### 1. 安装依赖

```bash
cd server
corepack enable
pnpm install --frozen-lockfile
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=your_secret_key_here
JWT_EXPIRES_IN=7d
STORAGE_DIR=
CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500
PUBLIC_SITE_URL=https://你的正式域名
```

> 生产环境务必更换 `JWT_SECRET`，并在首次建库前设置符合 `.env.example` 要求的 `ADMIN_INITIAL_PASSWORD`。持久化部署还必须设置 `STORAGE_DIR`。

### 3. 启动服务

```bash
# 生产模式
pnpm start

# 开发模式（自动重启）
pnpm run dev
```

启动后访问 `http://localhost:3000/api/health` 确认服务运行正常。

数据库文件默认创建在 `./data/ziyunhu.db`；设置 `STORAGE_DIR` 后，数据库、上传图片和运行密钥会统一保存在该持久化目录。

## 数据库设计

商品显示回归测试：在安装依赖后运行 `pnpm test`。测试使用独立的内存或临时数据库，不修改现有商品数据。

### 数据表清单

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| users | 用户表 | username, password, nickname, member_level, points, total_spent |
| products | 商品表 | name, category, price, stock, spec, description, image |
| orders | 订单表 | order_no, user_id, total_amount, freight, status, payment_method |
| order_items | 订单项 | order_id, product_id, product_name, price, quantity |
| addresses | 收货地址 | user_id, name, phone, province, city, district, detail, is_default |
| cart_items | 购物车 | user_id, product_id, quantity |
| favorites | 收藏夹 | user_id, product_id |
| feedbacks | 意见反馈 | user_id, type, content, contact, status |
| after_sales / refund_records | 售后与退款审计 | order_id, type, status, requested_amount, external_reference |
| store_profile | 经营主体与法律信息 | contact, policies, published, revision |

新数据库不创建银行卡表，相关接口固定返回 410。旧数据库若遗留 `bank_cards` 表，先运行 `npm run audit:sensitive`，由数据负责人连同备份一起审核后再决定清理，升级过程不会擅自删除历史数据。

### 会员等级

| 等级 | 名称 | 升级条件（累计消费） | 折扣 | 积分倍率 |
|------|------|---------------------|------|----------|
| 0 | 普通会员 | 0 元 | 无折扣 | 1x |
| 1 | 银卡会员 | 500 元 | 98 折 | 1.2x |
| 2 | 金卡会员 | 2000 元 | 95 折 | 1.5x |
| 3 | 钻石会员 | 5000 元 | 9 折 | 2x |

## API 接口文档

所有接口统一前缀 `/api`，响应格式：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": { }
}
```

需登录的接口在请求头携带：`Authorization: Bearer <token>`

### 认证与用户 `/api/auth`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| POST | `/register` | 用户注册 | 否 |
| POST | `/login` | 用户登录 | 否 |
| GET | `/profile` | 获取个人信息 | 是 |
| PUT | `/profile` | 更新个人信息 | 是 |
| GET | `/member` | 会员信息与等级 | 是 |
| POST | `/checkin` | 每日签到（+10积分） | 是 |

### 商品 `/api/products`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/` | 商品列表（支持 category、keyword、page、pageSize） | 否 |
| GET | `/:id` | 商品详情 | 否 |
| GET | `/search?q=` | 搜索商品 | 否 |

### 购物车 `/api/cart`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/` | 购物车列表 | 是 |
| POST | `/` | 添加商品（body: product_id, quantity） | 是 |
| PUT | `/:id` | 更新数量 | 是 |
| DELETE | `/:id` | 删除商品 | 是 |
| DELETE | `/` | 清空购物车 | 是 |

### 收货地址 `/api/addresses`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/` | 地址列表 | 是 |
| POST | `/` | 新增地址 | 是 |
| PUT | `/:id` | 更新地址 | 是 |
| DELETE | `/:id` | 删除地址 | 是 |
| PUT | `/:id/default` | 设为默认 | 是 |

### 订单 `/api/orders`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/` | 订单列表（支持 status 筛选、分页） | 是 |
| GET | `/:id` | 订单详情 | 是 |
| POST | `/` | 创建订单（从购物车或指定 items） | 是 |
| PUT | `/:id/cancel` | 取消订单 | 是 |
| PUT | `/:id/confirm` | 确认收货（发放积分） | 是 |

### 支付 `/api/payment`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/methods` | 可用商户渠道状态 | 否 |
| POST | `/pay` | 创建正式付款链接/二维码（alipay / wechat），不直接标记成功 | 是 |
| GET | `/status/:orderNo` | 服务端查单并返回订单 | 是 |
| POST | `/alipay/notify` | 支付宝签名通知 | 平台验签 |
| POST | `/wechat/notify` | 微信原始报文验签并解密通知 | 平台验签 |

商户配置使用 `/api/admin/payment-settings`；仅管理员可访问，修改需要密码再次验证。银行卡结算由官方商户平台绑定；本站不直接收集银行卡信息。

### 收藏夹 `/api/favorites`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| GET | `/` | 收藏列表 | 是 |
| POST | `/` | 添加收藏（body: product_id） | 是 |
| DELETE | `/:productId` | 取消收藏 | 是 |
| GET | `/check/:productId` | 检查是否已收藏 | 是 |

### 意见反馈 `/api/feedback`

| 方法 | 路径 | 说明 | 登录 |
|------|------|------|------|
| POST | `/` | 提交反馈（登录可选） | 可选 |
| GET | `/mine` | 我的反馈列表 | 是 |

### 售后 `/api/after-sales`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/` | 对已核实付款订单提交退款、退货退款或换货申请 |
| GET | `/`、`/:id` | 查询本人售后申请与审计进度 |
| PUT | `/:id/cancel` | 撤销待审核申请 |
| PUT | `/:id/shipment` | 填写退货物流 |

后台 `/api/admin/after-sales` 用于审核、状态流转和登记支付平台实际退款凭证。登记退款不会调用支付平台打款，运营人员必须先在原渠道完成退款并填写真实流水号。

## 业务规则

- **运费规则**：订单满 199 元包邮，未满收取 12 元运费
- **订单状态**：pending（待支付）→ paid（已支付）→ shipped（已发货）→ completed（已完成）/ cancelled（已取消）
- **库存扣减**：创建订单时扣减，取消订单时恢复
- **积分规则**：确认收货后按订单金额 1 元 = 1 积分发放，每日签到 +10 积分
- **密码安全**：bcrypt 加盐哈希存储，不明文保存

## 前端对接说明

1. 将前端项目中所有 `localStorage` 数据操作替换为对应 API 调用
2. 登录成功后将 `token` 存入 `localStorage`，后续请求统一在请求头携带
3. 建议封装统一的 `request` 函数，自动处理 Token 注入和 401 跳转登录
4. 前端开发时将 API 基地址设为 `http://localhost:3000/api`

示例封装：

```javascript
const BASE_URL = 'http://localhost:3000/api';

async function request(url, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(BASE_URL + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (data.code === 401) {
    localStorage.removeItem('token');
    // 跳转登录
  }
  return data;
}
```

## 部署建议

### 本地 / 小流量

直接 `npm start` 运行，SQLite 文件型数据库足够支撑数千日活。

### 生产环境推荐

- **应用服务器**：阿里云 ECS / 腾讯云 CVM，安装 Node.js 18+，使用 PM2 守护进程
- **数据库升级**：流量增大后可将 SQLite 迁移至 MySQL / PostgreSQL，仅需替换 `config/db.js` 的连接方式
- **反向代理**：Nginx 配置 HTTPS + 静态资源托管 + API 反向代理
- **进程守护**：`pm2 start server.js --name ziyunhu-server`

### PM2 部署示例

```bash
npm install -g pm2
pm2 start server.js --name ziyunhu-server
pm2 save
pm2 startup
```

## 项目结构

```
ziyunhu-server/
├── server.js              # 服务入口
├── package.json
├── .env.example           # 环境变量模板
├── config/
│   ├── db.js              # 数据库连接
│   └── initDB.js          # 建表 + 初始数据
├── middleware/
│   └── auth.js            # JWT 认证中间件
├── routes/
│   ├── auth.js            # 认证与用户
│   ├── products.js        # 商品
│   ├── cart.js            # 购物车
│   ├── address.js         # 收货地址
│   ├── orders.js          # 订单
│   ├── payment.js         # 支付
│   ├── favorites.js       # 收藏夹
│   └── feedback.js        # 意见反馈
├── data/                  # SQLite 数据库文件目录（自动生成）
└── public/                # 可选：放置前端静态文件
```

## License

MIT
