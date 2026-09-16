const crypto=require('node:crypto');
const db=require('../config/db');
const {fail,cents,quantity}=require('./commerce');
const shipping=()=>JSON.parse(db.prepare('SELECT payload FROM commerce_settings WHERE id=1').get().payload);
const active=()=>db.prepare('SELECT * FROM marketing_campaigns WHERE enabled=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) ORDER BY id').all(Date.now(),Date.now());
const countryAliases=new Map([
  ['cn','cn'],['china','cn'],['prc','cn'],['中国','cn'],['中国大陆','cn'],
  ['us','us'],['usa','us'],['unitedstates','us'],['美国','us'],
  ['gb','gb'],['uk','gb'],['unitedkingdom','gb'],['英国','gb'],
  ['ca','ca'],['canada','ca'],['加拿大','ca'],['au','au'],['australia','au'],['澳大利亚','au'],
  ['jp','jp'],['japan','jp'],['日本','jp'],['kr','kr'],['southkorea','kr'],['韩国','kr'],
  ['sg','sg'],['singapore','sg'],['新加坡','sg'],['de','de'],['germany','de'],['德国','de'],
  ['fr','fr'],['france','fr'],['法国','fr'],
]);
const locationKey=value=>String(value||'').trim().toLocaleLowerCase().replace(/[\s._-]+/g,'');
const countryKey=value=>countryAliases.get(locationKey(value))||locationKey(value);
function normalizeShippingAddress(body={}){
  const source=body.shipping_address&&typeof body.shipping_address==='object'?body.shipping_address:body;
  return {
    country:String(source.country??source.receiver_country??'').trim(),
    province:String(source.province??source.receiver_province??'').trim(),
    city:String(source.city??source.receiver_city??'').trim(),
    district:String(source.district??source.receiver_district??'').trim(),
  };
}
function selectedShippingRule(address){
  const rules=db.prepare('SELECT * FROM shipping_rules WHERE enabled=1 ORDER BY sort_order ASC,id ASC').all();
  const addressCountry=countryKey(address.country),parts=[address.province,address.city,address.district].map(locationKey).filter(Boolean);
  return rules.filter(rule=>{
    const ruleCountry=String(rule.country||'').trim();
    if(ruleCountry!=='*'&&(!addressCountry||countryKey(ruleCountry)!==addressCountry))return false;
    const regions=JSON.parse(rule.regions||'[]').map(locationKey).filter(Boolean);
    return !regions.length||regions.some(region=>parts.some(part=>part===region||part.includes(region)||region.includes(part)));
  }).sort((a,b)=>{
    const aRegions=JSON.parse(a.regions||'[]').length>0?1:0,bRegions=JSON.parse(b.regions||'[]').length>0?1:0;
    const aCountry=a.country==='*'?0:1,bCountry=b.country==='*'?0:1;
    return bRegions-aRegions||bCountry-aCountry||a.sort_order-b.sort_order||a.id-b.id;
  })[0]||null;
}
function shippingFor(body={}){
  const address=normalizeShippingAddress(body),rule=selectedShippingRule(address),fallback=shipping();
  return {address,rule,config:rule?{mode:rule.mode,fee:rule.fee_cents/100,threshold:rule.threshold_cents/100}:fallback};
}
function publicOffers() {
  return {shipping:shipping(),campaigns:active().filter(c=>c.type!=='coupon').map(c=>({id:c.id,name:c.name,type:c.type,min_spend:c.min_spend_cents/100,discount:c.discount_cents/100,rate:c.rate_bps/1000,product_ids:JSON.parse(c.product_ids),ends_at:c.ends_at}))};
}
function quote(userId,body={}) {
  const requested=body.items===undefined ? db.prepare('SELECT product_id,quantity FROM cart_items WHERE user_id=?').all(userId) : body.items;
  if(!Array.isArray(requested)||!requested.length||requested.length>100)fail('购物车为空或商品数量不合法');
  const combined=new Map();
  for(const item of requested){if(!item||!Number.isSafeInteger(item.product_id)||item.product_id<1)fail('商品ID无效');quantity(item.quantity);combined.set(item.product_id,quantity((combined.get(item.product_id)||0)+item.quantity));}
  const campaigns=active();let original=0,subtotal=0;
  const benefit=require('./membership').pricingBenefit(userId);
  const labels=new Set();
  const items=[...combined].sort((a,b)=>a[0]-b[0]).map(([id,qty])=>{
    const product=db.prepare('SELECT * FROM products WHERE id=? AND status=1').get(id);
    if(!product)fail('商品不存在或已下架');if(product.stock<qty)fail(product.name+' 库存不足，当前可购 '+product.stock+' 件',409);
    const originalPrice=cents(product.price);if(originalPrice<=0)fail('商品价格无效');
    let price=Math.max(1,Math.round(originalPrice*benefit.member_discount)),best=null;
    for(const c of campaigns.filter(c=>c.type==='discount')){
      const ids=JSON.parse(c.product_ids);if(ids.length&&!ids.includes(id))continue;
      const candidate=Math.max(1,Math.round(originalPrice*c.rate_bps/10000));
      if(candidate<price){price=candidate;best=c;}
    }
    if(best)labels.add(best.name);
    else if(price<originalPrice)labels.add('会员价');
    original+=originalPrice*qty;subtotal+=price*qty;
    return {...product,quantity:qty,price:price/100,original_price:originalPrice/100};
  });
  if(!Number.isSafeInteger(original)||original>10000000000)fail('订单金额超出范围');
  let reduction=0;
  const full=campaigns.filter(c=>c.type==='full_reduction'&&subtotal>=c.min_spend_cents).sort((a,b)=>b.discount_cents-a.discount_cents||a.id-b.id)[0];
  if(full){reduction=Math.min(full.discount_cents,Math.max(0,subtotal-1));if(reduction)labels.add(full.name);}
  let coupon=null,couponDiscount=0;
  if(body.coupon_code!==undefined&&typeof body.coupon_code!=='string')fail('优惠码格式错误');
  const code=(body.coupon_code||'').trim().toUpperCase();
  if(code){
    if(!/^[A-Z0-9_-]{3,32}$/.test(code))fail('优惠码应为3至32位字母、数字、横线或下划线');
    coupon=campaigns.find(c=>c.type==='coupon'&&c.code===code);
    if(!coupon)fail('优惠券不存在、未启用或已过期');
    if(subtotal-reduction<coupon.min_spend_cents)fail('优惠券未达到使用门槛');
    const usage=db.prepare("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN r.user_id=? THEN 1 ELSE 0 END),0) mine FROM coupon_redemptions r JOIN orders o ON o.id=r.order_id WHERE r.campaign_id=? AND o.status!='cancelled'").get(userId,coupon.id);
    if((coupon.max_uses&&usage.total>=coupon.max_uses)||usage.mine>=coupon.per_user_limit)fail('优惠券已用完或已达到每人使用次数',409);
    couponDiscount=Math.min(coupon.discount_cents,Math.max(0,subtotal-reduction-1));labels.add(coupon.name);
  }
  const goods=subtotal-reduction-couponDiscount,shippingSelection=shippingFor(body),config=shippingSelection.config;let freight=cents(config.fee),freeReason='';
  if(config.mode==='free'){freight=0;freeReason='全场包邮';}
  else if(config.mode==='threshold'&&goods>=cents(config.threshold)){freight=0;freeReason='满额包邮';}
  const free=campaigns.find(c=>c.type==='free_shipping'&&goods>=c.min_spend_cents);
  if(free){freight=0;freeReason=free.name;labels.add(free.name);}
  if(goods+freight>10000000000)fail('订单金额超出范围');
  const result={items,...benefit,subtotal_amount:original/100,promotion_discount:(original-subtotal)/100,full_reduction_discount:reduction/100,coupon_discount:couponDiscount/100,
    goods_amount:goods/100,freight:freight/100,total_amount:(goods+freight)/100,coupon_code:code||null,coupon_id:coupon?.id||null,applied:[...labels],free_shipping_reason:freeReason,
    shipping_rule_id:shippingSelection.rule?.id||null,shipping_rule_name:shippingSelection.rule?.name||'默认运费规则',shipping_destination:shippingSelection.address};
  result.quote_hash=crypto.createHash('sha256').update(JSON.stringify({...result,items:items.map(i=>({id:i.id,quantity:i.quantity,price:i.price,original_price:i.original_price}))})).digest('hex');
  return result;
}
module.exports={shipping,shippingFor,active,quote,publicOffers};
