const express = require('express');
const db = require('../config/db');
const { authRequired } = require('../middleware/auth');
const pagination = require('../services/pagination');
const service = require('../services/after-sales');
const router = express.Router();

router.use(authRequired, (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.get('/', (req,res) => {
  const { page, pageSize, offset } = pagination(req.query, 10);
  const total = db.prepare('SELECT COUNT(*) count FROM after_sales WHERE user_id=?').get(req.user.id).count;
  const list = db.prepare(`SELECT a.*,o.order_no,o.total_amount FROM after_sales a JOIN orders o ON o.id=a.order_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(req.user.id,pageSize,offset);
  res.json({code:200,data:{list,total,page,pageSize}});
});
router.get('/:id',(req,res)=>res.json({code:200,data:service.detail(req.params.id,req.user.id)}));
router.post('/',(req,res)=>res.json({code:200,message:'售后申请已提交',data:service.create.immediate(req.user.id,req.body)}));
router.put('/:id/cancel',(req,res)=>res.json({code:200,message:'售后申请已撤销',data:service.cancel.immediate(req.params.id,req.user.id)}));
router.put('/:id/shipment',(req,res)=>res.json({code:200,message:'退货物流已保存',data:service.shipment.immediate(req.params.id,req.user.id,req.body)}));
module.exports=router;
