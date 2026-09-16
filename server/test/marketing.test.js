const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.DB_PATH=':memory:';
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
require('../config/initDB');
const db=require('../config/db'),pricing=require('../services/pricing');
const jwt=require('jsonwebtoken'),express=require('express');

test('server protects default-password admin from foreign origins while allowing local existing-password login',async t=>{
  const net=require('node:net'),{spawn}=require('node:child_process'),path=require('node:path');
  const reserve=net.createServer().listen(0,'127.0.0.1');
  await new Promise(r=>reserve.once('listening',r));const port=reserve.address().port;
  await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,DB_PATH:':memory:',PORT:String(port),NODE_ENV:'development'},stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Temporary test server did not start')),10000);
    child.stdout.on('data',data=>{if(data.toString().includes('服务已启动')){clearTimeout(timer);resolve();}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);if(code!==null)reject(Error('Temporary server exited '+code));});
  });
  const url='http://127.0.0.1:'+port+'/api/admin/login';
  const body=JSON.stringify({username:'admin',password:'admin123'});
  const local=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:'+port},body});
  assert.equal(local.status,200);
  for(const origin of ['https://untrusted.example','http://localhost:1']){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body});
    assert.equal(response.status,403);
  }
  const rebound=await new Promise((resolve,reject)=>{
    const req=require('node:http').request(url,{method:'POST',headers:{'Content-Type':'application/json',Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end(body);
  });
  assert.equal(rebound,403);
});

test('marketing: server quotes, reservations, snapshots and ordering',async t=>{
  const app=express();app.use(express.json());
  for(const [url,file]of [['admin/marketing','marketing'],['admin','admin'],['orders','orders'],['products','products'],['addresses','address']])app.use('/api/'+url,require('../routes/'+file));
  app.use((e,req,res,next)=>res.status(e.status||500).json({code:e.status||500,message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const admin=db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  const buyer=Number(db.prepare("INSERT INTO users(username,password) VALUES('marketing-buyer','unused')").run().lastInsertRowid);
  const other=Number(db.prepare("INSERT INTO users(username,password) VALUES('marketing-other','unused')").run().lastInsertRowid);
  const product=(price=100)=>Number(db.prepare("INSERT INTO products(name,category,price,stock) VALUES('活动测试商品','pen',?,100)").run(price).lastInsertRowid);
  const request=async(url,method='GET',body,uid=admin)=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(uid?{Authorization:'Bearer '+jwt.sign({id:uid},process.env.JWT_SECRET)}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const campaign=async(type,extra={})=>{const r=await request('/admin/marketing/campaigns','POST',{name:'测试'+type,type,enabled:true,min_spend:0,discount:10,rate:8,code:'TEST_'+crypto.randomBytes(3).toString('hex'),...extra});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data.id;};
  const items=(id,quantity=1)=>[{product_id:id,quantity}];
  const orderBody=(id,extra={})=>({items:items(id),receiver_name:'测试买家',receiver_phone:'13800138000',receiver_address:'测试省测试市测试路1号',...extra});
  const shipping=async(mode,fee=12,threshold=199)=>{const r=await request('/admin/marketing/shipping','PUT',{mode,fee,threshold});assert.equal(r.status,200);};
  t.beforeEach(()=>{db.prepare('UPDATE marketing_campaigns SET enabled=0').run();db.prepare('DELETE FROM shipping_rules').run();db.prepare('UPDATE commerce_settings SET payload=? WHERE id=1').run(JSON.stringify({mode:'threshold',fee:12,threshold:199}));});
  await t.test('management requires administrator and validates money, schedules, discounts and coupon codes',async()=>{
    assert.equal((await request('/admin/marketing','GET',undefined,null)).status,401);
    assert.equal((await request('/admin/marketing','GET',undefined,buyer)).status,403);
    for(const fee of [-1,'1.001',null,'NaN'])assert.equal((await request('/admin/marketing/shipping','PUT',{mode:'flat',fee,threshold:0})).status,400);
    assert.equal((await request('/admin/marketing/shipping','PUT',{mode:'unknown',fee:1,threshold:0})).status,400);
    const valid={name:'测试',type:'coupon',enabled:true,code:'CHECK',discount:10,min_spend:100};
    for(const changes of [{code:'x'},{discount:0},{ends_at:'bad'},{starts_at:200,ends_at:100},{max_uses:1.5},{per_user_limit:0},{product_ids:[999999]},{enabled:'true'},{type:'discount',rate:10}])
      assert.equal((await request('/admin/marketing/campaigns','POST',{...valid,...changes})).status,400);
    const id=await campaign('coupon',{code:'CHECK'});
    assert.equal((await request('/admin/marketing/campaigns','POST',valid)).status,409);
    assert.equal((await request('/admin/marketing/campaigns/'+id,'PUT',{...valid,type:'full_reduction'})).status,400);
    assert.equal((await request('/admin/marketing/campaigns/'+id+'/enabled','PUT',{enabled:false})).status,200);
    assert.ok(!(await request('/admin/marketing')).body.data.campaigns.find(c=>c.id===id).enabled);
  });
  await t.test('flat fee, free shipping, threshold and campaign boundary are calculated after discounts',async()=>{
    const id=product(199);
    assert.equal(pricing.quote(buyer,{items:items(id)}).freight,0);
    await shipping('flat',7.5);assert.equal(pricing.quote(buyer,{items:items(id)}).freight,7.5);
    await shipping('free');assert.equal(pricing.quote(buyer,{items:items(id)}).freight,0);
    await shipping('threshold',12,199);
    await campaign('coupon',{code:'SHIP',discount:1});
    let q=pricing.quote(buyer,{items:items(id),coupon_code:'SHIP'});assert.equal(q.goods_amount,198);assert.equal(q.freight,12);assert.equal(q.total_amount,210);
    await campaign('free_shipping',{min_spend:198,name:'满198包邮'});
    q=pricing.quote(buyer,{items:items(id),coupon_code:'SHIP'});assert.equal(q.freight,0);assert.equal(q.free_shipping_reason,'满198包邮');
  });
  await t.test('country and regional shipping rules quote by address and are snapshotted on orders',async()=>{
    const id=product(100);
    const addRule=async body=>{
      const result=await request('/admin/marketing/shipping-rules','POST',body);
      assert.equal(result.status,200,JSON.stringify(result.body));return result.body.data.id;
    };
    assert.equal((await request('/admin/marketing/shipping-rules','POST',{name:'越权',country:'*',regions:[],mode:'flat',fee:1,threshold:0,sort_order:1,enabled:true},buyer)).status,403);
    assert.equal((await request('/admin/marketing/shipping-rules','POST',{name:'坏规则',country:'CN',regions:[],mode:'flat',fee:-1,threshold:0,sort_order:1,enabled:true})).status,400);
    await addRule({name:'全球配送',country:'*',regions:[],mode:'flat',fee:99,threshold:0,sort_order:1,enabled:true});
    await addRule({name:'中国大陆',country:'CN',regions:[],mode:'threshold',fee:12,threshold:199,sort_order:10,enabled:true});
    const beijingRule=await addRule({name:'北京专线',country:'中国',regions:['北京市'],mode:'flat',fee:6,threshold:0,sort_order:999,enabled:true});
    await addRule({name:'美国配送',country:'US',regions:[],mode:'flat',fee:68,threshold:0,sort_order:20,enabled:true});
    const quote=(address)=>pricing.quote(buyer,{items:items(id),shipping_address:address});
    assert.equal(quote({country:'CN',province:'北京',city:'北京市'}).freight,6);
    assert.equal(quote({country:'中国',province:'安徽省',city:'黄山市'}).freight,12);
    assert.equal(quote({country:'United States',province:'California',city:'San Francisco'}).freight,68);
    assert.equal(quote({country:'日本',province:'东京都',city:'东京'}).freight,99);
    const savedAddress=await request('/addresses','POST',{name:'Overseas Buyer',phone:'+1 (415) 555-0134',country:'US',province:'California',city:'San Francisco',district:'',detail:'1 Market St'},buyer);
    assert.equal(savedAddress.status,200);
    assert.equal((await request('/addresses','GET',undefined,buyer)).body.data[0].country,'US');
    const apiQuote=(await request('/orders/quote','POST',{items:items(id),shipping_address:{country:'中国',province:'北京市',city:'北京市',district:'朝阳区'}},buyer)).body.data;
    assert.equal(apiQuote.shipping_rule_id,beijingRule);assert.equal(apiQuote.shipping_rule_name,'北京专线');assert.equal(apiQuote.freight,6);
    const order=(await request('/orders','POST',orderBody(id,{receiver_country:'中国',receiver_province:'北京市',receiver_city:'北京市',receiver_district:'朝阳区',quote_hash:apiQuote.quote_hash}),buyer)).body.data;
    assert.equal(order.freight,6);assert.equal(order.shipping_rule_id,beijingRule);assert.equal(order.shipping_rule_name,'北京专线');
    await request('/admin/marketing/shipping-rules/'+beijingRule,'DELETE');
    const saved=(await request('/orders/'+order.id,'GET',undefined,buyer)).body.data;
    assert.equal(saved.freight,6);assert.equal(saved.shipping_rule_name,'北京专线');
  });
  await t.test('best item promotion then best full reduction then one coupon with penny-safe rounding',async()=>{
    const id=product(),excluded=product();
    await campaign('discount',{rate:9});await campaign('discount',{rate:8,product_ids:[id]});
    await campaign('full_reduction',{min_spend:150,discount:10});await campaign('full_reduction',{min_spend:150,discount:20});
    await campaign('coupon',{code:'STACK',min_spend:140,discount:15});
    const q=pricing.quote(buyer,{items:items(id,2),coupon_code:'stack',total_amount:0.01});
    assert.equal(q.subtotal_amount,200);assert.equal(q.promotion_discount,40);assert.equal(q.full_reduction_discount,20);assert.equal(q.coupon_discount,15);assert.equal(q.total_amount,137);
    assert.equal(q.items[0].price,80);assert.equal(pricing.quote(buyer,{items:items(excluded)}).items[0].price,90);
    const tiny=product(0.03);assert.equal(pricing.quote(buyer,{items:items(tiny,3)}).goods_amount,0.09);
    await campaign('full_reduction',{min_spend:0,discount:1000});assert.equal(pricing.quote(buyer,{items:items(tiny,3)}).goods_amount,0.01);
  });
  await t.test('expired, future, disabled, unknown or below-minimum coupons reject checkout',async()=>{
    const id=product();
    await campaign('coupon',{code:'EXPIRED',ends_at:Date.now()-1});
    await campaign('coupon',{code:'FUTURE',starts_at:Date.now()+60000});
    await campaign('coupon',{code:'DISABLED',enabled:false});
    await campaign('coupon',{code:'MINIMUM',min_spend:200});
    for(const code of ['EXPIRED','FUTURE','DISABLED','MISSING','MINIMUM','!'])
      assert.equal((await request('/orders','POST',orderBody(id,{coupon_code:code}),buyer)).status,400);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock,100);
    assert.equal(pricing.publicOffers().campaigns.some(c=>c.type==='coupon'),false);
  });
  await t.test('last coupon reservation is atomic, idempotent and released on cancellation',async()=>{
    const id=product();await campaign('coupon',{code:'LAST',max_uses:1,per_user_limit:2});
    const body=orderBody(id,{coupon_code:'LAST',checkout_key:crypto.randomUUID()});
    const results=await Promise.all([request('/orders','POST',body,buyer),request('/orders','POST',{...body,checkout_key:crypto.randomUUID()},other)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const winner=results.findIndex(r=>r.status===200),uid=winner===0?buyer:other,order=results[winner].body.data;
    const replay=await request('/orders','POST',{...body,checkout_key:order.checkout_key},uid);
    assert.equal(replay.body.data.id,order.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE order_id=?').get(order.id).n,1);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock,99);
    assert.equal((await request('/orders/'+order.id+'/cancel','PUT',{},uid)).status,200);
    assert.equal((await request('/orders','POST',orderBody(id,{coupon_code:'LAST'}),buyer)).status,200);
  });
  await t.test('per-user limit includes pending and manual review orders',async()=>{
    const id=product();await campaign('coupon',{code:'PERUSER',max_uses:0,per_user_limit:1});
    const order=(await request('/orders','POST',orderBody(id,{coupon_code:'PERUSER'}),buyer)).body.data;
    db.prepare("UPDATE orders SET status='payment_review' WHERE id=?").run(order.id);
    assert.equal((await request('/orders/quote','POST',{items:items(id),coupon_code:'PERUSER'},buyer)).status,409);
    assert.equal((await request('/orders/quote','POST',{items:items(id),coupon_code:'PERUSER'},other)).status,200);
  });
  await t.test('quote changes require reconfirmation and committed amounts remain immutable',async()=>{
    const id=product();
    const q=(await request('/orders/quote','POST',{items:items(id)},buyer)).body.data;
    await shipping('flat',20);
    assert.equal((await request('/orders','POST',orderBody(id,{quote_hash:q.quote_hash}),buyer)).status,409);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock,100);
    const c=await campaign('coupon',{code:'SNAPSHOT',discount:10});
    const fresh=(await request('/orders/quote','POST',{items:items(id),coupon_code:'SNAPSHOT'},buyer)).body.data;
    const order=(await request('/orders','POST',orderBody(id,{quote_hash:fresh.quote_hash,coupon_code:'SNAPSHOT',total_amount:0.01,freight:0,coupon_discount:99}),buyer)).body.data;
    assert.equal(order.total_amount,110);assert.equal(order.coupon_discount,10);
    await shipping('free');db.prepare('UPDATE marketing_campaigns SET discount_cents=9000 WHERE id=?').run(c);
    const saved=(await request('/orders/'+order.id,'GET',undefined,buyer)).body.data;
    assert.equal(saved.total_amount,110);assert.equal(saved.freight,20);assert.equal(JSON.parse(saved.pricing_snapshot).coupon_discount,10);
  });
  await t.test('editable sorting precedes pagination without changing product primary IDs',async()=>{
    const first=product(),second=product();
    const secondPosition=db.prepare('SELECT sort_order FROM products WHERE id=?').get(second).sort_order;
    assert.equal((await request('/admin/products/'+second+'/sort','PUT',{sort_order:1,expected_sort_order:secondPosition},buyer)).status,403);
    assert.equal((await request('/admin/products/'+second+'/sort','PUT',{sort_order:1,expected_sort_order:secondPosition})).status,200);
    assert.equal((await request('/admin/products/'+second+'/sort','PUT',{sort_order:2,expected_sort_order:secondPosition})).status,409);
    const total=db.prepare('SELECT COUNT(*) count FROM products').get().count;
    const firstPosition=db.prepare('SELECT sort_order FROM products WHERE id=?').get(first).sort_order;
    for(const n of [0,-1,1.5,'3',total+1])assert.equal((await request('/admin/products/'+first+'/sort','PUT',{sort_order:n,expected_sort_order:firstPosition})).status,400);
    for(const route of ['/products?pageSize=1','/products/search?q=活动&pageSize=1','/admin/products?pageSize=1']){
      const r=await request(route);assert.equal(r.status,200);assert.equal(r.body.data.list[0].id,second);
    }
    assert.ok(db.prepare('SELECT id FROM products WHERE id=?').get(first));
    assert.deepEqual(db.prepare('SELECT sort_order FROM products ORDER BY sort_order,id').all().map(row=>row.sort_order),Array.from({length:total},(_,index)=>index+1));
    assert.equal((await request('/admin/products/'+first+'/sort','PUT',{sort_order:total,expected_sort_order:firstPosition})).status,200);
    const added=await request('/admin/products','POST',{name:'最大排序号后的新商品',category:'pen',price:10,stock:1,status:1});
    assert.equal(added.status,200);
    const addedId=added.body.data.id;
    assert.equal(db.prepare('SELECT sort_order FROM products WHERE id=?').get(addedId).sort_order,total+1);
    assert.equal((await request('/admin/products/'+addedId+'/sort','PUT',{sort_order:1,expected_sort_order:total+1})).status,200);
    assert.deepEqual(db.prepare('SELECT sort_order FROM products ORDER BY sort_order,id').all().map(row=>row.sort_order),Array.from({length:total+1},(_,index)=>index+1));
  });
  await t.test('listing time is recorded on create, edit and relisting',async()=>{
    const draft=await request('/admin/products','POST',{name:'待上架商品',category:'pen',price:10,stock:1,status:0});
    const id=draft.body.data.id;
    assert.equal(db.prepare('SELECT listed_at FROM products WHERE id=?').get(id).listed_at,null);
    assert.equal((await request('/admin/products/'+id,'PUT',{status:1})).status,200);
    const first=db.prepare('SELECT status,listed_at FROM products WHERE id=?').get(id);
    assert.equal(first.status,1);assert.ok(first.listed_at);
    db.prepare("UPDATE products SET listed_at='2000-01-01 00:00:00' WHERE id=?").run(id);
    assert.equal((await request('/admin/products/'+id+'/toggle','PUT',{})).body.data.status,0);
    const relisted=await request('/admin/products/'+id+'/toggle','PUT',{});
    assert.equal(relisted.body.data.status,1);assert.notEqual(relisted.body.data.listed_at,'2000-01-01 00:00:00');
  });
  await t.test('existing password works locally for receipt confirmation but not from remote connections',()=>{
    const confirm=require('../services/admin-confirmation');
    const req={admin:{id:admin},body:{admin_password:'admin123'},socket:{remoteAddress:'127.0.0.1'}};
    assert.doesNotThrow(()=>confirm(req));
    assert.throws(()=>confirm({...req,socket:{remoteAddress:'203.0.113.10'}}),/仅可在本机/);
    assert.throws(()=>confirm({...req,body:{admin_password:'wrong'}}),/管理员密码/);
  });
});
