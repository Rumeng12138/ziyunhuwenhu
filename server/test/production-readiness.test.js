const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.DB_PATH=':memory:';
process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
require('../config/initDB');
const db=require('../config/db');
const express=require('express');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {securityHeaders}=require('../middleware/security');

test('production operations: profile publication, after-sales audit and upload hardening',async t=>{
  const app=express();app.use(securityHeaders);app.use(express.json());
  app.use('/api/after-sales',require('../routes/after-sales'));
  app.use('/api/admin/after-sales',require('../routes/admin-after-sales'));
  app.use('/api/admin/store-profile',require('../routes/store-profile'));
  app.use('/api/admin',require('../routes/admin'));
  app.use('/api/auth',require('../routes/auth'));
  app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.status||500,message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const userId=Number(db.prepare("INSERT INTO users(username,password,nickname) VALUES('ops-buyer',?,'运营买家')").run(bcrypt.hashSync('OldPassword123',10)).lastInsertRowid);
  const adminId=db.prepare('SELECT id FROM users WHERE is_admin=1').get().id;
  const token=id=>jwt.sign({id,session_version:db.prepare('SELECT session_version FROM users WHERE id=?').get(id).session_version},process.env.JWT_SECRET);
  async function request(url,{method='GET',body,id=userId,headers={}}={}){
    const response=await fetch(base+url,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(id?{Authorization:'Bearer '+token(id)}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  const productId=Number(db.prepare("INSERT INTO products(name,category,price,stock) VALUES('售后测试商品','pen',120,10)").run().lastInsertRowid);
  const orderId=Number(db.prepare(`INSERT INTO orders(order_no,user_id,total_amount,receiver_name,receiver_phone,receiver_address,status,payment_method,payment_transaction_id,paid_at)
    VALUES('OPS-PAID',?,120,'买家','13800138000','测试地址','paid','alipay','trade-paid',datetime('now','localtime'))`).run(userId).lastInsertRowid);
  db.prepare("INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES(?,?,?,120,1)").run(orderId,productId,'售后测试商品');

  await t.test('confirmed storefront footer and policy settings are seeded and published',async()=>{
    const profile=await request('/admin/store-profile',{id:adminId});
    assert.equal(profile.status,200);
    const expected={
      display_name:'紫云湖文房商城',store_description:'以笔会友，以文会友',legal_name:'紫云湖笔庄',
      contact_phone:'13621294733',contact_email:'1968278027@qq.com',business_address:'北京紫云湖',
      service_hours:'9：00-18：00',icp_no:'2026.09.01.00',privacy_policy:'客户信息隐私',
      terms_of_service:'以笔会友，以文会友',return_policy:'7天无理由(定制类不支持)',shipping_policy:'正常物流运费，加急另算',
    };
    for(const [field,value] of Object.entries(expected))assert.equal(profile.body.data[field],value,field);
    assert.equal(profile.body.data.published,true);
    assert.equal(profile.body.data.profile_seed_version,3);
  });

  await t.test('readiness reports homepage decoration separately from store profile publication',()=>{
    const readiness=require('../services/readiness');
    let check=readiness.report().checks.find(item=>item.id==='homepage_content');
    assert.equal(check.ok,true);
    db.prepare('UPDATE store_profile SET published=0 WHERE id=1').run();
    const report=readiness.report();
    assert.equal(report.checks.find(item=>item.id==='store_profile').ok,false);
    assert.equal(report.checks.find(item=>item.id==='homepage_content').ok,true);
    const publicProfile=require('../services/store-profile').publicProfile();
    assert.equal(publicProfile.published,false);
    assert.equal(publicProfile.contact_phone,'13621294733');
    assert.equal(require('../services/editorial-content').publicContent().sections.length,5);
    db.prepare('UPDATE store_profile SET published=1 WHERE id=1').run();
    check=readiness.report().checks.find(item=>item.id==='homepage_content');
    assert.equal(check.ok,true);
    db.prepare("UPDATE editorial_sections SET published=0 WHERE section_key='brand_story'").run();
    check=readiness.report().checks.find(item=>item.id==='homepage_content');
    assert.equal(check.ok,false);assert.match(check.message,/品牌故事/);
    db.prepare("UPDATE editorial_sections SET published=1 WHERE section_key='brand_story'").run();
  });

  await t.test('security headers and profile publication require complete, versioned real data',async()=>{
    const get=await request('/admin/store-profile',{id:adminId});
    assert.equal(get.status,200);assert.equal(get.headers.get('x-content-type-options'),'nosniff');assert.equal(get.headers.get('x-frame-options'),'DENY');
    const missing=await request('/admin/store-profile',{method:'PUT',id:adminId,body:{...get.body.data,privacy_policy:'',published:true,admin_password:'admin123'}});
    assert.equal(missing.status,400);
    const complete={...get.body.data,display_name:'测试文房商城',store_description:'测试店铺简介',legal_name:'测试经营主体有限公司',contact_phone:'0559-1234567',contact_email:'service@example.test',business_address:'安徽省测试地址',service_hours:'工作日 9:00-18:00',privacy_policy:'仅为履行订单处理必要信息。',terms_of_service:'用户下单前应核对商品、金额和地址。',return_policy:'符合公示条件的订单可提交售后申请。',shipping_policy:'付款核实后按订单显示的承运方式发货。',invoice_policy:'开票能力以下单时公示为准。',published:true,admin_password:'admin123'};
    const saved=await request('/admin/store-profile',{method:'PUT',id:adminId,body:complete});
    assert.equal(saved.status,200);assert.equal(saved.body.data.published,true);
    const stale=await request('/admin/store-profile',{method:'PUT',id:adminId,body:complete});assert.equal(stale.status,409);
    assert.equal(require('../services/store-profile').publicProfile().legal_name,'测试经营主体有限公司');
    assert.equal(require('../services/store-profile').publicProfile().store_description,'测试店铺简介');
  });

  await t.test('after-sales only accepts verified paid orders and prevents duplicate active claims',async()=>{
    const created=await request('/after-sales',{method:'POST',body:{order_id:orderId,type:'return_refund',reason:'商品破损',description:'外包装完好，商品有破损',requested_amount:120}});
    assert.equal(created.status,200);assert.equal(created.body.data.status,'pending');
    assert.equal((await request('/after-sales',{method:'POST',body:{order_id:orderId,type:'refund',reason:'重复申请',requested_amount:10}})).status,409);
    const unverified=Number(db.prepare("INSERT INTO orders(order_no,user_id,total_amount,receiver_name,receiver_phone,receiver_address,status) VALUES('OPS-PENDING',?,10,'买家','13800138000','测试地址','pending')").run(userId).lastInsertRowid);
    assert.equal((await request('/after-sales',{method:'POST',body:{order_id:unverified,type:'refund',reason:'未付款申请',requested_amount:10}})).status,409);
  });

  await t.test('refund completion requires an administrator-confirmed external refund reference and updates net revenue',async()=>{
    const claim=db.prepare('SELECT id FROM after_sales WHERE order_id=?').get(orderId).id;
    assert.equal((await request('/admin/after-sales/'+claim+'/status',{method:'PUT',id:adminId,body:{status:'approved',admin_note:'同意退货退款'}})).status,200);
    const bad=await request('/admin/after-sales/'+claim+'/refund-record',{method:'POST',id:adminId,body:{amount:120,external_reference:'refund-001',admin_password:'wrong',note:'平台退款'}});assert.equal(bad.status,403);
    const done=await request('/admin/after-sales/'+claim+'/refund-record',{method:'POST',id:adminId,body:{amount:120,external_reference:'refund-001',admin_password:'admin123',note:'已在原渠道退款'}});
    assert.equal(done.status,200);assert.equal(done.body.data.status,'completed');
    assert.equal(db.prepare('SELECT refunded_amount FROM orders WHERE id=?').get(orderId).refunded_amount,120);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM after_sale_audit WHERE after_sale_id=?').get(claim).count,3);
    const dashboard=await request('/admin/dashboard',{id:adminId});assert.equal(dashboard.body.data.grossRevenue,120);assert.equal(dashboard.body.data.totalRefunds,120);assert.equal(dashboard.body.data.totalRevenue,0);
  });

  await t.test('product upload rejects HTML renamed as an image',async()=>{
    const form=new FormData();form.append('file',new Blob(['<script>alert(1)</script>'],{type:'image/jpeg'}),'fake.jpg');
    const result=await request('/admin/upload',{method:'POST',id:adminId,body:form});assert.equal(result.status,400);assert.match(result.body.message,/文件内容不是/);
  });
  await t.test('buyer password change revokes the previous session',async()=>{
    const oldToken=token(userId);
    const changed=await request('/auth/password',{method:'PUT',body:{current_password:'OldPassword123',new_password:'NewPassword123'}});assert.equal(changed.status,200);
    const old=await fetch(base+'/auth/profile',{headers:{Authorization:'Bearer '+oldToken}});assert.equal(old.status,401);
    const login=await request('/auth/login',{method:'POST',id:null,body:{username:'ops-buyer',password:'NewPassword123'}});assert.equal(login.status,200);
  });
});
