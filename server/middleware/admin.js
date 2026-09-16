const jwt = require('jsonwebtoken');
const db = require('../config/db');
const access = require('../services/admin-access');

const JWT_SECRET = process.env.JWT_SECRET || 'ziyunhu_wenfang_secret_key_2026';

// 管理员认证中间件
function adminRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, nickname, is_admin, is_owner, admin_active, admin_permissions, session_version FROM users WHERE id = ?').get(decoded.id);
    if (user && (decoded.session_version || 0) !== user.session_version) throw Error('Revoked session');
    if (!user || !user.is_admin || !user.admin_active) {
      return res.status(403).json({ code: 403, message: '无管理员权限' });
    }
    const required=access.requiredPermission(req);
    if(!user.is_owner&&required&&!access.parsePermissions(user.admin_permissions).includes(required)){
      return res.status(403).json({code:403,message:'当前子账号没有此功能权限'});
    }
    req.admin = user;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '登录已过期' });
  }
}

function ownerRequired(req,res,next){
  adminRequired(req,res,()=>req.admin.is_owner?next():res.status(403).json({code:403,message:'只有主账号可以管理子账号'}));
}

module.exports = { adminRequired, ownerRequired };
