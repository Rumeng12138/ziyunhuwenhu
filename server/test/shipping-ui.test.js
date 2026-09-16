const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('shipping administration supports country and regional rules',()=>{
  const script=fs.readFileSync(path.resolve(__dirname,'../public/admin-marketing.js'),'utf8');
  assert.match(script,/国家\/地区运费规则/);
  assert.match(script,/id="shippingRuleForm"/);
  assert.match(script,/shippingRuleCountry/);
  assert.match(script,/shippingRuleRegions/);
  assert.match(script,/function renderShippingRules\(rules\)/);
  assert.match(script,/\/marketing\/shipping-rules/);
  assert.match(script,/运费只在买家结算并填写地址后显示/);
});

test('checkout and saved addresses collect an international destination',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../../frontend/index.html'),'utf8');
  assert.match(html,/receiver_country: addressInfo\.country/);
  assert.match(html,/receiver_province: addressInfo\.province/);
  assert.match(html,/country: addr\.country \|\| '中国'/);
  assert.match(html,/国家\/地区/);
  assert.match(html,/省\/州/);
  assert.match(html,/\^\\\+\?\[0-9\]\[0-9\\s\(\)-\]\{5,28\}\$/);
});
