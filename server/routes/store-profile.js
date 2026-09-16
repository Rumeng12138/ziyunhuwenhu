const express = require('express');
const { adminRequired } = require('../middleware/admin');
const confirmAdmin = require('../services/admin-confirmation');
const profile = require('../services/store-profile');
const router = express.Router();

router.use(adminRequired, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', (req, res) => res.json({ code: 200, data: profile.get() }));
router.put('/', (req, res) => {
  confirmAdmin(req);
  res.json({ code: 200, message: req.body.published ? '经营资料已发布' : '经营资料草稿已保存', data: profile.save.immediate(req.body) });
});

module.exports = router;
