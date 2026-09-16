let marketingState=null;
const campaignTypes={coupon:'优惠券',full_reduction:'满减',discount:'商品折扣促销',free_shipping:'包邮活动'};
function marketingMessage(text){for(const id of ['shippingMessage','marketingMessage']){const el=document.getElementById(id);if(el)el.textContent=text;}}
function marketingField(id,label,type='number',extra='') {return `<label class="block text-sm text-gray-600">${label}<input id="${id}" type="${type}" ${extra} class="w-full border rounded px-3 py-2 mt-1"></label>`;}
function buildMarketing(){
  if(document.getElementById('shippingForm'))return;
  document.getElementById('page-shipping').innerHTML=`<h2 class="text-xl font-bold mb-2">运费设置</h2><p class="text-sm text-gray-500 mb-5">运费只在买家结算并填写地址后显示。地区规则优先于国家规则，没有匹配项时使用默认规则；所有改动仅影响新订单。</p>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
    <form id="shippingForm" class="bg-white border rounded-lg p-6 space-y-4"><h3 class="font-bold">默认运费规则</h3><p class="text-xs text-gray-500">当国家和省州均无匹配规则时使用。</p><label class="block text-sm">运费模式<select id="shippingMode" class="w-full border rounded p-2 mt-1"><option value="flat">固定运费</option><option value="threshold">满额包邮</option><option value="free">全场包邮</option></select></label>${marketingField('shippingFee','基础运费（元）','number','min="0" step="0.01" required')}${marketingField('shippingThreshold','包邮门槛（元，满额包邮时使用）','number','min="0" step="0.01" required')}<button class="bg-purple-700 text-white rounded px-4 py-2" type="submit">保存默认规则</button></form>
    <div class="bg-white border rounded-lg p-6"><div class="flex justify-between items-center gap-3"><div><h3 class="font-bold">国家/地区运费规则</h3><p class="text-xs text-gray-500 mt-1">省州列表留空表示整个国家；填写 * 可设全球规则。</p></div><button id="newShippingRule" class="border border-purple-300 text-purple-700 rounded px-3 py-2 whitespace-nowrap">新增规则</button></div><div id="shippingRuleList" class="space-y-3 mt-4"></div></div>
  </div><p id="shippingMessage" role="status" class="text-sm text-purple-700 my-4"></p>
  <form id="shippingRuleForm" class="hidden bg-white border rounded-lg p-6 max-w-3xl space-y-4"><h3 id="shippingRuleFormTitle" class="font-bold text-lg">新增地区运费规则</h3><input id="shippingRuleId" type="hidden"><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${marketingField('shippingRuleName','规则名称','text','maxlength="80" required')}${marketingField('shippingRuleCountry','国家/地区（如 CN、中国、US；全球填 *）','text','maxlength="60" required')}${marketingField('shippingRuleRegions','省/州/地区（逗号分隔；留空为整个国家）','text','maxlength="1000"')}<label class="block text-sm text-gray-600">运费模式<select id="shippingRuleMode" class="w-full border rounded px-3 py-2 mt-1"><option value="flat">固定运费</option><option value="threshold">满额包邮</option><option value="free">全场包邮</option></select></label>${marketingField('shippingRuleFee','基础运费（元）','number','min="0" step="0.01" required')}${marketingField('shippingRuleThreshold','包邮门槛（元）','number','min="0" step="0.01" required')}${marketingField('shippingRuleSort','优先级（数字越小越优先）','number','min="1" max="9999" step="1" required')}<label class="flex items-center gap-2 text-sm"><input id="shippingRuleEnabled" type="checkbox" checked>启用此规则</label></div><div class="flex gap-3"><button type="submit" class="bg-purple-700 text-white rounded px-4 py-2">保存地区规则</button><button id="closeShippingRule" type="button" class="border rounded px-4 py-2">取消</button></div></form>`;
  document.getElementById('shippingForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
    try{const r=await request('/marketing/shipping',{method:'PUT',body:JSON.stringify({mode:document.getElementById('shippingMode').value,fee:document.getElementById('shippingFee').value,threshold:document.getElementById('shippingThreshold').value})});if(r.code!==200)throw Error(r.message);await loadMarketing();marketingMessage(r.message);}catch(error){marketingMessage(error.message);}finally{button.disabled=false;}
  });
  document.getElementById('newShippingRule').onclick=()=>editShippingRule();
  document.getElementById('closeShippingRule').onclick=()=>document.getElementById('shippingRuleForm').classList.add('hidden');
  document.getElementById('shippingRuleForm').addEventListener('submit',saveShippingRule);
  document.getElementById('page-marketing').innerHTML=`<div class="flex justify-between items-center mb-4"><h2 class="text-xl font-bold">活动管理</h2><button id="newCampaign" class="bg-purple-700 text-white rounded px-4 py-2">新增活动</button></div><p class="text-sm text-gray-500 mb-4">支持优惠券、满减、商品折扣及包邮。顺序：商品最优折扣 → 最优一档满减 → 一张优惠券；优惠后商品金额至少保留0.01元。优惠券在下单时占用，取消后释放，待核实订单仍占用。</p><p id="marketingMessage" role="status" class="text-purple-700 text-sm mb-4"></p><div id="campaignList" class="space-y-3"></div>
  <form id="campaignForm" class="hidden bg-white border rounded-lg p-6 mt-5 space-y-4"><h3 id="campaignFormTitle" class="font-bold text-lg">新增活动</h3><input id="campaignId" type="hidden">${marketingField('campaignName','活动名称','text','maxlength="80" required')}<label class="block text-sm">活动类型<select id="campaignType" class="border rounded p-2 w-full mt-1"><option value="coupon">优惠券</option><option value="full_reduction">满减</option><option value="discount">商品折扣促销</option><option value="free_shipping">包邮活动</option></select></label>
  <div id="campaignThresholdFields">${marketingField('campaignMin','消费门槛（元）','number','min="0" step="0.01"')}</div><div id="campaignAmountFields">${marketingField('campaignDiscount','减免金额（元）','number','min="0.01" step="0.01"')}</div><div id="campaignRateFields" class="space-y-3">${marketingField('campaignRate','商品折扣（如8.5表示八五折）','number','min="0.001" max="9.999" step="0.001"')}${marketingField('campaignProducts','适用商品 ID（逗号分隔；留空为全场）','text')}</div><div id="campaignCouponFields" class="space-y-3">${marketingField('campaignCode','优惠码（3至32位字母/数字/横线/下划线）','text','maxlength="32"')}${marketingField('campaignMax','总使用次数（0为不限）','number','min="0" step="1"')}${marketingField('campaignPerUser','每人限用次数','number','min="1" step="1"')}</div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${marketingField('campaignStart','开始时间（可留空）','datetime-local')}${marketingField('campaignEnd','结束时间（可留空）','datetime-local')}</div><label class="flex items-center gap-2 text-sm"><input id="campaignEnabled" type="checkbox">启用活动</label><div class="flex gap-3"><button id="saveCampaign" type="submit" class="bg-purple-700 text-white rounded px-4 py-2">保存活动</button><button id="closeCampaign" type="button" class="border rounded px-4 py-2">取消编辑</button></div></form>`;
  document.getElementById('newCampaign').onclick=()=>editCampaign();
  document.getElementById('closeCampaign').onclick=()=>document.getElementById('campaignForm').classList.add('hidden');
  document.getElementById('campaignType').onchange=campaignFieldVisibility;
  document.getElementById('campaignForm').addEventListener('submit',saveCampaign);
}
async function loadMarketing(){
  buildMarketing();try{const r=await request('/marketing');if(r.code!==200)throw Error(r.message);marketingState=r.data;
    document.getElementById('shippingMode').value=r.data.shipping.mode;document.getElementById('shippingFee').value=r.data.shipping.fee;document.getElementById('shippingThreshold').value=r.data.shipping.threshold;renderShippingRules(r.data.shipping_rules||[]);
    const list=document.getElementById('campaignList');list.replaceChildren();
    if(!r.data.campaigns.length)list.textContent='暂无活动，点击新增活动开始设置。';
    for(const c of r.data.campaigns){
      const card=document.createElement('div');card.className='bg-white border rounded-lg p-4';
      const heading=document.createElement('h3');heading.className='font-bold';heading.textContent=c.name+' · '+campaignTypes[c.type];card.append(heading);
      const info=document.createElement('p');info.className='text-sm text-gray-600 my-2';
      const status=!c.enabled?'停用':c.ends_at&&c.ends_at<=Date.now()?'已结束':c.starts_at&&c.starts_at>Date.now()?'未开始':'生效中';
      info.textContent=status+' ｜ '+(c.type==='discount'?c.rate_bps/1000+'折，'+(JSON.parse(c.product_ids).length?'指定商品':'全场'):c.type==='free_shipping'?'满 ¥'+c.min_spend_cents/100+' 包邮':'满 ¥'+c.min_spend_cents/100+' 减 ¥'+c.discount_cents/100)+(c.type==='coupon'?' ｜ 优惠码 '+c.code+' ｜ 已占用 '+c.reserved_uses+'/'+(c.max_uses||'不限'):'');card.append(info);
      const edit=document.createElement('button');edit.textContent='编辑';edit.className='text-purple-700 mr-5';edit.onclick=()=>editCampaign(c);card.append(edit);
      const toggle=document.createElement('button');toggle.textContent=c.enabled?'停用':'启用';toggle.className='text-blue-700';toggle.onclick=async()=>{toggle.disabled=true;try{const r=await request('/marketing/campaigns/'+c.id+'/enabled',{method:'PUT',body:JSON.stringify({enabled:!c.enabled})});if(r.code!==200)throw Error(r.message);await loadMarketing();marketingMessage(r.message);}catch(e){marketingMessage(e.message);toggle.disabled=false;}};card.append(toggle);list.append(card);
    }
  }catch(error){marketingMessage(error.message||'无法加载活动');}
}
function shippingRuleDescription(rule){
  const area=rule.country+(rule.regions.length?' · '+rule.regions.join('、'):' · 全境');
  const price=rule.mode==='free'?'全场包邮':rule.mode==='threshold'?'运费 ¥'+(rule.fee_cents/100).toFixed(2)+'，满 ¥'+(rule.threshold_cents/100).toFixed(2)+' 包邮':'固定运费 ¥'+(rule.fee_cents/100).toFixed(2);
  return area+' ｜ '+price+' ｜ 优先级 '+rule.sort_order+' ｜ '+(rule.enabled?'已启用':'已停用');
}
function renderShippingRules(rules){
  const list=document.getElementById('shippingRuleList');list.replaceChildren();
  if(!rules.length){list.textContent='暂无地区规则，将使用默认运费。';return;}
  for(const rule of rules){
    const card=document.createElement('div');card.className='border rounded p-3';
    const name=document.createElement('div');name.className='font-bold';name.textContent=rule.name;card.append(name);
    const info=document.createElement('p');info.className='text-xs text-gray-600 my-2';info.textContent=shippingRuleDescription(rule);card.append(info);
    const edit=document.createElement('button');edit.className='text-purple-700 mr-4';edit.textContent='编辑';edit.onclick=()=>editShippingRule(rule);card.append(edit);
    const remove=document.createElement('button');remove.className='text-red-600';remove.textContent='删除';remove.onclick=()=>deleteShippingRule(rule.id);card.append(remove);list.append(card);
  }
}
function editShippingRule(rule){
  const form=document.getElementById('shippingRuleForm');form.reset();form.classList.remove('hidden');
  document.getElementById('shippingRuleFormTitle').textContent=rule?'编辑地区运费规则':'新增地区运费规则';
  document.getElementById('shippingRuleId').value=rule?.id||'';document.getElementById('shippingRuleName').value=rule?.name||'';
  document.getElementById('shippingRuleCountry').value=rule?.country||'中国';document.getElementById('shippingRuleRegions').value=(rule?.regions||[]).join('，');
  document.getElementById('shippingRuleMode').value=rule?.mode||'flat';document.getElementById('shippingRuleFee').value=(rule?.fee_cents||0)/100;
  document.getElementById('shippingRuleThreshold').value=(rule?.threshold_cents||0)/100;document.getElementById('shippingRuleSort').value=rule?.sort_order||100;
  document.getElementById('shippingRuleEnabled').checked=rule?Boolean(rule.enabled):true;form.scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveShippingRule(event){
  event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
  try{const id=document.getElementById('shippingRuleId').value,data={name:document.getElementById('shippingRuleName').value,country:document.getElementById('shippingRuleCountry').value,regions:document.getElementById('shippingRuleRegions').value,mode:document.getElementById('shippingRuleMode').value,fee:document.getElementById('shippingRuleFee').value,threshold:document.getElementById('shippingRuleThreshold').value,sort_order:Number(document.getElementById('shippingRuleSort').value),enabled:document.getElementById('shippingRuleEnabled').checked};
    const result=await request('/marketing/shipping-rules'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(data)});if(result.code!==200)throw Error(result.message);document.getElementById('shippingRuleForm').classList.add('hidden');await loadMarketing();marketingMessage(result.message);
  }catch(error){marketingMessage(error.message||'地区运费规则保存失败');}finally{button.disabled=false;}
}
async function deleteShippingRule(id){
  if(!confirm('确定删除这条地区运费规则？已有订单运费不会变化。'))return;
  try{const result=await request('/marketing/shipping-rules/'+id,{method:'DELETE'});if(result.code!==200)throw Error(result.message);await loadMarketing();marketingMessage(result.message);}catch(error){marketingMessage(error.message||'删除失败');}
}
function campaignFieldVisibility(){const type=document.getElementById('campaignType').value;for(const [id,visible]of [['Threshold',type!=='discount'],['Amount',['coupon','full_reduction'].includes(type)],['Rate',type==='discount'],['Coupon',type==='coupon']]){const group=document.getElementById('campaign'+id+'Fields');group.classList.toggle('hidden',!visible);group.querySelectorAll('input').forEach(input=>input.disabled=!visible);}}
function localDate(value){if(!value)return '';const d=new Date(value);return new Date(value-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function editCampaign(c){
  const form=document.getElementById('campaignForm');form.reset();form.classList.remove('hidden');
  const set=(name,value)=>document.getElementById('campaign'+name).value=value;
  set('Id',c?.id||'');set('Name',c?.name||'');set('Type',c?.type||'coupon');document.getElementById('campaignType').disabled=!!c;
  set('Min',(c?.min_spend_cents||0)/100);set('Discount',(c?.discount_cents||0)/100||1);set('Rate',(c?.rate_bps||8500)/1000);set('Products',JSON.parse(c?.product_ids||'[]').join(','));set('Code',c?.code||'');set('Max',c?.max_uses||0);set('PerUser',c?.per_user_limit||1);set('Start',localDate(c?.starts_at));set('End',localDate(c?.ends_at));document.getElementById('campaignEnabled').checked=!!c?.enabled;
  document.getElementById('campaignFormTitle').textContent=c?'编辑活动 #'+c.id:'新增活动';campaignFieldVisibility();form.scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveCampaign(e){
  e.preventDefault();const button=document.getElementById('saveCampaign');if(button.disabled)return;button.disabled=true;
  try{const get=name=>document.getElementById('campaign'+name).value,type=get('Type');
    const data={name:get('Name'),type,enabled:document.getElementById('campaignEnabled').checked,min_spend:type==='discount'?0:get('Min'),discount:['coupon','full_reduction'].includes(type)?get('Discount'):0,rate:get('Rate'),product_ids:type==='discount'&&get('Products').trim()?get('Products').split(/[,，]/).map(x=>Number(x.trim())):[],code:get('Code'),max_uses:Number(get('Max')),per_user_limit:Number(get('PerUser')),starts_at:get('Start')?new Date(get('Start')).toISOString():null,ends_at:get('End')?new Date(get('End')).toISOString():null};
    const id=get('Id'),r=await request('/marketing/campaigns'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(data)});if(r.code!==200)throw Error(r.message);document.getElementById('campaignForm').classList.add('hidden');await loadMarketing();marketingMessage(r.message);
  }catch(error){marketingMessage(error.message||'保存失败');}finally{button.disabled=false;}
}
