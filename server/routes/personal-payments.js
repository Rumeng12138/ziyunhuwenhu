const express=require('express');
const multer=require('multer');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const db=require('../config/db');
const {uploadDir}=require('../config/storage');
const {adminRequired}=require('../middleware/admin');
const confirmAdmin=require('../services/admin-confirmation');
const personal=require('../services/personal-payments');
const {fail}=require('../services/commerce');
const router=express.Router();
router.use(adminRequired,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',(req,res)=>res.json({code:200,data:personal.settings()}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:1}});
router.post('/qr',upload.single('file'),(req,res)=>{
  confirmAdmin(req);
  const bytes=req.file?.buffer;
  let ext;
  if (bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
  else if (bytes?.[0]===255 && bytes?.[1]===216 && bytes?.[2]===255) ext='jpg';
  else fail('收款码只接受 PNG / JPG 图片');
  const filename='personal-'+crypto.randomUUID()+'.'+ext;
  fs.mkdirSync(uploadDir,{recursive:true});
  fs.writeFileSync(path.join(uploadDir,filename),bytes,{flag:'wx'});
  res.json({code:200,data:{url:'/uploads/'+filename},message:'图片已上传，请核对后保存渠道设置'});
});
router.put('/:channel',(req,res)=>{
  confirmAdmin(req);const channel=req.params.channel;
  if (!personal.isPersonal(channel)) fail('普通收款渠道无效');
  const input=req.body;
  if (typeof input.enabled!=='boolean') fail('请选择是否启用');
  const recipient=personal.shortText(input.recipient||'',60,'收款人名称');
  const instructions=personal.shortText(input.instructions||'',300,'收款说明');
  if (!personal.qrExists(input.qr_url)) fail('请选择本站已上传的有效收款码');
  // Existing orders retain their immutable QR/recipient snapshot even after a later configuration change.
  db.prepare("UPDATE personal_payment_settings SET enabled=?,qr_url=?,recipient=?,instructions=?,updated_at=datetime('now','localtime') WHERE channel=?").run(input.enabled?1:0,input.qr_url,recipient,instructions,channel);
  res.json({code:200,message:'普通收款设置已保存；付款须由管理员人工核实'});
});
router.post('/orders/:id/review',(req,res)=>{
  confirmAdmin(req);
  const result=personal.review.immediate(req.params.id,req.admin.id,req.body);
  res.json({code:200,data:result,message:req.body.decision==='confirm'?'已记录人工核实到账（非支付平台自动验证）':req.body.decision==='cancel'?'订单已取消，库存已恢复':'已退回待支付，请买家核对转账'});
});
router.use((err,req,res,next)=>{if(err instanceof multer.MulterError)return res.status(400).json({code:400,message:'收款码图片不能超过5MB，且每次只能上传一张'});next(err);});
module.exports=router;
