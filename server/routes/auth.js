const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authRequired, JWT_SECRET } = require('../middleware/auth');
const membership = require('../services/membership');
const { loginLimit } = require('../middleware/login-limit');
const validate = require('../services/validation');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// 用户注册
router.post('/register', loginLimit, (req, res) => {
  let { username, password, nickname } = req.body;
  if (![username,password,nickname].every(value=>typeof value==='string' && value.trim())) {
    return res.status(400).json({ code: 400, message: '账号、密码、昵称不能为空' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ code: 400, message: '账号长度需在3-20位之间' });
  }
  if (password.length < 6 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ code: 400, message: '密码至少6位，且不超过72字节' });
  }
  username=username.trim();nickname=validate.text(nickname,'昵称',{max:60});
  if (/\s|[\x00-\x1f\x7f]/.test(username)) return res.status(400).json({code:400,message:'账号不能包含空格或控制字符'});

  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) {
    return res.status(409).json({ code: 409, message: '账号已存在' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)'
  ).run(username, hashedPassword, nickname);

  const user = db.prepare('SELECT id, username, nickname, avatar, member_level, points FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.json({ code: 200, message: '注册成功', data: { token, user } });
});

// 用户登录
router.post('/login', loginLimit, (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || Buffer.byteLength(password)>72) {
    return res.status(400).json({ code: 400, message: '账号和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ code: 401, message: '账号或密码错误' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ code: 401, message: '账号或密码错误' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, session_version: user.session_version }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const { password: _, session_version: ignoredVersion, ...userInfo } = user;

  res.json({ code: 200, message: '登录成功', data: { token, user: userInfo } });
});

// 获取当前用户信息
router.get('/profile', authRequired, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, nickname, avatar, gender, birthday, bio, member_level, points, total_spent, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }
  res.json({ code: 200, data: user });
});

// 更新个人信息
router.put('/profile', authRequired, (req, res) => {
  const { nickname, avatar, gender, birthday, bio } = req.body;
  const fields = [];
  const values = [];
  if (nickname !== undefined) { fields.push('nickname = ?'); values.push(validate.text(nickname,'昵称',{max:60})); }
  if (avatar !== undefined) { fields.push('avatar = ?'); values.push(validate.optionalText(avatar,'头像地址',1000)); }
  if (gender !== undefined) { fields.push('gender = ?'); values.push(validate.oneOf(gender,['secret','male','female','other'],'性别')); }
  if (birthday !== undefined) { const value=validate.optionalText(birthday,'生日',10);if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))return res.status(400).json({code:400,message:'生日格式应为YYYY-MM-DD'});fields.push('birthday = ?');values.push(value); }
  if (bio !== undefined) { fields.push('bio = ?'); values.push(validate.optionalText(bio,'个人简介',500)); }

  if (fields.length === 0) {
    return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
  }

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare(
    'SELECT id, username, nickname, avatar, gender, birthday, bio, member_level, points FROM users WHERE id = ?'
  ).get(req.user.id);

  res.json({ code: 200, message: '更新成功', data: user });
});

router.put('/password', authRequired, (req,res) => {
  const {current_password,new_password}=req.body;
  if(typeof current_password!=='string'||typeof new_password!=='string'||Buffer.byteLength(current_password)>72||Buffer.byteLength(new_password)>72||new_password.length<8){
    return res.status(400).json({code:400,message:'请输入当前密码，新密码至少8位且不超过72字节'});
  }
  const user=db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if(!user||!bcrypt.compareSync(current_password,user.password))return res.status(403).json({code:403,message:'当前密码不正确'});
  if(bcrypt.compareSync(new_password,user.password))return res.status(400).json({code:400,message:'新密码不能与当前密码相同'});
  db.prepare('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?').run(bcrypt.hashSync(new_password,12),req.user.id);
  res.json({code:200,message:'密码已修改，请重新登录'});
});

// 会员信息
router.get('/member', authRequired, (req, res) => {
  res.set('Cache-Control','no-store');
  res.json({ code: 200, data: membership.info(req.user.id) });
});

// 每日签到
router.post('/checkin', authRequired, (req, res) => {
  const data = membership.checkin.immediate(req.user.id);
  res.json({ code: 200, message: data.alreadySigned ? '今日已签到' : '签到成功，获得10积分', data });
});

module.exports = router;
