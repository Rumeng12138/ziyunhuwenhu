const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
process.env.DB_PATH=':memory:';
process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
require('../config/initDB');
const db=require('../config/db');
const express=require('express');

test('owner can manage scoped subaccounts and API permissions are enforced',async t=>{
  const app=express();app.use(express.json());app.use('/api/admin',require('../routes/admin'));
  app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.status||500,message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/admin';
  async function request(url,{method='GET',body,token}={}){
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  async function login(username,password){return request('/login',{method:'POST',body:{username,password}});}

  const ownerLogin=await login('admin','admin123');
  assert.equal(ownerLogin.status,200);assert.equal(ownerLogin.body.data.admin.is_owner,true);
  const ownerToken=ownerLogin.body.data.token;

  const invalid=await request('/staff',{method:'POST',token:ownerToken,body:{username:'operator',nickname:'运营',password:'safePass123',permissions:['unknown']}});
  assert.equal(invalid.status,400);
  const created=await request('/staff',{method:'POST',token:ownerToken,body:{username:'operator',nickname:'商品运营',password:'safePass123',permissions:['products']}});
  assert.equal(created.status,200,JSON.stringify(created.body));
  const staffId=created.body.data.id;
  assert.deepEqual(created.body.data.permissions,['products']);

  const staffLogin=await login('operator','safePass123');
  assert.equal(staffLogin.status,200);const productsToken=staffLogin.body.data.token;
  assert.equal((await request('/products',{token:productsToken})).status,200);
  assert.equal((await request('/orders',{token:productsToken})).status,403);
  assert.equal((await request('/staff',{token:productsToken})).status,403);
  assert.deepEqual((await request('/me',{token:productsToken})).body.data.admin.permissions,['products']);

  const updated=await request('/staff/'+staffId,{method:'PUT',token:ownerToken,body:{username:'operator',nickname:'订单客服',password:'',permissions:['orders']}});
  assert.equal(updated.status,200);
  assert.equal((await request('/products',{token:productsToken})).status,401);
  const orderLogin=await login('operator','safePass123');const ordersToken=orderLogin.body.data.token;
  assert.equal((await request('/orders',{token:ordersToken})).status,200);
  assert.equal((await request('/products',{token:ordersToken})).status,403);

  assert.equal((await request('/staff/'+staffId,{method:'DELETE',token:ownerToken})).status,200);
  assert.equal((await request('/orders',{token:ordersToken})).status,401);
  assert.equal((await login('operator','safePass123')).status,401);
  const ownerId=db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  assert.equal((await request('/staff/'+ownerId,{method:'DELETE',token:ownerToken})).status,404);
});

test('admin UI exposes editable subaccounts and selectable permission controls',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  const script=fs.readFileSync(path.resolve(__dirname,'../public/admin-staff.js'),'utf8');
  assert.match(html,/data-owner-only[^>]+switchPage\('staff'/);
  assert.match(html,/data-permission="products"/);
  assert.match(html,/applyAdminAccess/);
  assert.match(script,/新增子账号/);
  assert.match(script,/name="staffPermission"/);
  assert.match(script,/function openStaffModal/);
  assert.match(script,/function deleteStaff/);
});
