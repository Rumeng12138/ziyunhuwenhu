const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('product management exposes inline sorting and listing time',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  assert.match(html,/>上架时间</);
  assert.match(html,/id="product-sort-\$\{p\.id\}"/);
  assert.match(html,/function saveSort\(id,previous\)/);
  assert.match(html,/输入目标位置 1-/);
  assert.match(html,/value<1\|\|value>max/);
  assert.doesNotMatch(html,/prompt\('输入排序号/);
});

test('product management exposes configurable categories used by product forms',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  assert.match(html,/首页展示排序最前的 8 件已上架商品/);
  assert.match(html,/id="categoryTable"/);
  assert.match(html,/id="categoryModal"/);
  assert.match(html,/function loadProductCategories\(\)/);
  assert.match(html,/request\('\/products\/categories'\)/);
  assert.match(html,/function renderProductCategoryOptions\(\)/);
  assert.match(html,/editor\.innerHTML=productCategories\.map/);
  assert.match(html,/productCategories\.find\(category=>category\.enabled\)\|\|productCategories\[0\]/);
  assert.match(html,/function openCategoryModal\(code=''\)/);
  assert.match(html,/request\(editing\?'\/products\/categories\/'/);
  assert.match(html,/request\('\/products\/categories\/'\+encodeURIComponent\(code\),\{method:'DELETE'\}\)/);
  assert.match(html,/id="subcategoryModal"/);
  assert.match(html,/id="productSubcategory"/);
  assert.match(html,/id="pSubcategory"/);
  assert.match(html,/function openSubcategoryModal\(parentCode,code=''\)/);
  assert.match(html,/function renderProductSubcategoryOptions\(target='editor',preferredValue\)/);
  assert.match(html,/\/subcategories'\+\(editing\?'\/'\+encodeURIComponent\(code\):''\)/);
  assert.match(html,/subcategory:document\.getElementById\('pSubcategory'\)\.value\|\|null/);
  assert.doesNotMatch(html,/id="productCategory"[^>]*>[\s\S]{0,250}<option value="pen">/);
});

test('admin response parser reports non-JSON backend responses without leaking a JSON syntax error',async()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  const source=html.slice(html.indexOf('async function adminResponse'),html.indexOf('function uploadRequest'));
  let loggedOut=false;
  const adminResponse=vm.runInNewContext(source+';adminResponse',{logout:()=>{loggedOut=true;},Error,JSON});
  await assert.rejects(
    adminResponse(new Response('<!DOCTYPE html>',{status:404,headers:{'content-type':'text/html'}})),
    /非 JSON 响应（HTTP 404）/
  );
  const result=await adminResponse(new Response(JSON.stringify({code:401,message:'登录过期'}),{status:401,headers:{'content-type':'application/json'}}));
  assert.equal(result.code,401);
  assert.equal(loggedOut,true);
});

test('homepage decoration is a standalone bilingual module and card editor',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/admin.html'),'utf8');
  const profile=fs.readFileSync(path.resolve(__dirname,'../public/admin-store-profile.js'),'utf8');
  const script=fs.readFileSync(path.resolve(__dirname,'../public/admin-editorial.js'),'utf8');
  assert.match(html,/data-permission="editorial"[^>]+switchPage\('editorial'/);
  assert.match(html,/<span>首页装修<\/span>/);
  assert.doesNotMatch(profile,/品牌内容文案|editorialFields/);
  for(const field of ['eyebrow_zh','eyebrow_en','title_zh','title_en','intro_zh','intro_en','body_zh','body_en','layout','items_layout','sort_order','published'])assert.ok(script.includes(field),`missing homepage field ${field}`);
  assert.match(script,/中文补充正文（可添加多段）/);
  assert.match(script,/居中展示/);assert.match(script,/左对齐阅读/);assert.match(script,/标题与简介分栏/);
  assert.match(script,/首页主视觉/);assert.match(script,/文房四宝/);assert.match(script,/匠人访谈/);assert.match(script,/文房文化/);assert.match(script,/品牌故事/);
  assert.match(script,/function addEditorialItem/);assert.match(script,/function removeEditorialItem/);assert.match(script,/每行四项/);assert.match(script,/单列阅读/);
});
