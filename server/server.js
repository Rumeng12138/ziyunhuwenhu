require('dotenv').config();
require('./config/auth-secret').initialize();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { securityHeaders, contentSecurityPolicy } = require('./middleware/security');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {uploadDir}=require('./config/storage');

// 初始化数据库（自动建表 + 插入初始商品数据）
require('./config/initDB');

// A default administrator remains usable locally, but must never expose the server publicly.
const { providers } = require('./services/payments');
const hasDefaultAdmin = require('./config/db').prepare('SELECT password FROM users WHERE is_admin=1 AND admin_active=1').all().some(admin=>require('bcryptjs').compareSync('admin123',admin.password));
const listenHost = hasDefaultAdmin ? '127.0.0.1' : (process.env.HOST || '0.0.0.0');
if (process.env.NODE_ENV === 'production' || Object.values(providers).some(provider => provider.isReady) || require('./services/personal-payments').methods().some(method=>method.enabled)) {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || secret.includes('ziyunhu_wenfang_secret')) throw new Error('上线前必须设置随机 JWT_SECRET（至少32位）');
  if (process.env.NODE_ENV==='production' && hasDefaultAdmin) throw new Error('公网部署需设置非默认管理员凭据；本机开发无需更改');
}

const app = express();
const PORT = process.env.PORT || 3000;
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
const expiryTimer=setInterval(()=>{
  try { require('./services/order-expiry').expireUnstarted.immediate(); }
  catch(error) { console.error('[Order expiry]',error.name); }
},60000);
expiryTimer.unref();

// CORS 配置
const corsOrigin = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigin.includes('*')) {
  throw new Error('生产环境必须通过 CORS_ORIGIN 明确配置允许访问的站点来源');
}
app.use(securityHeaders);
app.use(cors({
  origin: corsOrigin.includes('*') ? false : corsOrigin,
  credentials: false,
}));

// 解析请求体
app.use(express.json({ limit: '1mb', verify: (req, res, buffer) => { req.rawBody = buffer; } }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use('/api/admin',(req,res,next)=>{
  if(hasDefaultAdmin){
    const hosts=['localhost','127.0.0.1','[::1]'];
    let originOK=true;
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);originOK=hosts.includes(origin.hostname)&&origin.port===String(PORT);}catch{originOK=false;}}
    if(!hosts.includes(req.hostname)||!originOK)return res.status(403).json({code:403,message:'当前后台仅允许本站本机访问'});
  }
  next();
});

// 静态文件（可选：将前端构建产物放在 public 目录下即可托管）
fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir,{dotfiles:'deny',index:false,maxAge:'1y',immutable:true}));
app.get(['/', '/index.html', '/products'], (req,res,next) => {
  const file=path.join(__dirname,'public','index.html');
  if(!fs.existsSync(file))return next();
  const nonce=crypto.randomBytes(18).toString('base64');
  const profile=require('./services/store-profile').get();
  const base=(process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'');
  let html=fs.readFileSync(file,'utf8').replace(/<script>(?=\s*\/\* ========== 紫云湖)/,`<script nonce="${nonce}">`);
  if(profile.published&&/^https:\/\//.test(base)){
    const canonical=base.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const canonicalPath=req.path==='/products'?'/products':'/';
    html=html.replace('<link rel="canonical" href="/" />',`<link rel="canonical" href="${canonical}${canonicalPath}" />`);
    const organization=JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:profile.display_name,legalName:profile.legal_name,url:base,telephone:profile.contact_phone,email:profile.contact_email,address:profile.business_address}).replace(/</g,'\\u003c');
    html=html.replace('</head>',`<script nonce="${nonce}" type="application/ld+json">${organization}</script>\n</head>`);
  }
  res.set('Content-Security-Policy',contentSecurityPolicy({nonce}));
  res.set('Cache-Control','no-cache');
  if (!profile.published) res.set('X-Robots-Tag','noindex, nofollow');
  res.type('html').send(html);
});
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  require('./config/db').prepare('SELECT 1').get();
  res.json({ code: 200, message: '紫云湖文房商城 API 服务运行中', timestamp: new Date().toISOString() });
});
app.get('/api/readiness', (req, res) => {
  const data = require('./services/readiness').report();
  res.status(data.ready ? 200 : 503).json({ code: data.ready ? 200 : 503, data });
});
app.get('/robots.txt',(req,res)=>{
  const published=require('./services/store-profile').get().published;
  const base=(process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'');
  res.type('text/plain').send(published&&base ? `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
});
app.get('/sitemap.xml',(req,res)=>{
  const published=require('./services/store-profile').get().published;
  const base=(process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'');
  if(!published||!/^https:\/\//.test(base))return res.status(404).type('text/plain').send('Not published');
  const origin=base.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/products</loc></url></urlset>`);
});

// 路由挂载
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/addresses', require('./routes/address'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/after-sales', require('./routes/after-sales'));
app.use('/api/payment', require('./routes/payment-live'));
app.use('/api/payment-gateway', require('./routes/payment-live'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/payment-settings', require('./routes/payment-settings'));
app.use('/api/admin/merchant-connect', require('./routes/merchant-connect'));
app.use('/api/admin/personal-payments', require('./routes/personal-payments'));
app.use('/api/admin/marketing', require('./routes/marketing'));
app.use('/api/admin/store-settings', require('./routes/store-settings'));
app.use('/api/admin/store-profile', require('./routes/store-profile'));
app.use('/api/admin/editorial-content', require('./routes/editorial-content'));
app.use('/api/admin/after-sales', require('./routes/admin-after-sales'));
app.get('/api/store-settings', (req,res) => { res.set('Cache-Control','no-store'); res.json({code:200,data:require('./services/membership').features()}); });
app.get('/api/store-offers',(req,res)=>res.json({code:200,data:require('./services/pricing').publicOffers()}));
app.get('/api/store-profile',(req,res)=>res.json({code:200,data:require('./services/store-profile').publicProfile()}));
app.get('/api/editorial-content',(req,res)=>res.json({code:200,data:require('./services/editorial-content').publicContent()}));

// 管理后台页面
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 404 处理
app.use('/api', (req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[Server Error]', req.requestId, err.name);
  res.status(status).json({ code: status, message: status < 500 || err.status ? err.message : '服务器内部错误' });
});

const httpServer=app.listen(PORT, listenHost, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   紫云湖文房商城 API 服务已启动          ║
║   地址: http://localhost:${PORT}            ║
║   健康检查: http://localhost:${PORT}/api/health ║
╚══════════════════════════════════════════╝
  `);
});
let closing=false;
function shutdown(signal){
  if(closing)return;closing=true;console.log(`[Shutdown] ${signal}`);
  clearInterval(expiryTimer);
  const force=setTimeout(()=>process.exit(1),10000);force.unref();
  httpServer.close(()=>{try{require('./config/db').close();}finally{clearTimeout(force);process.exit(0);}});
}
process.once('SIGTERM',()=>shutdown('SIGTERM'));
process.once('SIGINT',()=>shutdown('SIGINT'));
