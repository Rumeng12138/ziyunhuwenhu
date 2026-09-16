const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');

test('isolated preview exposes every payment administration endpoint as JSON',async t=>{
  const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/preview.cjs')],{
    cwd:path.resolve(__dirname,'..'),
    stdio:['ignore','pipe','pipe'],
  });
  t.after(()=>child.kill());
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let output='';
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('preview startup timed out: '+output)),10000);
    const inspect=chunk=>{
      output+=chunk;
      const match=output.match(/Isolated preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if(match){clearTimeout(timer);resolve(match[1]);}
    };
    child.stdout.on('data',inspect);
    child.stderr.on('data',inspect);
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`preview exited with ${code}: ${output}`));});
  });
  const login=await fetch(base+'/api/admin/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'admin',password:'admin123'}),
  });
  assert.match(login.headers.get('content-type')||'',/application\/json/);
  const token=(await login.json()).data.token;
  for(const endpoint of ['/api/admin/payment-settings','/api/admin/personal-payments','/api/admin/merchant-connect']){
    const response=await fetch(base+endpoint,{headers:{Authorization:'Bearer '+token}});
    assert.equal(response.status,200,endpoint);
    assert.match(response.headers.get('content-type')||'',/application\/json/,endpoint);
    assert.equal((await response.json()).code,200,endpoint);
  }
  const productPage=await fetch(base+'/products');
  assert.equal(productPage.status,200);
  assert.match(productPage.headers.get('content-type')||'',/text\/html/);
  assert.match(await productPage.text(),/(?:data-page=\{standalone\?'products':'home-products'\}|'data-page': standalone\?'products':'home-products')/);
  const categories=await fetch(base+'/api/products/categories');
  assert.equal(categories.status,200);
  assert.match(categories.headers.get('content-type')||'',/application\/json/);
  const categoryList=(await categories.json()).data.list;
  assert.deepEqual(categoryList.map(category=>category.code),['pen','ink','paper','inkstone','other']);
  assert.ok(categoryList.every(category=>Array.isArray(category.children)));
  const homepageContent=await (await fetch(base+'/api/editorial-content')).json();
  assert.equal(homepageContent.data.sections.length,5);
  assert.equal(homepageContent.data.sections.find(section=>section.section_key==='artisans').items.length,4);
  const missing=await fetch(base+'/api/not-a-real-route');
  assert.equal(missing.status,404);
  assert.match(missing.headers.get('content-type')||'',/application\/json/);
  assert.equal((await missing.json()).code,404);
});
