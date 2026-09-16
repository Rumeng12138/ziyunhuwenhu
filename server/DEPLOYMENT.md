# 紫云湖商城部署指南

本项目采用同源部署：一个 Node.js 服务同时提供商城首页、管理后台、API 与上传图片。首页是否展示与“店铺设置”是否发布相互独立；后台对商品、订单、用户、反馈、售后、运费、活动、会员签到、首页装修、店铺资料和子账号的更新仍写入同一数据库，并由前台接口读取。

## 1. 运行要求

- Node.js 22.22+ 或 24.x（不支持 Node 25+）
- pnpm 11.19.0，由 `packageManager` 和锁文件固定
- SQLite；单实例运行
- 生产环境必须为数据库、上传图片、会话密钥、支付配置密钥和备份提供持久化磁盘

安装和验证：

```bash
cd server
corepack enable
pnpm install --frozen-lockfile
pnpm run sync:frontend
pnpm run build:admin
pnpm test
pnpm start
```

本地访问：

- 商城：`http://127.0.0.1:3000/`
- 后台：`http://127.0.0.1:3000/admin`
- 健康检查：`http://127.0.0.1:3000/api/health`
- 业务上线检查：`http://127.0.0.1:3000/api/readiness`

开发环境若未设置管理员初始密码，会创建仅限本机访问的 `admin / admin123`。生产环境不会接受此默认密码。

## 2. 环境变量

从 `.env.example` 复制出 `.env`。生产环境至少配置：

```env
NODE_ENV=production
HOST=0.0.0.0
JWT_SECRET=至少32位的随机值
ADMIN_INITIAL_PASSWORD=首次建库使用的12至72字节密码，必须含字母和数字
PUBLIC_SITE_URL=https://shop.example.com
CORS_ORIGIN=https://shop.example.com
TRUST_PROXY=true
STORAGE_DIR=/var/lib/ziyunhu
```

`ADMIN_INITIAL_PASSWORD` 只在新生产数据库创建 `admin` 时使用，也可把已有的开发默认密码安全升级一次。初始化完成后可以从部署平台删除；后续密码在后台修改。

`STORAGE_DIR` 的默认布局：

```text
/var/lib/ziyunhu/
├── ziyunhu.db
├── session-signing.key
├── payment-settings.key
├── uploads/
└── backups/
```

如需拆分目录，可分别设置 `DB_PATH`、`UPLOAD_DIR`、`BACKUP_DIR`、`PAYMENT_SETTINGS_DIR` 和 `DATA_DIR`；部署时直接参考 `.env.example`。

## 3. Render 测试部署

仓库根目录已提供 `render.yaml`。它会：

- 以 `server/` 为服务根目录；
- 使用 Node 24.14.1 和 pnpm 锁文件构建；
- 构建商城页面与后台样式；
- 绑定 Render 提供的 `PORT` 与 `0.0.0.0`；
- 把 1 GB 持久化磁盘挂载到 `/var/data`；
- 使用 `/api/health` 做进程健康检查。

操作步骤：

1. 将当前分支推送到 GitHub、GitLab 或 Bitbucket。
2. 在 Render 新建 Blueprint，选择该仓库并读取 `render.yaml`。
3. 为三个 `sync: false` 变量填写值：
   - `ADMIN_INITIAL_PASSWORD`：首次管理员密码；
   - `PUBLIC_SITE_URL`：Render 分配的 HTTPS 地址或自定义域名；
   - `CORS_ORIGIN`：与 `PUBLIC_SITE_URL` 相同的源。
4. 部署完成后依次访问 `/api/health`、`/`、`/admin`。
5. 登录后台继续配置真实资料、支付与运营内容；`/api/readiness` 在这些业务条件未完成前返回 503 属于正常现象，不代表服务启动失败。

Blueprint 使用带持久化磁盘的付费实例，适合保留测试数据。若仅做一次性界面演示，可将套餐改为免费并删除 `disk` 配置，但免费实例的 SQLite、上传图片、密钥和后台修改可能在重启或重新部署后丢失，绝不能用于正式订单或收款。

## 4. 云服务器正式部署

推荐在 Linux 云服务器上使用单个 Node 进程、持久化目录和 Nginx HTTPS 反向代理。不要同时启动多个应用副本共享同一个 SQLite 文件。

示例目录：

```text
/opt/ziyunhu/current/       # Git 工作区，只读部署代码
/var/lib/ziyunhu/           # SQLite、上传、密钥（定期备份）
```

Nginx 核心配置：

```nginx
server {
    listen 443 ssl http2;
    server_name shop.example.com;

    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

用 systemd 或 PM2 守护 `pnpm start`，仅向公网开放 80/443。部署新版本时保留 `STORAGE_DIR` 与生产环境变量，不要用源码覆盖它们。

## 5. 备份与上线验收

```bash
pnpm run audit:sensitive
pnpm run backup:db
pnpm audit --prod
pnpm test
```

数据库在线备份写入 `BACKUP_DIR`。还应把上传图片、会话密钥和支付配置密钥一并复制到受控的异机加密存储，并实际做一次恢复演练。

正式开放前完成 [生产投入使用清单](PRODUCTION_READINESS.md)，确认 `/api/readiness` 返回 `ready=true`。该接口包含经营资料、首页内容、商品图片、收款渠道和目录权限等业务检查；`/api/health` 只用于判断进程与数据库是否存活。
