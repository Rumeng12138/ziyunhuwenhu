const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'ziyunhu_wenfang_secret_key_2026';

// 认证中间件 - 必须登录
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录，请先登录' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT session_version FROM users WHERE id=?').get(decoded.id);
    if (!user || (decoded.session_version || 0) !== user.session_version) throw Error('Revoked session');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录' });
  }
}

// 可选认证 - 有 token 则解析，没有也放行
function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT session_version FROM users WHERE id=?').get(decoded.id);
      if (user && (decoded.session_version || 0) === user.session_version) req.user = decoded;
    } catch (err) {
      // token 无效则忽略
    }
  }
  next();
}

module.exports = { authRequired, authOptional, JWT_SECRET };
