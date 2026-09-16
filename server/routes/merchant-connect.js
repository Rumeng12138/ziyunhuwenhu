const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { adminRequired } = require('../middleware/admin');
const { fail } = require('../services/commerce');
const service = require('../services/merchant-connect');
function confirmAdmin(req) {
  const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.admin.id);
  if (typeof req.body.admin_password !== 'string' || !bcrypt.compareSync(req.body.admin_password,user.password)) fail('请再次输入管理员密码确认操作',403);
  if (bcrypt.compareSync('admin123',user.password)) fail('请先修改默认管理员密码',403);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('ziyunhu_wenfang_secret')) fail('请先设置随机 JWT_SECRET（至少32位）',403);
}
function createRouter(connect = service) {
  const router = express.Router();
  router.use((req,res,next) => {res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
  // Public OAuth return: possession of state + signed token exchange only creates a candidate binding.
  router.get('/alipay/callback',async(req,res) => {
    try {
      const result = await connect.callback(req.query.state,req.query.app_auth_code);
      res.type('text/plain').send(result.message);
    } catch(error) {res.status(error.status || 502).type('text/plain').send('授权未完成或已处理，请回到商城后台刷新状态；不要重复提交授权回调。');}
  });
  router.use(adminRequired);
  router.get('/',(req,res) => res.json({code:200,data:connect.capabilities()}));
  router.post('/:channel/sessions',async(req,res,next) => {
    try {confirmAdmin(req);res.json({code:200,data:await connect.start(req.params.channel,req.admin.id,req.body)});} catch(error){next(error);}
  });
  router.get('/sessions/:id',async(req,res,next) => {
    try {res.json({code:200,data:await connect.status(req.params.id,req.admin.id)});} catch(error){next(error);}
  });
  router.post('/sessions/:id/confirm',(req,res,next) => {
    try {confirmAdmin(req);res.json({code:200,message:'商户授权已绑定；支付产品权限与实际收款仍需实单验证',data:connect.confirm(req.params.id,req.admin.id,req.body.merchant_id)});} catch(error){next(error);}
  });
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
