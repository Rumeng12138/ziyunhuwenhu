const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PAYMENT_CONFIG_KEY = crypto.randomBytes(32).toString('base64');
require('../config/initDB');
const db = require('../config/db');
const {createMerchantConnect} = require('../services/merchant-connect');
const {createRouter} = require('../routes/merchant-connect');
const {decrypt} = require('../services/payment-settings');
const {activeBinding,paymentConfig} = require('../services/merchant-bindings');
const {createAlipayConnector,createWechatConnector} = require('../services/merchant-connect-adapters');
const keys = crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const alipaySettings = {appId:'2026000000000001',privateKey:keys.privateKey,alipayPublicKey:keys.publicKey,keyType:'PKCS8',
  callbackUrl:'https://shop.example/api/admin/merchant-connect/alipay/callback',notifyUrl:'https://shop.example/api/payment/notify/alipay',returnUrl:'https://shop.example/'};
const wechatSettings = {appid:'wx-test',mchid:'1234567890',privateKey:keys.privateKey,platformPublicKey:keys.publicKey,
  merchantSerialNumber:'merchant-serial',platformSerial:'platform-serial',apiV3Key:'0123456789abcdef0123456789abcdef',notifyUrl:'https://shop.example/api/payment/notify/wechat'};
const grant = {merchantId:'2088000000000001',operatorId:alipaySettings.appId,authAppId:'2026000000000002',
  appAuthToken:'secret-server-only-token',appRefreshToken:'secret-refresh-token',expiresAt:Date.now()+3600000};

test('merchant binding API requires verified authorization and explicit admin confirmation',async t=>{
  let ready=true, operatorId=grant.operatorId, exchangeFailure=false, exchanges=0, reloads=0;
  const connector={kind:'oauth',get ready(){return ready;},get operatorId(){return operatorId;},missing:[],invalid:[],
    async start(state){return {authorizationUrl:'https://openauth.alipay.com/?state='+state};},
    merchantId:grant.merchantId,
    async exchange(){exchanges++;if(exchangeFailure)throw Error('secret-provider-error');return {...grant,merchantId:this.merchantId};}};
  const service=createMerchantConnect(()=>connector,()=>reloads++);
  const app=express();app.use(express.json());app.use('/connect',createRouter(service));
  app.use((err,req,res,next)=>res.status(err.status||500).json({code:err.status||500,message:err.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port+'/connect';
  const admin=db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  const other=Number(db.prepare("INSERT INTO users(username,password,is_admin) VALUES('admin2','unused',1)").run().lastInsertRowid);
  const buyer=Number(db.prepare("INSERT INTO users(username,password) VALUES('buyer','unused')").run().lastInsertRowid);
  const password='TestOnlyMerchant2026';
  async function request(path='',method='GET',body,uid=admin){
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(uid?{Authorization:'Bearer '+jwt.sign({id:uid},process.env.JWT_SECRET)}:{})},body:body?JSON.stringify(body):undefined});
    const raw=await res.text();let value;try{value=JSON.parse(raw);}catch{value=raw;}
    return {status:res.status,body:value,raw,cache:res.headers.get('cache-control')};
  }
  async function start(){
    // Each independent scenario represents a separate time window.
    db.prepare('UPDATE merchant_auth_sessions SET created_at=?').run(Date.now()-61000);
    const result=await request('/alipay/sessions','POST',{admin_password:password});
    assert.equal(result.status,200);const data=result.body.data;
    return {data,state:new URL(data.authorizationUrl).searchParams.get('state')};
  }
  async function callback(state){return request('/alipay/callback?state='+encodeURIComponent(state)+'&app_auth_code=authorization-code','GET',undefined,null);}
  await t.test('anonymous, non-admin, bad password and default password cannot start binding',async()=>{
    assert.equal((await request('','GET',undefined,null)).status,401);
    assert.equal((await request('','GET',undefined,buyer)).status,403);
    assert.equal((await request('/alipay/sessions','POST',{admin_password:'wrong'})).status,403);
    assert.equal((await request('/alipay/sessions','POST',{admin_password:'admin123'})).status,403);
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password,4),admin);
    ready=false;assert.equal((await request('/alipay/sessions','POST',{admin_password:password})).status,503);ready=true;
  });
  await t.test('callback state is single-use; candidate token is encrypted and not yet bound',async()=>{
    const {data,state}=await start();assert.match(data.qrCode,/^data:image\/png;base64,/);
    const stored=db.prepare('SELECT * FROM merchant_auth_sessions WHERE id=?').get(data.id);
    assert.notEqual(stored.state_hash,state);assert.equal(stored.state_hash,crypto.createHash('sha256').update(state).digest('hex'));
    assert.equal((await request('/sessions/'+data.id,'GET',undefined,other)).status,404);
    assert.equal((await callback('x'.repeat(43))).status,400);
    assert.equal((await callback(state)).status,200);assert.equal(activeBinding('alipay'),undefined);
    assert.equal((await callback(state)).status,409);assert.equal(exchanges,1);
    const current=await request('/sessions/'+data.id);assert.equal(current.cache,'no-store');assert.equal(current.body.data.status,'authorized');
    assert.ok(!current.raw.includes(grant.appAuthToken));assert.ok(!current.raw.includes(grant.appRefreshToken));
    const payload=db.prepare('SELECT payload FROM merchant_auth_sessions WHERE id=?').get(data.id).payload;
    assert.ok(!payload.includes(grant.appAuthToken));assert.equal(decrypt(payload).grant.appAuthToken,grant.appAuthToken);
    assert.equal((await request('/sessions/'+data.id+'/confirm','POST',{admin_password:password,merchant_id:'wrong'})).status,400);
    assert.equal((await request('/sessions/'+data.id+'/confirm','POST',{admin_password:'wrong',merchant_id:grant.merchantId})).status,403);
    const result=await request('/sessions/'+data.id+'/confirm','POST',{admin_password:password,merchant_id:grant.merchantId});
    assert.equal(result.status,200);assert.equal(result.body.data.merchantId,grant.merchantId);
    assert.equal((await request('/sessions/'+data.id+'/confirm','POST',{admin_password:password,merchant_id:grant.merchantId})).body.data.id,result.body.data.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_bindings WHERE active=1').get().n,1);
    assert.equal(db.prepare('SELECT payload FROM merchant_auth_sessions WHERE id=?').get(data.id).payload,null);
    assert.ok(reloads>=1);
    process.env.PAYCONNECT_ALIPAY_APP_ID=grant.operatorId;
    assert.equal(paymentConfig('alipay').appAuthToken,grant.appAuthToken);assert.equal(paymentConfig('alipay').enabled,true);
    process.env.PAYCONNECT_ALIPAY_APP_ID='changed';assert.equal(paymentConfig('alipay').enabled,false);delete process.env.PAYCONNECT_ALIPAY_APP_ID;
  });
  await t.test('expired and unverified sessions cannot bind; exchange errors are redacted',async()=>{
    let session=await start();
    assert.equal((await request('/sessions/'+session.data.id+'/confirm','POST',{admin_password:password,merchant_id:grant.merchantId})).status,409);
    db.prepare('UPDATE merchant_auth_sessions SET expires_at=? WHERE id=?').run(Date.now()-1,session.data.id);
    assert.equal((await callback(session.state)).status,409);
    assert.equal((await request('/sessions/'+session.data.id)).body.data.status,'expired');
    session=await start();exchangeFailure=true;const response=await callback(session.state);exchangeFailure=false;
    assert.equal(response.status,502);assert.ok(!response.raw.includes('secret-provider-error'));
    assert.equal((await request('/sessions/'+session.data.id)).body.data.status,'failed');
    assert.equal(db.prepare('SELECT payload FROM merchant_auth_sessions WHERE id=?').get(session.data.id).payload,null);
  });
  await t.test('changing operator or having pending payments prevents switching merchant',async()=>{
    let session=await start();operatorId='different';assert.equal((await callback(session.state)).status,502);operatorId=grant.operatorId;
    connector.merchantId='2088000000000003';session=await start();await callback(session.state);connector.merchantId=grant.merchantId;
    const prior=activeBinding('alipay').id;
    db.prepare("INSERT INTO orders(order_no,user_id,total_amount,receiver_name,receiver_phone,receiver_address,payment_method) VALUES('pending-connect',?,1,'buyer','123','address','alipay')").run(buyer);
    assert.equal((await request('/sessions/'+session.data.id+'/confirm','POST',{admin_password:password,merchant_id:'2088000000000003'})).status,409);
    assert.equal(activeBinding('alipay').id,prior);
    const renewal=await start();await callback(renewal.state);
    assert.equal((await request('/sessions/'+renewal.data.id+'/confirm','POST',{admin_password:password,merchant_id:grant.merchantId})).status,200);
    db.prepare("DELETE FROM orders WHERE order_no='pending-connect'").run();
    operatorId='different';assert.equal((await request('/sessions/'+session.data.id+'/confirm','POST',{admin_password:password,merchant_id:'2088000000000003'})).status,409);operatorId=grant.operatorId;
  });
  await t.test('burst authorization attempts are limited',async()=>{
    db.prepare('UPDATE merchant_auth_sessions SET created_at=?').run(Date.now()-61000);
    for(let i=0;i<5;i++)assert.equal((await request('/alipay/sessions','POST',{admin_password:password})).status,200);
    assert.equal((await request('/alipay/sessions','POST',{admin_password:password})).status,429);
  });
});

test('Alipay connector carries state to official callback and verifies token exchange signatures',async()=>{
  let call;
  const connector=createAlipayConnector(alipaySettings,{async exec(...args){call=args;return {code:'10000',userId:grant.merchantId,authAppId:grant.authAppId,appAuthToken:grant.appAuthToken,expiresIn:3600};}});
  const started=await connector.start('random-state');const url=new URL(started.authorizationUrl);
  assert.equal(url.origin,'https://openauth.alipay.com');assert.equal(url.searchParams.get('app_id'),alipaySettings.appId);
  assert.equal(new URL(url.searchParams.get('redirect_uri')).searchParams.get('state'),'random-state');
  const result=await connector.exchange('one-use-code');assert.equal(result.merchantId,grant.merchantId);
  assert.equal(call[0],'alipay.open.auth.token.app');assert.equal(call[1].bizContent.code,'one-use-code');assert.equal(call[2].validateSign,true);
  const bad=createAlipayConnector(alipaySettings,{async exec(){return {code:'10000',userId:'other',appAuthToken:'secret'};}});
  await assert.rejects(()=>bad.exchange('code'),/有效的商户授权/);
});

test('WeChat binding only accepts signed finished applyments, never arbitrary login URLs',async()=>{
  let result={applyment_id:12345,applyment_state:'APPLYMENT_STATE_TO_BE_SIGNED',sign_url:'https://pay.weixin.qq.com/merchant/confirm'};
  const client={async requestApi(method,uri){assert.equal(method,'GET');assert.equal(uri,'/v3/applyment4sub/applyment/applyment_id/12345');return result;}};
  const connector=createWechatConnector(wechatSettings,client);
  const started=await connector.start('state',{applyment_id:'12345'});assert.ok(started.authorizationUrl);assert.equal(started.grant,undefined);
  await assert.rejects(()=>connector.start('state',{applyment_id:12345}),/字符串/);
  result.sign_url='https://attacker.example/';await assert.rejects(()=>connector.poll(started.context),/可信/);
  result={applyment_id:12345,applyment_state:'APPLYMENT_STATE_FINISHED',sub_mchid:'1234567891'};
  assert.equal((await connector.poll(started.context)).grant.merchantId,'1234567891');
  result.applyment_id=99999;await assert.rejects(()=>connector.poll(started.context),/不匹配/);
  result={applyment_id:12345,applyment_state:'APPLYMENT_STATE_REJECTED'};await assert.rejects(()=>connector.poll(started.context),/未通过/);
});

test('delegated Alipay payments keep merchant tokens on the server',async()=>{
  const {createAlipay}=require('../services/alipay-live');let calls=[];
  const sdk={async exec(...args){calls.push(args);return {code:'10000',outTradeNo:'order1',qrCode:'https://qr.alipay.com/test',sellerUserId:grant.merchantId,tradeStatus:'TRADE_SUCCESS',totalAmount:'12.34',tradeNo:'trade1'};},checkNotifySignV2(){return true;},pageExecute(){throw Error('must not expose token in URL');}};
  const provider=createAlipay({...alipaySettings,sellerId:grant.merchantId,authAppId:grant.authAppId,appAuthToken:grant.appAuthToken},sdk);
  const payment=await provider.create({order_no:'order1',total_amount:12.34});assert.match(payment.qrCode,/^data:image\/png/);assert.ok(!JSON.stringify(payment).includes(grant.appAuthToken));
  assert.equal((await provider.query('order1')).payment.amountCents,1234);await provider.close('order1');
  assert.deepEqual(calls.map(x=>x[0]),['alipay.trade.precreate','alipay.trade.query','alipay.trade.close']);
  for(const call of calls){assert.equal(call[1].appAuthToken,grant.appAuthToken);assert.equal(call[2].validateSign,true);}
  assert.throws(()=>provider.verifyNotify({sign_type:'RSA2',trade_status:'TRADE_SUCCESS',app_id:alipaySettings.appId,seller_id:'wrong'}),/商户不匹配/);
  const expired=createAlipay({...alipaySettings,sellerId:grant.merchantId,authorizationExpiresAt:Date.now()-1},sdk);
  assert.equal(expired.isReady,false);await assert.rejects(()=>expired.create({}),/到期/);
});

test('WeChat session polling never binds before finished status and administrator confirmation',async()=>{
  let finished=false;
  const connector={ready:true,operatorId:'1234567890',async start(){return {context:{applymentId:'12345'}};},
    async poll(context){assert.equal(context.applymentId,'12345');return finished?{grant:{merchantId:'1234567891',operatorId:'1234567890',expiresAt:null}}:{message:'pending'};}};
  const service=createMerchantConnect(()=>connector,()=>{});
  db.prepare('UPDATE merchant_auth_sessions SET created_at=?').run(Date.now()-61000);
  const data=await service.start('wechat',1,{applyment_id:'12345'});
  assert.equal((await service.status(data.id,1)).status,'pending');assert.equal(activeBinding('wechat'),undefined);
  assert.throws(()=>service.confirm(data.id,1,'1234567891'),/尚未获得/);
  finished=true;assert.equal((await service.status(data.id,1)).status,'authorized');assert.equal(activeBinding('wechat'),undefined);
  assert.equal(service.confirm(data.id,1,'1234567891').merchantId,'1234567891');
  assert.equal((await service.status(data.id,1)).status,'confirmed');
});

test('WeChat partner payments sign correct merchant fields and reject mismatched signed query',async()=>{
  const {createWechat}=require('../services/wechat-live');const calls=[];let wrongMerchant=false;
  const provider=createWechat({...wechatSettings,subMchid:'1234567891'},async(url,options)=>{
    calls.push({url,options});const uri=url.slice('https://api.mch.weixin.qq.com'.length);
    const auth=Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]+)"/g)].map(m=>[m[1],m[2]]));
    assert.ok(crypto.verify('RSA-SHA256',Buffer.from(`${options.method}\n${uri}\n${auth.timestamp}\n${auth.nonce_str}\n${options.body||''}\n`),keys.publicKey,Buffer.from(auth.signature,'base64')));
    let raw=options.method==='GET'?JSON.stringify({sp_appid:wechatSettings.appid,sp_mchid:wechatSettings.mchid,sub_mchid:wrongMerchant?'9999999999':'1234567891',out_trade_no:'order1',trade_state:'SUCCESS',transaction_id:'wxtrade1',amount:{total:1234,currency:'CNY'}}):uri.endsWith('/native')?JSON.stringify({code_url:'weixin://wxpay/bizpayurl?pr=test'}):'';
    const timestamp=String(Math.floor(Date.now()/1000)),nonce='response-nonce';
    return {ok:true,headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':wechatSettings.platformSerial,'wechatpay-signature':crypto.sign('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),keys.privateKey).toString('base64')},async text(){return raw;}};
  });
  assert.match((await provider.create({order_no:'order1',total_amount:12.34})).qrCode,/^data:image\/png/);
  assert.equal((await provider.query('order1')).payment.transactionId,'wxtrade1');await provider.close('order1');
  assert.ok(calls[0].url.endsWith('/v3/pay/partner/transactions/native'));
  assert.equal(JSON.parse(calls[0].options.body).sub_mchid,'1234567891');
  assert.ok(calls[1].url.includes('sp_mchid=1234567890&sub_mchid=1234567891'));
  assert.deepEqual(JSON.parse(calls[2].options.body),{sp_mchid:'1234567890',sub_mchid:'1234567891'});
  wrongMerchant=true;await assert.rejects(()=>provider.query('order1'),/商户或币种无效/);
});
