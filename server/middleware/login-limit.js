// Single-process login throttling. Use a shared store before multi-instance deployment.
const crypto = require('node:crypto');
function createLoginLimit({ now = Date.now, windowMs = 15 * 60 * 1000, accountLimit = 10, ipLimit = 60 } = {}) {
  const attempts = new Map();
  return (req,res,next) => {
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const account = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0,100) : '';
    const keys = [['ip:' + req.ip,ipLimit], ['account:' + crypto.createHash('sha256').update(account).digest('hex'),accountLimit]];
    if (attempts.size >= 10000 || keys.some(([key,limit]) => (attempts.get(key)?.count || 0) >= limit)) {
      res.set('Retry-After', String(Math.ceil(windowMs/1000)));
      return res.status(429).json({code:429,message:'登录尝试过多，请15分钟后重试'});
    }
    for (const [key] of keys) {
      const value = attempts.get(key) || {count:0,until:time+windowMs}; value.count++; attempts.set(key,value);
    }
    res.once('finish', () => { if (res.statusCode === 200) attempts.delete(keys[1][0]); });
    next();
  };
}
module.exports = { createLoginLimit, loginLimit: createLoginLimit() };
