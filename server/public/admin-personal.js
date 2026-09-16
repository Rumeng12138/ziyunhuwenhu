const personalImages = new Map();
function personalNode(channel,field) { return document.getElementById('personal-'+channel+'-'+field); }
function buildPersonalPaymentCards() {
  for (const channel of ['alipay_personal','wechat_personal']) {
    const name=channel==='alipay_personal'?'普通支付宝':'普通微信';
    const form=document.createElement('form');form.className='bg-white border rounded-lg p-5';
    form.innerHTML=`<div class="flex justify-between items-center"><h3 class="text-lg font-bold">${name}</h3><span id="personal-${channel}-status" class="badge bg-amber-50 text-amber-800">加载中</span></div>
      <p class="text-xs text-gray-500 mt-2">个人收款码，付款不会自动确认到账。与商户通道独立。</p>
      <a id="personal-${channel}-preview" target="_blank" rel="noopener noreferrer" class="block my-4"><img id="personal-${channel}-image" alt="${name}收款码预览" class="mx-auto object-contain" style="height:220px;max-width:100%"></a>
      <label class="block text-sm text-gray-600">替换收款码（PNG / JPG，最多5MB）<input id="personal-${channel}-file" type="file" accept="image/png,image/jpeg" class="block w-full mt-2 text-sm"></label>
      <button id="personal-${channel}-upload" type="button" class="border rounded px-3 py-2 text-sm mt-3">上传图片</button>
      <label class="block text-sm mt-4">收款人名称（选填，以支付应用实际显示为准）<input id="personal-${channel}-recipient" maxlength="60" class="w-full border rounded px-3 py-2 mt-1" autocomplete="off"></label>
      <label class="block text-sm mt-3">给顾客的收款说明<textarea id="personal-${channel}-instructions" maxlength="300" rows="2" class="w-full border rounded px-3 py-2 mt-1" placeholder="请备注订单号，勿重复付款"></textarea></label>
      <label class="flex gap-2 items-center text-sm mt-4"><input id="personal-${channel}-enabled" type="checkbox">启用${name}</label>
      <button id="personal-${channel}-save" type="submit" class="bg-purple-700 text-white rounded w-full py-2.5 mt-4">保存${name}设置</button>`;
    document.getElementById('personalPaymentCards').append(form);
    personalNode(channel,'upload').addEventListener('click',()=>uploadPersonalCode(channel));
    form.addEventListener('submit',event=>{event.preventDefault();savePersonalSettings(channel);});
  }
}
function setPersonalPreview(channel,url) {
  if (!/^\/uploads\/personal-[a-z0-9-]+\.(png|jpg)$/.test(url)) {
    personalNode(channel,'preview').classList.add('hidden');personalImages.delete(channel);return;
  }
  personalImages.set(channel,url);personalNode(channel,'image').src=url;personalNode(channel,'preview').href=url;personalNode(channel,'preview').classList.remove('hidden');
}
async function loadPersonalPaymentSettings() {
  const result=await request('/personal-payments');if(result.code!==200)throw Error(result.message);
  for(const row of result.data) {
    if(!['alipay_personal','wechat_personal'].includes(row.channel))continue;
    const channel=row.channel;setPersonalPreview(channel,row.qr_url);
    personalNode(channel,'enabled').checked=row.enabled;
    personalNode(channel,'recipient').value=row.recipient;
    personalNode(channel,'instructions').value=row.instructions;
    personalNode(channel,'status').textContent=row.enabled&&row.configured?'已启用 · 人工核实':row.configured?'已添加码 · 待启用':'未添加收款码';
  }
}
async function uploadPersonalCode(channel) {
  const file=personalNode(channel,'file').files[0],password=document.getElementById('paymentAdminPassword'),button=personalNode(channel,'upload');
  if(!file){paymentMessage('请先选择收款码图片');return;}
  if(!password.value){password.closest('details').open=true;paymentMessage('上传收款码需验证当前管理员密码，无需更改密码');password.focus();return;}
  if(button.disabled)return;button.disabled=true;
  try {
    const form=new FormData();form.append('file',file);form.append('admin_password',password.value);
    const result=await uploadRequest('/personal-payments/qr',form);if(result.code!==200)throw Error(result.message);
    setPersonalPreview(channel,result.data.url);personalNode(channel,'file').value='';paymentMessage(result.message,true);
  } catch(error){paymentMessage(error.message||'上传失败');}finally{button.disabled=false;}
}
async function savePersonalSettings(channel) {
  const password=document.getElementById('paymentAdminPassword'),button=personalNode(channel,'save');
  if(!password.value){password.closest('details').open=true;paymentMessage('保存收款设置需验证当前管理员密码，无需更改密码');password.focus();return;}
  if(button.disabled)return;button.disabled=true;
  try {
    const result=await request('/personal-payments/'+channel,{method:'PUT',body:JSON.stringify({admin_password:password.value,enabled:personalNode(channel,'enabled').checked,qr_url:personalImages.get(channel),recipient:personalNode(channel,'recipient').value.trim(),instructions:personalNode(channel,'instructions').value.trim()})});
    if(result.code!==200)throw Error(result.message);password.value='';await loadPersonalPaymentSettings();paymentMessage(result.message,true);
  }catch(error){paymentMessage(error.message||'保存失败');}finally{button.disabled=false;}
}
async function openManualReview(id) {
  const result=await request('/orders/'+id);if(result.code!==200){alert(result.message);return;}
  const order=result.data;
  if(!document.getElementById('manualReviewModal')) {
    const modal=document.createElement('div');modal.id='manualReviewModal';modal.className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4';
    modal.innerHTML=`<form id="manualReviewForm" class="bg-white rounded-lg p-6 w-full max-w-xl overflow-y-auto" style="max-height:90vh"><h3 class="text-lg font-bold">人工核实普通收款</h3>
      <p id="manualReviewOrder" class="text-sm mt-3"></p><p id="manualReviewClaim" class="text-sm mt-2 whitespace-pre-wrap"></p>
      <p class="bg-amber-50 text-amber-800 text-sm p-3 rounded mt-3">顾客提交的信息不是到账证明。请登录自己的支付宝 / 微信官方账单核对。确认后允许发货；退回或取消前必须核实未收到款。</p>
      <label class="block text-sm mt-3">核实结果<select id="manualReviewDecision" class="border rounded p-2 w-full mt-1"><option value="confirm">已核实到账，确认收款</option><option value="reject">未到账，退回待支付</option><option value="cancel">未到账，取消并恢复库存</option></select></label>
      <label class="block text-sm mt-3">实际到账金额（确认收款时必填）<input id="manualReviewAmount" type="number" step="0.01" min="0.01" class="border rounded p-2 w-full mt-1"></label>
      <label class="block text-sm mt-3">官方账单中的收款流水号（确认收款时必填）<input id="manualReviewReference" maxlength="100" class="border rounded p-2 w-full mt-1" autocomplete="off"></label>
      <label class="block text-sm mt-3">核实说明（退回 / 取消必填，会展示给顾客）<textarea id="manualReviewNote" maxlength="300" rows="2" class="border rounded p-2 w-full mt-1"></textarea></label>
      <label class="flex items-start gap-2 text-sm mt-3"><input id="manualReviewVerified" type="checkbox" required>我已逐笔核对官方账单、收款人、金额及流水，确认上述核实结果</label>
      <label class="block text-sm mt-3">当前管理员密码<input id="manualReviewPassword" type="password" autocomplete="current-password" required class="border rounded p-2 w-full mt-1"></label>
      <p id="manualReviewError" role="alert" class="text-red-600 text-sm mt-3"></p>
      <div class="flex gap-3 mt-4"><button id="manualReviewSubmit" type="submit" class="bg-purple-700 text-white rounded px-4 py-2">保存核实结果</button><button id="manualReviewClose" type="button" class="border rounded px-4 py-2">关闭</button></div></form>`;
    document.body.append(modal);
    document.getElementById('manualReviewClose').addEventListener('click',()=>{modal.classList.add('hidden');document.getElementById('manualReviewPassword').value='';});
    document.getElementById('manualReviewForm').addEventListener('submit',submitManualReview);
  }
  const form=document.getElementById('manualReviewForm');form.reset();form.dataset.orderId=String(id);
  document.getElementById('manualReviewError').textContent='';
  document.getElementById('manualReviewOrder').textContent='订单 '+order.order_no+' · '+(payMap[order.payment_method]||'普通收款')+' · 应收 ¥'+Number(order.total_amount).toFixed(2);
  document.getElementById('manualReviewClaim').textContent='顾客填写流水：'+(order.manual_claim_reference||'尚未提交')+'\n顾客说明：'+(order.manual_claim_note||'无');
  document.getElementById('manualReviewModal').classList.remove('hidden');
}
async function submitManualReview(event) {
  event.preventDefault();const form=event.currentTarget,button=document.getElementById('manualReviewSubmit');if(button.disabled)return;button.disabled=true;
  try {
    const value=name=>document.getElementById('manualReview'+name).value;
    const result=await request('/personal-payments/orders/'+form.dataset.orderId+'/review',{method:'POST',body:JSON.stringify({decision:value('Decision'),amount:value('Amount'),reference:value('Reference').trim(),note:value('Note').trim(),verified:document.getElementById('manualReviewVerified').checked,admin_password:value('Password')})});
    if(result.code!==200)throw Error(result.message);
    document.getElementById('manualReviewPassword').value='';document.getElementById('manualReviewModal').classList.add('hidden');loadOrders();alert(result.message);
  }catch(error){document.getElementById('manualReviewError').textContent=error.message||'核实失败';}finally{button.disabled=false;}
}
