let storeProfileRevision=0;

const basicFields=[
  ['display_name','店铺名称','text'],
  ['legal_name','经营主体全称','text'],
  ['icp_no','备案号','text'],
];
const contactFields=[
  ['business_address','经营地址','text'],
  ['contact_phone','客服电话','text'],
  ['contact_email','客服邮箱','email'],
  ['service_hours','服务时间','text'],
];
const profileFields=[...basicFields,...contactFields];
const policyFields=[
  ['privacy_policy','隐私政策'],
  ['terms_of_service','服务条款'],
  ['return_policy','售后政策'],
  ['shipping_policy','配送政策'],
  ['invoice_policy','发票政策（不提供发票可留空）'],
];

function profileInputs(fields){
  return fields.map(([id,label,type])=>`<label class="block text-sm">${label}<input id="profile-${id}" type="${type}" class="w-full border rounded p-2 mt-1" maxlength="${id==='contact_email'?120:200}"></label>`).join('');
}

async function loadStoreProfile(){
  const page=document.getElementById('page-store-profile');
  page.innerHTML=`
    <h2 class="text-xl font-bold mb-2">店铺设置</h2>
    <p class="text-sm text-gray-500 mb-5">统一设置前台页脚、联系信息、经营资料和政策文本。只有审核发布后的资料才会在商城公开显示。</p>
    <div id="readinessPanel" class="mb-5"></div>
    <form id="storeProfileForm" class="space-y-4">
      <section class="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <div><h3 class="font-bold text-gray-800">前台页脚设置</h3><p class="text-sm text-gray-500 mt-1">对应商城页脚左侧的店铺名称和简介。</p></div>
        <div id="profileBasics" class="grid md:grid-cols-2 gap-4"></div>
        <label class="block text-sm">店铺简介<textarea id="profile-store_description" class="w-full border rounded p-2 mt-1" rows="4" maxlength="500" placeholder="介绍店铺定位、主营商品与服务特色"></textarea></label>
      </section>
      <section class="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <div><h3 class="font-bold text-gray-800">联系我们</h3><p class="text-sm text-gray-500 mt-1">对应商城页脚右侧的经营地址、电话、邮箱和服务时间。</p></div>
        <div id="profileContacts" class="grid md:grid-cols-2 gap-4"></div>
      </section>
      <section class="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <div><h3 class="font-bold text-gray-800">政策与服务说明</h3><p class="text-sm text-gray-500 mt-1">用于前台的隐私、服务、售后、配送和发票说明。</p></div>
        <div id="profilePolicies" class="space-y-4"></div>
      </section>
      <section class="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <h3 class="font-bold text-gray-800">发布设置</h3>
        <label class="flex gap-2 items-center"><input id="profilePublished" type="checkbox">经营资料审核无误并发布到商城</label>
        <label class="block text-sm">管理员密码<input id="profilePassword" type="password" required class="w-full border rounded p-2 mt-1" autocomplete="current-password"></label>
        <p id="profileMessage" class="text-sm text-purple-700"></p>
        <button class="bg-purple-700 text-white rounded px-4 py-2">保存店铺设置</button>
      </section>
    </form>`;

  document.getElementById('profileBasics').innerHTML=profileInputs(basicFields);
  document.getElementById('profileContacts').innerHTML=profileInputs(contactFields);
  document.getElementById('profilePolicies').innerHTML=policyFields.map(([id,label])=>`<label class="block text-sm">${label}<textarea id="profile-${id}" class="w-full border rounded p-2 mt-1" rows="6" maxlength="20000"></textarea></label>`).join('');

  const result=await request('/store-profile');
  if(result.code===200){
    const data=result.data;
    storeProfileRevision=data.revision;
    [...profileFields,...policyFields].forEach(([id])=>document.getElementById('profile-'+id).value=data[id]||'');
    document.getElementById('profile-store_description').value=data.store_description||'';
    document.getElementById('profilePublished').checked=!!data.published;
  }
  document.getElementById('storeProfileForm').onsubmit=saveStoreProfile;
  loadReadiness();
}

async function loadReadiness(){
  const response=await fetch('/api/readiness');
  const result=await response.json();
  const data=result.data;
  document.getElementById('readinessPanel').innerHTML=`<div class="rounded-lg border p-4 ${data.ready?'bg-green-50':'bg-amber-50'}"><div class="font-bold mb-2">${data.ready?'已满足代码侧上线检查':'尚未满足上线条件'}</div>${data.checks.map(item=>`<div class="text-sm py-1"><span class="${item.ok?'text-green-700':'text-red-700'}">${item.ok?'✓':'✕'}</span> ${escapeRecord(item.message)}</div>`).join('')}</div>`;
}

async function saveStoreProfile(event){
  event.preventDefault();
  const body={
    revision:storeProfileRevision,
    published:document.getElementById('profilePublished').checked,
    store_description:document.getElementById('profile-store_description').value,
    admin_password:document.getElementById('profilePassword').value,
  };
  [...profileFields,...policyFields].forEach(([id])=>body[id]=document.getElementById('profile-'+id).value);
  const result=await request('/store-profile',{method:'PUT',body:JSON.stringify(body)});
  document.getElementById('profileMessage').textContent=result.message||'';
  if(result.code===200){
    storeProfileRevision=result.data.revision;
    document.getElementById('profilePassword').value='';
    loadReadiness();
  }
}
