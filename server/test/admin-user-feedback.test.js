const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.DB_PATH=':memory:';
process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');
require('../config/initDB');
const db=require('../config/db');
const express=require('express');
const jwt=require('jsonwebtoken');

test('front-end registrations and feedback are reflected in admin management',async t=>{
  const app=express();app.use(express.json());
  app.use('/api/auth',require('../routes/auth'));
  app.use('/api/feedback',require('../routes/feedback'));
  app.use('/api/admin',require('../routes/admin'));
  app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.status||500,message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api';
  async function request(url,{method='GET',body,token}={}){
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }

  const registration=await request('/auth/register',{method:'POST',body:{username:'front-customer',password:'SafePassword123',nickname:'前台顾客'}});
  assert.equal(registration.status,200,JSON.stringify(registration.body));
  const userToken=registration.body.data.token;
  const feedback=await request('/feedback',{method:'POST',token:userToken,body:{type:'suggestion',content:'希望后台能够看到这条前台用户反馈',contact:'customer@example.test'}});
  assert.equal(feedback.status,200,JSON.stringify(feedback.body));

  const admin=db.prepare('SELECT id,session_version FROM users WHERE is_admin=1').get();
  const adminToken=jwt.sign({id:admin.id,session_version:admin.session_version},process.env.JWT_SECRET);
  const users=await request('/admin/users?keyword=front-customer',{token:adminToken});
  assert.equal(users.status,200);assert.equal(users.body.data.total,1);
  assert.equal(users.body.data.list[0].username,'front-customer');
  assert.equal(users.body.data.list[0].feedback_count,1);
  assert.equal(users.body.data.list[0].order_count,0);

  const feedbacks=await request('/admin/feedbacks?keyword=前台用户反馈&type=suggestion&status=pending',{token:adminToken});
  assert.equal(feedbacks.status,200);assert.equal(feedbacks.body.data.total,1);
  assert.equal(feedbacks.body.data.list[0].username,'front-customer');
  assert.equal(feedbacks.body.data.list[0].nickname,'前台顾客');
  assert.equal(feedbacks.body.data.list[0].contact,'customer@example.test');
  assert.ok(feedbacks.body.data.summary.pending>=1);
});

test('admin pages expose registration, feedback filters and empty states',()=>{
  const fs=require('node:fs');const path=require('node:path');
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  assert.match(html,/搜索前台注册账号\/昵称/);
  assert.match(html,/注册账号：\$\{f\.username\}/);
  assert.match(html,/feedbackStatusFilter/);
  assert.match(html,/暂无符合条件的前台注册用户/);
  assert.match(html,/暂无符合条件的反馈/);
});
