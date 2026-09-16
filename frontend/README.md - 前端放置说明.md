# 前端商城文件放置目录

## 文件说明

本目录用于放置紫云湖文房商城前端文件。

前端为单文件应用 `index.html`，包含完整的 HTML/CSS/JS。

## 获取方式

当前 `index.html` 为 React JSX 源文件。直接修改本目录的源文件，再执行下述构建步骤。

## 部署方式二选一

### 方式一：同源部署（推荐）

在 `server` 目录运行 `npm run sync:frontend`（或 Windows 本地运行时 `.\.runtime\node.exe scripts/sync-frontend.cjs`），生成 `server/public/index.html`，由后端 Express 统一托管。部署文件已预编译 JSX，不再依赖浏览器 Babel；不要直接复制源文件代替构建。

前端代码中的 `API_BASE_URL` 已默认为 `'/api'`，无需修改。请通过后端地址访问商城，不要双击 HTML 文件打开。

访问地址：
- 前端商城：http://你的域名/
- 管理后台：http://你的域名/admin
- API 接口：http://你的域名/api/

### 方式二：分离部署

修改源文件中的 API 地址后，仍执行同一构建步骤，再将生成的 `server/public/index.html` 用 Nginx 或静态托管平台部署。

此时前端代码中的 `API_BASE_URL` 应改为后端实际地址，如 `'https://api.ziyunhu.com/api'`。

同时需在 `../server/.env` 中配置 `CORS_ORIGIN` 为前端域名。

## 前端配置项

打开 `index.html`，在 JS 代码顶部找到以下配置并根据部署方式修改：

```javascript
// API 接口基地址
// 同源部署：const API_BASE_URL = '/api';
// 分离部署：const API_BASE_URL = 'https://api.ziyunhu.com/api';
const API_BASE_URL = '/api';
```
