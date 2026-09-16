const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.DB_PATH=':memory:';
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
require('../config/initDB');
const db=require('../config/db'),express=require('express'),jwt=require('jsonwebtoken');
const membership=require('../services/membership');
test('membership switches, checkin, pricing and session security',async t=>{
  const app=express();app.use(express.json());
  for(const [prefix,file] of [['auth','auth'],['admin/store-settings','store-settings'],['admin/payment-settings','payment-settings'],['admin','admin'],['orders','orders'],['cart','cart'],['favorites','favorites'],['products','products']]) app.use('/api/'+prefix,require('../routes/'+file));
  app.get('/api/store-settings',(req,res)=>res.json({code:200,data:membership.features()}));
  app.use((e,req,res,next)=>res.status(e.status||500).json({code:e.status||500,message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const buyer=Number(db.prepare("INSERT INTO users(username,password,member_level) VALUES('member-buyer','unused',1)").run().lastInsertRowid);
  const admin=db.prepare("SELECT id FROM users WHERE is_admin=1").get().id;
  const token=id=>jwt.sign({id,session_version:db.prepare('SELECT session_version FROM users WHERE id=?').get(id).session_version},process.env.JWT_SECRET);
  async function request(url,method='GET',body,id=buyer,explicitToken){
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(id?{Authorization:'Bearer '+(explicitToken||token(id))}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const set=async(member,check)=>request('/admin/store-settings','PUT',{membership_enabled:member,checkin_enabled:check,revision:membership.features().revision},admin);
  const product=()=>Number(db.prepare("INSERT INTO products(name,category,price,stock) VALUES('会员测试商品','pen',100,100)").run().lastInsertRowid);
  const item=id=>[{product_id:id,quantity:1}];
  const orderBody=id=>({items:item(id),receiver_name:'测试',receiver_phone:'13800138000',receiver_address:'测试省测试市测试地址'});
  db.prepare('UPDATE commerce_settings SET payload=? WHERE id=1').run(JSON.stringify({mode:'free',fee:0,threshold:0}));
  await t.test('only admins may persist boolean switches; stale configuration rejected',async()=>{
    assert.equal((await request('/admin/store-settings','GET',undefined,null)).status,401);
    assert.equal((await request('/admin/store-settings','PUT',{membership_enabled:false,checkin_enabled:false,revision:0})).status,403);
    assert.equal((await request('/admin/store-settings','PUT',{membership_enabled:'false',checkin_enabled:true,revision:0},admin)).status,400);
    const old=membership.features();assert.equal((await set(false,false)).status,200);
    assert.equal((await request('/admin/store-settings','PUT',old,admin)).status,409);
    delete require.cache[require.resolve('../config/initDB')];require('../config/initDB');
    assert.equal(membership.features().membership_enabled,false);
  });
  await t.test('all four switch combinations preserve independent checkin and account access',async()=>{
    for(const [member,check] of [[false,false],[false,true],[true,false],[true,true]]){
      await set(member,check);
      const state=(await request('/auth/member')).body.data;
      assert.equal(state.membership_enabled,member);assert.equal(state.checkin_enabled,check);
      assert.equal(!!state.current,member);
      assert.equal((await request('/auth/checkin','POST',{})).status,check?200:403);
      assert.equal((await request('/auth/profile')).status,200);
    }
    assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(buyer).points,10);
    assert.equal(db.prepare('SELECT member_level FROM users WHERE id=?').get(buyer).member_level,1);
  });
  await t.test('parallel checkins and disable/re-enable cannot mint extra points',async()=>{
    const responses=await Promise.all(Array.from({length:8},()=>request('/auth/checkin','POST',{})));
    assert.ok(responses.every(r=>r.body.data.pointsEarned===0 && r.body.data.todaySigned));
    await set(true,false);await set(true,true);
    assert.equal((await request('/auth/checkin','POST',{})).body.data.pointsEarned,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM points_ledger WHERE user_id=? AND reason='checkin'").get(buyer).n,1);
    assert.equal(membership.businessDate(new Date('2026-08-28T15:59:59Z')),'2026-08-28');
    assert.equal(membership.businessDate(new Date('2026-08-28T16:00:00Z')),'2026-08-29');
  });
  await t.test('server membership pricing changes quotes but preserves existing order benefits',async()=>{
    const id=product();const old=(await request('/orders/quote','POST',{items:item(id)})).body.data;
    assert.equal(old.total_amount,98);assert.equal(old.points_rate,1.2);
    const made=(await request('/orders','POST',orderBody(id))).body.data;
    await set(false,true);
    assert.equal((await request('/orders/quote','POST',{items:item(id)})).body.data.total_amount,100);
    assert.equal((await request('/orders','POST',{...orderBody(id),quote_hash:old.quote_hash})).status,409);
    db.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(made.id);
    const earned=(await request('/orders/'+made.id+'/confirm','PUT',{})).body.data.pointsEarned;
    assert.equal(earned,117);assert.equal((await request('/orders/'+made.id+'/confirm','PUT',{})).status,400);
    const disabled=(await request('/orders','POST',orderBody(id))).body.data;
    await set(true,true);db.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(disabled.id);
    assert.equal((await request('/orders/'+disabled.id+'/confirm','PUT',{})).body.data.pointsEarned,0);
  });
  await t.test('confirmation upgrades the member at the server threshold',async()=>{
    db.prepare('UPDATE users SET member_level=0,total_spent=490 WHERE id=?').run(buyer);
    const made=(await request('/orders','POST',orderBody(product()))).body.data;
    db.prepare("UPDATE orders SET status='shipped' WHERE id=?").run(made.id);
    await request('/orders/'+made.id+'/confirm','PUT',{});
    assert.equal((await request('/auth/member')).body.data.current.level,1);
  });
  await t.test('direct checkout never includes or clears an unrelated cart item',async()=>{
    const a=product(),b=product();await request('/cart','POST',{product_id:a,quantity:2});
    const body={...orderBody(b),checkout_key:crypto.randomUUID()};
    const made=(await request('/orders','POST',body)).body.data;
    assert.deepEqual(made.items.map(i=>i.product_id),[b]);
    assert.equal((await request('/cart')).body.data.list[0].quantity,2);
    assert.equal((await request('/orders','POST',body)).body.data.id,made.id);
  });
  await t.test('paid-date revenue and top products exclude unpaid/cancelled orders',async()=>{
    const good=product(),bad=product();
    const paid=(await request('/orders','POST',orderBody(good))).body.data;
    const cancelled=(await request('/orders','POST',orderBody(bad))).body.data;
    db.prepare("UPDATE orders SET status='paid',payment_transaction_id='verified-test',paid_at=datetime('now','localtime'),created_at=datetime('now','-2 days','localtime') WHERE id=?").run(paid.id);
    db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(cancelled.id);
    const d=(await request('/admin/dashboard','GET',undefined,admin)).body.data;
    assert.equal(d.todayRevenue,paid.total_amount);assert.equal(d.trend.reduce((a,b)=>a+b.revenue,0),paid.total_amount);
    assert.equal(d.topProducts.reduce((a,b)=>a+b.sold,0),1);
  });
  await t.test('product and order page two are accessible and invalid sizes rejected',async()=>{
    for(let i=0;i<26;i++)product();
    const first=(await request('/products?pageSize=24')).body.data;
    const second=(await request('/products?page=2&pageSize=24')).body.data;
    assert.ok(second.list.length);assert.notEqual(first.list[0].id,second.list[0].id);
    assert.ok((await request('/products/search?q=会员测试&page=2&pageSize=10')).body.data.list.length);
    const orders=(await request('/orders?page=2&pageSize=1')).body.data;assert.equal(orders.page,2);assert.equal(orders.list.length,1);
    assert.equal((await request('/products?pageSize=-1')).status,400);
    assert.equal((await request('/orders?page=1.5')).status,400);
  });
  await t.test('changing admin password revokes both old admin and account tokens',async()=>{
    const old=token(admin);
    assert.equal((await request('/admin/payment-settings/password','PUT',{admin_password:'admin123',new_password:'UpdatedPassword123'},admin)).status,200);
    assert.equal((await request('/admin/store-settings','GET',undefined,admin,old)).status,401);
    assert.equal((await request('/auth/profile','GET',undefined,admin,old)).status,401);
    const login=await request('/admin/login','POST',{username:'admin',password:'UpdatedPassword123'},null);
    assert.equal(login.status,200);assert.equal((await request('/admin/store-settings','GET',undefined,admin,login.body.data.token)).status,200);
  });
  await t.test('legacy orders retain pre-upgrade points even when membership is now disabled',async()=>{
    await set(false,false);
    const order=(await request('/orders','POST',orderBody(product()))).body.data;
    db.prepare("UPDATE orders SET status='shipped',pricing_snapshot=NULL WHERE id=?").run(order.id);
    assert.equal((await request('/orders/'+order.id+'/confirm','PUT',{})).body.data.pointsEarned,100);
  });
  await t.test('expiry only releases new, untouched payments once; review, busy and legacy orders remain',async()=>{
    const {expireUnstarted}=require('../services/order-expiry');
    const ids=[];
    for(let i=0;i<6;i++)ids.push((await request('/orders','POST',orderBody(product()))).body.data.id);
    const now=Date.now();for(const id of ids)db.prepare('UPDATE orders SET expires_at=? WHERE id=?').run(now-1,id);
    db.prepare("UPDATE orders SET payment_method='wechat' WHERE id=?").run(ids[1]);
    db.prepare("UPDATE orders SET manual_receipt='{}',payment_method='wechat_personal',status='payment_review' WHERE id=?").run(ids[2]);
    db.prepare('UPDATE orders SET payment_busy_until=? WHERE id=?').run(now+10000,ids[3]);
    db.prepare('UPDATE orders SET expires_at=NULL WHERE id=?').run(ids[4]);
    db.prepare("UPDATE orders SET status='paid' WHERE id=?").run(ids[5]);
    const productId=db.prepare('SELECT product_id FROM order_items WHERE order_id=?').get(ids[0]).product_id;
    const before=db.prepare('SELECT stock FROM products WHERE id=?').get(productId).stock;
    assert.equal(expireUnstarted.immediate(now),1);assert.equal(expireUnstarted.immediate(now),0);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(productId).stock,before+1);
    assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(ids[1]).status,'pending');
    assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(ids[2]).status,'payment_review');
  });
  await t.test('favorites expose the real product identity and stock for normalization',async()=>{
    const id=product();await request('/favorites','POST',{product_id:id});
    const favorite=(await request('/favorites')).body.data.find(f=>f.product_id===id);
    assert.notEqual(favorite.id,id);assert.equal(favorite.stock,100);assert.equal(favorite.status,1);
  });
  await t.test('repeated failed logins are throttled without authenticating the caller',async()=>{
    for(let i=0;i<10;i++)assert.equal((await request('/auth/login','POST',{username:'no-such-user',password:'wrong123'},null)).status,401);
    assert.equal((await request('/auth/login','POST',{username:'no-such-user',password:'wrong123'},null)).status,429);
  });
});
