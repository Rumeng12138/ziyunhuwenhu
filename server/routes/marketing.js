const express=require('express'),db=require('../config/db');
const {adminRequired}=require('../middleware/admin');
const {fail,cents}=require('../services/commerce');
const pricing=require('../services/pricing');
const router=express.Router();router.use(adminRequired,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const shippingRules=()=>db.prepare('SELECT * FROM shipping_rules ORDER BY sort_order ASC,id ASC').all().map(rule=>({...rule,regions:JSON.parse(rule.regions)}));
function shippingRuleValues(body,current={}){
  const name=String(body.name??current.name??'').trim();if(!name||name.length>80)fail('运费规则名称须为1至80字');
  const country=String(body.country??current.country??'*').trim();if(!country||country.length>60||/[\u0000-\u001f]/.test(country))fail('国家或地区须为1至60字，全球规则请填写 *');
  const rawRegions=body.regions??current.regions??[];
  const regions=(Array.isArray(rawRegions)?rawRegions:String(rawRegions).split(/[,，\n]/)).map(value=>String(value).trim()).filter(Boolean);
  if(regions.length>50||regions.some(region=>region.length>60||/[\u0000-\u001f]/.test(region)))fail('省州/地区最多50项，每项不超过60字');
  const mode=body.mode??current.mode??'flat';if(!['flat','threshold','free'].includes(mode))fail('运费模式无效');
  const feeCents=cents(body.fee??(current.fee_cents??0)/100),thresholdCents=cents(body.threshold??(current.threshold_cents??0)/100);
  const enabled=body.enabled===undefined?Boolean(current.enabled??true):body.enabled;if(typeof enabled!=='boolean')fail('规则启用状态无效');
  const sortOrder=body.sort_order===undefined?Number(current.sort_order||100):Number(body.sort_order);
  if(!Number.isSafeInteger(sortOrder)||sortOrder<1||sortOrder>9999)fail('规则优先级须为1至9999的整数');
  return {name,country,regions:[...new Set(regions)],mode,feeCents,thresholdCents,enabled,sortOrder};
}
router.get('/',(req,res)=>res.json({code:200,data:{shipping:pricing.shipping(),shipping_rules:shippingRules(),campaigns:db.prepare("SELECT c.*,(SELECT COUNT(*) FROM coupon_redemptions r JOIN orders o ON o.id=r.order_id WHERE r.campaign_id=c.id AND o.status!='cancelled') AS reserved_uses FROM marketing_campaigns c ORDER BY c.id DESC").all()}}));
router.put('/shipping',(req,res)=>{
  const {mode,fee,threshold}=req.body;if(!['flat','threshold','free'].includes(mode))fail('运费模式无效');
  const next={mode,fee:cents(fee)/100,threshold:cents(threshold)/100};
  db.prepare('UPDATE commerce_settings SET payload=? WHERE id=1').run(JSON.stringify(next));res.json({code:200,message:'运费规则已保存，仅影响新订单'});
});
router.post('/shipping-rules',(req,res)=>{
  const value=shippingRuleValues(req.body);
  const result=db.prepare('INSERT INTO shipping_rules(name,country,regions,mode,fee_cents,threshold_cents,enabled,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(value.name,value.country,JSON.stringify(value.regions),value.mode,value.feeCents,value.thresholdCents,value.enabled?1:0,value.sortOrder,new Date().toISOString());
  res.json({code:200,message:'地区运费规则已创建，仅影响新订单',data:{id:Number(result.lastInsertRowid)}});
});
router.put('/shipping-rules/:id',(req,res)=>{
  const current=db.prepare('SELECT * FROM shipping_rules WHERE id=?').get(req.params.id);if(!current)fail('地区运费规则不存在',404);
  const value=shippingRuleValues(req.body,{...current,regions:JSON.parse(current.regions)});
  db.prepare('UPDATE shipping_rules SET name=?,country=?,regions=?,mode=?,fee_cents=?,threshold_cents=?,enabled=?,sort_order=?,updated_at=? WHERE id=?')
    .run(value.name,value.country,JSON.stringify(value.regions),value.mode,value.feeCents,value.thresholdCents,value.enabled?1:0,value.sortOrder,new Date().toISOString(),current.id);
  res.json({code:200,message:'地区运费规则已更新，仅影响新订单'});
});
router.delete('/shipping-rules/:id',(req,res)=>{
  if(!db.prepare('DELETE FROM shipping_rules WHERE id=?').run(req.params.id).changes)fail('地区运费规则不存在',404);
  res.json({code:200,message:'地区运费规则已删除，仅影响新订单'});
});
function values(body) {
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)fail('活动名称须为1至80字');
  if(!['coupon','full_reduction','discount','free_shipping'].includes(body.type)||typeof body.enabled!=='boolean')fail('活动类型或启用状态无效');
  const min=cents(body.min_spend||0),discount=cents(body.discount||0);
  const rate=body.type==='discount'?Math.round(Number(body.rate)*1000):10000;
  if(body.type==='discount'&&(!Number.isFinite(Number(body.rate))||rate<1||rate>=10000))fail('折扣需大于0且小于10折');
  if(['coupon','full_reduction'].includes(body.type)&&discount<=0)fail('减免金额须大于0');
  const code=body.type==='coupon'?String(body.code||'').trim().toUpperCase():null;
  if(code&&!/^[A-Z0-9_-]{3,32}$/.test(code)||body.type==='coupon'&&!code)fail('优惠码须为3至32位字母、数字、横线或下划线');
  const ids=body.product_ids||[];if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1||!db.prepare('SELECT id FROM products WHERE id=?').get(id)))fail('适用商品ID无效');
  if(body.type!=='discount'&&ids.length)fail('仅商品折扣支持指定商品，其他活动适用于全单');
  const timestamp=value=>{if(value===null||value===undefined||value==='')return null;const n=typeof value==='number'?value:Date.parse(value);if(!Number.isSafeInteger(n)||n<0||n>8640000000000000)fail('活动时间无效');return n;};
  const start=timestamp(body.starts_at),end=timestamp(body.ends_at);if(start!==null&&end!==null&&end<=start)fail('结束时间必须晚于开始时间');
  const max=body.max_uses??0,per=body.per_user_limit??1;
  if(!Number.isSafeInteger(max)||max<0||max>1000000||!Number.isSafeInteger(per)||per<1||per>1000000)fail('优惠券数量与每人限用次数须为整数');
  return [body.name.trim(),body.type,body.enabled?1:0,code,min,discount,rate,JSON.stringify([...new Set(ids)]),start,end,max,per,new Date().toISOString()];
}
router.post('/campaigns',(req,res)=>{
  const v=values(req.body);if(v[3]&&db.prepare('SELECT id FROM marketing_campaigns WHERE code=?').get(v[3]))fail('优惠码已存在',409);
  const result=db.prepare('INSERT INTO marketing_campaigns(name,type,enabled,code,min_spend_cents,discount_cents,rate_bps,product_ids,starts_at,ends_at,max_uses,per_user_limit,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...v);
  res.json({code:200,data:{id:Number(result.lastInsertRowid)},message:'活动已创建'});
});
router.put('/campaigns/:id',(req,res)=>{
  const previous=db.prepare('SELECT * FROM marketing_campaigns WHERE id=?').get(req.params.id);if(!previous)fail('活动不存在',404);
  const v=values(req.body);
  if(previous.type!==v[1])fail('活动类型不可变更，请新建活动');
  if(v[3]&&db.prepare('SELECT id FROM marketing_campaigns WHERE code=? AND id<>?').get(v[3],req.params.id))fail('优惠码已存在',409);
  db.prepare('UPDATE marketing_campaigns SET name=?,type=?,enabled=?,code=?,min_spend_cents=?,discount_cents=?,rate_bps=?,product_ids=?,starts_at=?,ends_at=?,max_uses=?,per_user_limit=?,updated_at=? WHERE id=?').run(...v,req.params.id);
  res.json({code:200,message:'活动已保存，既有订单金额不变'});
});
router.put('/campaigns/:id/enabled',(req,res)=>{
  if(typeof req.body.enabled!=='boolean')fail('启用状态无效');
  if(!db.prepare('UPDATE marketing_campaigns SET enabled=?,updated_at=? WHERE id=?').run(req.body.enabled?1:0,new Date().toISOString(),req.params.id).changes)fail('活动不存在',404);
  res.json({code:200,message:req.body.enabled?'活动已启用':'活动已停用'});
});
module.exports=router;
