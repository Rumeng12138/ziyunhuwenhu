const express = require('express');
const { adminRequired } = require('../middleware/admin');
const membership = require('../services/membership');
const router = express.Router();
router.use(adminRequired, (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.get('/', (req,res) => res.json({code:200,data:membership.features()}));
router.put('/', (req,res) => res.json({code:200,message:'设置已保存，已有积分和订单保留',data:membership.save.immediate(req.body)}));
module.exports = router;
