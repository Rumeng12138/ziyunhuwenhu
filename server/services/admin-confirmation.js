const bcrypt = require('bcryptjs');
const db = require('../config/db');
const {fail} = require('./commerce');
module.exports = function confirmAdmin(req) {
  const user = db.prepare('SELECT password FROM users WHERE id=? AND is_admin=1').get(req.admin.id);
  if (!user || typeof req.body.admin_password !== 'string' || !bcrypt.compareSync(req.body.admin_password,user.password)) fail('请再次输入管理员密码确认操作',403);
  const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  if (bcrypt.compareSync('admin123',user.password) && !local) fail('当前账号仅可在本机执行收款管理',403);
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('ziyunhu_wenfang_secret')) fail('请先在服务器设置随机 JWT_SECRET（至少32位）',403);
};
