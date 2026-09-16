const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const profile = require('./store-profile');
const editorial = require('./editorial-content');
const {dataDir,uploadDir}=require('../config/storage');

function report() {
  const checks = [];
  const add = (id, ok, message) => checks.push({ id, ok: !!ok, message });
  const secret = process.env.JWT_SECRET || '';
  add('jwt_secret', secret.length >= 32 && !secret.includes('ziyunhu_wenfang_secret'), '会话密钥至少32位且不是示例值');
  const defaultAdmin = db.prepare('SELECT password FROM users WHERE is_admin=1 AND admin_active=1').all().some(row => bcrypt.compareSync('admin123', row.password));
  add('admin_password', !defaultAdmin, '管理员已修改默认密码');
  add('store_profile', profile.get().published, '真实经营主体、联系方式及法律文本已审核发布');
  const homepage=editorial.readinessStatus();
  const homepageLabels={hero:'首页主视觉',treasures:'文房四宝',artisans:'匠人访谈',culture:'文房文化',brand_story:'品牌故事'};
  add('homepage_content',homepage.ok,homepage.ok?'首页装修的五个版块均已发布且含可展示内容':`首页装修尚未完成发布（${homepage.missing.map(key=>homepageLabels[key]||key).join('、')}）`);
  const catalog=profile.catalogStatus();
  add('catalog',catalog.ok,`已上架商品使用正式图片（上架 ${catalog.total} 件，缺图或示例图 ${catalog.invalid} 件）`);
  add('public_site_url', process.env.NODE_ENV !== 'production' || /^https:\/\/[^/]+/.test(process.env.PUBLIC_SITE_URL || ''), '生产环境已配置 HTTPS 公网地址 PUBLIC_SITE_URL');
  const origins = (process.env.CORS_ORIGIN || '*').split(',').map(item => item.trim()).filter(Boolean);
  add('cors', process.env.NODE_ENV !== 'production' || (origins.length > 0 && !origins.includes('*')), '生产环境已限制允许访问的站点来源');
  const methods = require('./personal-payments').methods();
  const providers = require('./payments').providers;
  add('payment', methods.some(item => item.enabled) || Object.values(providers).some(item => item.isReady), '至少启用一个已核验收款渠道');
  const writable=dir=>{try{fs.accessSync(dir,fs.constants.R_OK|fs.constants.W_OK);return true;}catch{return false;}};
  add('data_directory', fs.existsSync(dataDir) && writable(dataDir), '数据库目录可读写');
  add('upload_directory', fs.existsSync(uploadDir) && writable(uploadDir), '上传目录可读写');
  return { ready: checks.every(item => item.ok), checks, timestamp: new Date().toISOString() };
}

module.exports = { report };
