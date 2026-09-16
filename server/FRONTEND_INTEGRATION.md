# 前端 API 对接改造指南

本文档指导如何将紫云湖文房商城前端从 **localStorage 本地存储模式** 改造为 **对接后端 API 模式**。

## 一、整体架构

```
┌─────────────┐         HTTP/HTTPS          ┌──────────────┐
│  前端 HTML  │ ◄──────────────────────────► │  Node.js API │
│  (静态页面) │    Authorization: Bearer     │  (Express)   │
│             │         <token>              │              │
└─────────────┘                              └──────┬───────┘
                                                   │
                                              ┌────▼───────┐
                                              │  SQLite DB │
                                              └────────────┘
```

改造核心：将前端中所有 `localStorage.getItem/setItem` 的数据操作，替换为 `fetch` 调用后端 API。

## 二、第一步：配置与请求封装

### 2.1 API 基地址配置

在前端 JS 顶部添加全局配置：

```javascript
// API 配置
const API_CONFIG = {
  baseURL: 'http://localhost:3000/api',  // 生产环境改为你的域名
  timeout: 10000,
};

// Token 管理
const TokenStore = {
  get: () => localStorage.getItem('zyh_token'),
  set: (token) => localStorage.setItem('zyh_token', token),
  remove: () => localStorage.removeItem('zyh_token'),
};
```

### 2.2 统一请求封装

```javascript
async function request(url, options = {}) {
  const token = TokenStore.get();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const res = await fetch(API_CONFIG.baseURL + url, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();

    // 401 未授权：清除 token 并跳转登录
    if (data.code === 401) {
      TokenStore.remove();
      showLoginModal();
      throw new Error('登录已过期，请重新登录');
    }
    if (data.code !== 200) {
      throw new Error(data.message || '请求失败');
    }
    return data;
  } catch (err) {
    console.error('[Request Error]', url, err);
    throw err;
  }
}

// GET 请求
function get(url, params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(query ? `${url}?${query}` : url);
}

// POST 请求
function post(url, data = {}) {
  return request(url, { method: 'POST', body: data });
}

// PUT 请求
function put(url, data = {}) {
  return request(url, { method: 'PUT', body: data });
}

// DELETE 请求
function del(url) {
  return request(url, { method: 'DELETE' });
}
```

## 三、各模块对接替换

### 3.1 用户认证模块

**改造前（localStorage）：**
```javascript
// 注册
const userList = JSON.parse(localStorage.getItem("zyh_users") || "[]");
userList.push({ account, pwd, nick });
localStorage.setItem("zyh_users", JSON.stringify(userList));

// 登录
const user = userList.find(x => x.account === acc && x.pwd === pwd);
localStorage.setItem("zyh_user", JSON.stringify(user));
```

**改造后（API）：**
```javascript
// 注册
const res = await post('/auth/register', { username, password, nickname });
TokenStore.set(res.data.token);
currentUser = res.data.user;

// 登录
const res = await post('/auth/login', { username, password });
TokenStore.set(res.data.token);
currentUser = res.data.user;

// 获取个人信息
const res = await get('/auth/profile');
currentUser = res.data;

// 更新个人信息
await put('/auth/profile', { nickname, avatar, gender, birthday, bio });

// 退出登录
TokenStore.remove();
currentUser = null;
```

### 3.2 商品模块

**改造前：**
```javascript
const productList = [...]; // 硬编码数组
function renderProducts() { /* 从数组渲染 */ }
```

**改造后：**
```javascript
// 获取商品列表（支持分类、搜索、分页）
async function loadProducts(category = 'all', keyword = '', page = 1) {
  const res = await get('/products', { category, keyword, page, pageSize: 20 });
  productList = res.data.list;
  renderProducts();
}

// 商品详情
async function loadProductDetail(id) {
  const res = await get(`/products/${id}`);
  return res.data;
}

// 搜索
async function searchProducts(keyword) {
  const res = await get('/products/search', { q: keyword });
  return res.data.list;
}
```

### 3.3 购物车模块

**改造前：**
```javascript
let cart = JSON.parse(localStorage.getItem("zyh_cart") || "[]");
function saveCart() { localStorage.setItem("zyh_cart", JSON.stringify(cart)); }
```

**改造后：**
```javascript
// 获取购物车
async function loadCart() {
  const res = await get('/cart');
  cart = res.data.list;
  renderCart();
  updateCartBadge(res.data.totalCount);
}

// 添加到购物车
async function addToCart(productId, quantity = 1) {
  await post('/cart', { product_id: productId, quantity });
  await loadCart();
}

// 更新数量
async function updateCartItem(cartItemId, quantity) {
  await put(`/cart/${cartItemId}`, { quantity });
  await loadCart();
}

// 删除
async function removeCartItem(cartItemId) {
  await del(`/cart/${cartItemId}`);
  await loadCart();
}
```

> 注意：API 模式下购物车数据存在服务端，与用户账号绑定。未登录时可暂存 localStorage，登录后同步到服务端。

### 3.4 收货地址模块

**改造前：**
```javascript
// 地址存在 localStorage，按用户区分
```

**改造后：**
```javascript
// 地址列表
const res = await get('/addresses');
addressList = res.data;

// 新增
await post('/addresses', { name, phone, province, city, district, detail, is_default });

// 更新
await put(`/addresses/${id}`, { name, phone, ... });

// 删除
await del(`/addresses/${id}`);

// 设为默认
await put(`/addresses/${id}/default`);
```

### 3.5 订单模块

**改造前：**
```javascript
let orderList = JSON.parse(localStorage.getItem("zyh_orders") || "[]");
```

**改造后：**
```javascript
// 创建订单
async function createOrder(addressInfo) {
  const res = await post('/orders', {
    receiver_name: addressInfo.name,
    receiver_phone: addressInfo.phone,
    receiver_address: addressInfo.fullAddress,
    remark: addressInfo.remark,
    // 不传 items 则从购物车生成
  });
  return res.data; // 返回订单信息，含 order_no, id, total_amount
}

// 订单列表
const res = await get('/orders', { status, page, pageSize });

// 订单详情
const res = await get(`/orders/${orderId}`);

// 取消订单
await put(`/orders/${orderId}/cancel`);

// 确认收货
await put(`/orders/${orderId}/confirm`);
```

### 3.6 支付模块

模拟支付已关闭。前端先获取 `/payment/methods`，仅显示已配置商户渠道。

```javascript
const res = await post('/payment/pay', { order_id: orderId, payment_method: 'alipay' });
// res.data.payUrl：用户主动打开支付宝官方收银台。
// 微信 payment_method='wechat' 时返回 res.data.qrCode（服务端生成的付款二维码图片）。
// 创建链接/二维码不是付款成功。不要将任意HTML插入文档，也不要收集银行卡信息。
const status = await get('/payment/status/' + encodeURIComponent(orderNo));
// 仅 status.data.status 为 paid/shipped/completed 且有 payment_transaction_id 才是已核实付款。
```

当前页面已实现 `PaymentPanel`（付款与查单）、`normalizeLine`（quantity→qty）和 `normalizeOrder`（total_amount→payAmount、created_at→createdAt 等）。接口以数据库字段为准。
商户配置步骤见 [PAYMENT_SETUP.md](PAYMENT_SETUP.md)。

### 3.7 收藏夹模块

**改造前：**
```javascript
// 收藏存在 localStorage
```

**改造后：**
```javascript
// 收藏列表
const res = await get('/favorites');

// 添加收藏
await post('/favorites', { product_id: productId });

// 取消收藏
await del(`/favorites/${productId}`);

// 检查是否已收藏
const res = await get(`/favorites/check/${productId}`);
const isFavorited = res.data.favorited;
```

### 3.8 意见反馈模块

**改造后：**
```javascript
await post('/feedback', {
  type: 'suggestion', // suggestion/quality/logistics/aftersale/other
  content: '反馈内容',
  contact: '手机号/邮箱（可选）',
});
```

## 四、登录态持久化与自动登录

```javascript
// 页面加载时检查 token
async function initAuth() {
  const token = TokenStore.get();
  if (!token) return;
  try {
    const res = await get('/auth/profile');
    currentUser = res.data;
    refreshUserView();
  } catch (e) {
    // token 无效，清除
    TokenStore.remove();
  }
}

// 页面加载时执行
document.addEventListener('DOMContentLoaded', initAuth);
```

## 五、未登录购物车同步策略

API 模式下购物车与账号绑定，未登录用户的购物车数据处理方案：

```javascript
// 方案：未登录时暂存 localStorage，登录后批量同步到服务端
async function syncCartAfterLogin() {
  const localCart = JSON.parse(localStorage.getItem('zyh_cart_guest') || '[]');
  if (localCart.length === 0) return;
  for (const item of localCart) {
    await post('/cart', { product_id: item.product_id, quantity: item.quantity });
  }
  localStorage.removeItem('zyh_cart_guest');
  await loadCart();
}
```

## 六、前端部署与跨域配置

### 6.1 开发环境

后端 `.env` 中配置 CORS：
```env
CORS_ORIGIN=http://localhost:5500,http://127.0.0.1:5500
```

### 6.2 生产环境（推荐同源部署）

将前端 HTML 文件放入后端 `public/` 目录，由 Express 托管：
```javascript
// server.js 已配置
app.use(express.static(path.join(__dirname, 'public')));
```
此时前端 `API_CONFIG.baseURL` 改为 `/api`（相对路径），无需跨域。

### 6.3 Nginx 反向代理（前后端分离部署）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /var/www/ziyunhu-frontend;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 管理后台
    location /admin {
        proxy_pass http://127.0.0.1:3000/admin;
    }
}
```

## 七、改造检查清单

- [ ] API 基地址配置正确
- [ ] 请求封装函数可用（含 401 处理）
- [ ] 注册/登录改为 API 调用，token 正确存储
- [ ] 商品列表从 API 加载（含分类筛选和搜索）
- [ ] 购物车增删改查对接 API
- [ ] 收货地址对接 API
- [ ] 订单创建、列表、详情对接 API
- [ ] 支付对接 API（模拟或真实网关）
- [ ] 收藏夹对接 API
- [ ] 意见反馈对接 API
- [ ] 页面加载时自动验证登录态
- [ ] 生产环境 CORS 或 Nginx 代理配置正确
- [ ] 移除所有旧的 localStorage 数据操作（或保留为未登录降级方案）

## 八、管理后台访问

后端启动后，管理后台访问地址：
```
http://localhost:3000/admin
```
默认管理员账号：`admin` / `admin123`（首次启动自动创建，生产环境请及时修改密码）。
