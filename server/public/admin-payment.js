// Included by admin.html. Secrets are sent only on explicit save and never stored in the browser.
const paymentFields = {
  alipay: [ ['appId','应用 APPID'], ['sellerId','收款支付宝商户 UID（2088 开头）'], ['keyType','私钥格式'],
    ['privateKey','应用私钥 PEM',true], ['alipayPublicKey','支付宝公钥 PEM',true], ['notifyUrl','异步回调地址 HTTPS'], ['returnUrl','付款返回地址 HTTPS'] ],
  wechat: [ ['appid','已关联的 APPID'], ['mchid','微信支付商户号'], ['merchantSerialNumber','商户 API 证书序列号'],
    ['platformSerial','微信支付公钥 ID / 平台证书序列号'], ['apiV3Key','API v3 密钥（32字节）',true], ['privateKey','商户 API 私钥 PEM',true],
    ['platformPublicKey','微信支付平台公钥 PEM',true], ['notifyUrl','异步回调地址 HTTPS'] ],
};
let paymentSettingsState = null;
function paymentMessage(text, success = false) {
  const node = document.getElementById('paymentMessage');
  node.textContent = text; node.className = 'p-4 rounded mb-4 ' + (success ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800');
}
function buildPaymentPage() {
  const page = document.getElementById('page-payments');
  page.innerHTML = `<div class="flex justify-between items-center mb-3"><h2 class="text-xl font-bold text-gray-800">收款设置</h2><button class="border rounded px-4 py-2 text-sm" onclick="loadPaymentSettings()">刷新状态</button></div>
    <p class="text-gray-500 text-sm mb-5">连接商户收银台，顾客付款进入你的商户账户。普通个人收款码可以人工收款，但不能通过扫码登录直接开通网站自动确认到账。</p>
    <div id="paymentMessage" role="status" aria-live="polite" class="mb-4"></div>
    <details class="bg-white rounded-lg p-5 mb-5 border"><summary class="font-bold cursor-pointer">收款操作验证 / 账号设置（需要保存时展开）</summary><p class="text-sm text-gray-500 my-3">更换收款账户或上传收款码时验证当前管理员密码。本机使用普通收款无需更改现有密码。</p>
      <label class="text-sm block">当前管理员密码<input id="paymentAdminPassword" type="password" autocomplete="current-password" class="border rounded px-3 py-2 block mt-1 w-full max-w-md"></label>
      <details class="mt-3 text-sm"><summary class="cursor-pointer text-purple-700">修改管理员密码（可选）</summary><label class="block mt-3">新密码（12至72位，包含字母和数字）<input id="paymentNewPassword" type="password" autocomplete="new-password" class="border rounded px-3 py-2 block mt-1 w-full max-w-md"></label><button class="border rounded px-3 py-2 mt-3" onclick="changePaymentAdminPassword()">更新管理员密码</button></details></details>
    <h3 class="font-bold text-lg mb-2">普通账户收款 · 人工核实</h3><p class="text-sm text-gray-500 mb-4">上传个人收款码，无需 APPID 或支付密钥。顾客付款后提交转账信息，你在订单管理核对官方账单后确认。首次启用前请试扫收款码并核对收款人。</p>
    <div id="personalPaymentCards" class="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6"></div>
    <h3 class="font-bold text-lg mb-2">商户账户收款 · 平台自动验证</h3><p class="text-sm text-gray-500 mb-4">已开通商户支付产品时使用，与上方普通收款独立设置。</p>
    <div id="merchantConnectCards" class="grid grid-cols-1 xl:grid-cols-2 gap-5"></div>
    <details class="mt-5 border rounded-lg bg-white p-5"><summary class="cursor-pointer font-bold text-gray-700">手动配置（高级）</summary><p class="text-sm text-gray-500 my-3">已有自己的支付应用和密钥时使用。通过授权绑定的渠道由授权管理，不能在此覆盖。</p><div id="paymentChannelCards" class="grid grid-cols-1 xl:grid-cols-2 gap-5"></div></details>
    <section class="bg-white border rounded-lg p-6 mt-5"><div class="flex items-center justify-between"><h3 class="font-bold text-lg">银行卡结算</h3><span class="badge bg-blue-50 text-blue-700">在官方商户平台绑定</span></div>
      <p class="text-gray-600 text-sm mt-3">支付宝 / 微信收到顾客付款后，按照各自商户协议结算到已验证的银行卡。请在对应平台完成开户名、卡号及身份验证；本站无法代替支付机构完成绑卡。</p>
      <div class="flex flex-wrap gap-3 mt-4"><a href="https://b.alipay.com/" target="_blank" rel="noopener noreferrer" class="border rounded px-4 py-2 text-sm text-blue-700">支付宝商家平台 · 绑定结算卡 ↗</a><a href="https://pay.weixin.qq.com/" target="_blank" rel="noopener noreferrer" class="border rounded px-4 py-2 text-sm text-green-700">微信支付商户平台 · 绑定结算卡 ↗</a></div>
      <p class="mt-4 text-xs text-gray-500">银行卡直接收单尚未接入。本页不收集完整卡号、支付密码或 CVV。买家可在支付宝或微信收银台选择自己的银行卡。</p></section>
    <p class="mt-5 text-xs text-gray-500">商户密钥仅保存于服务器加密存储中，读取接口不返回密钥。请备份数据库及服务器加密密钥；公网部署另需 HTTPS 和安全管理员凭据。</p>`;
  buildPersonalPaymentCards();
  buildMerchantConnectCards();
  for (const channel of ['alipay','wechat']) {
    const card = document.createElement('form'); card.id = 'paymentForm-' + channel;
    card.className = 'bg-white rounded-lg border p-6';
    card.autocomplete = 'off';
    const name = channel === 'alipay' ? '商户支付宝' : '商户微信';
    card.innerHTML = `<div class="flex justify-between items-center mb-2"><h3 class="text-lg font-bold">${name}</h3><span id="paymentStatus-${channel}" class="badge bg-gray-100">加载中</span></div>
      <p class="text-sm text-gray-500 mb-4">${channel === 'alipay' ? '需开通电脑网站支付，使用正式应用和正式网关。' : '需开通 Native 支付，并完成商户号与 APPID 关联。'}</p>
      <label class="flex items-center gap-2 text-sm mb-4"><input id="payment-${channel}-enabled" type="checkbox">启用此收款渠道</label>
      <div id="paymentFields-${channel}" class="space-y-3"></div>
      <button type="submit" class="w-full bg-purple-700 text-white rounded py-2.5 mt-5">保存${name}配置</button>`;
    for (const [field,label,secret] of paymentFields[channel]) {
      const wrapper = document.createElement('label'); wrapper.className = 'block text-sm text-gray-600';
      const caption = document.createElement('span'); caption.textContent = label; wrapper.append(caption);
      let input;
      if (field === 'keyType') { input = document.createElement('select'); for (const type of ['PKCS8','PKCS1']) { const option = document.createElement('option'); option.value = option.textContent = type; input.append(option); } }
      else if (secret && field !== 'apiV3Key') { input = document.createElement('textarea'); input.rows = 3; input.style.webkitTextSecurity = 'disc'; }
      else { input = document.createElement('input'); input.type = secret ? 'password' : 'text'; }
      input.id = 'payment-' + channel + '-' + field;
      input.autocomplete = secret ? 'new-password' : 'off'; input.spellcheck = false;
      input.className = 'w-full border rounded px-3 py-2 mt-1 text-sm';
      input.placeholder = secret ? '粘贴密钥；保存后不会回显' : '';
      wrapper.append(input); card.querySelector('#paymentFields-' + channel).append(wrapper);
    }
    card.addEventListener('submit', event => { event.preventDefault(); savePaymentSettings(channel); });
    document.getElementById('paymentChannelCards').append(card);
  }
}
async function loadPaymentSettings() {
  if (!document.getElementById('paymentChannelCards')) buildPaymentPage();
  try {
    const result = await request('/payment-settings');
    if (result.code !== 200) throw Error(result.message);
    paymentSettingsState = result.data;
    for (const channel of ['alipay','wechat']) {
      const data = result.data[channel];
      document.getElementById('payment-' + channel + '-enabled').checked = data.enabled;
      const badge = document.getElementById('paymentStatus-' + channel);
      const managed = data.authorizationManaged || data.environmentManaged;
      badge.textContent = data.authorizationManaged ? '商户授权管理' : data.environmentManaged ? '服务器环境变量管理' : data.configured ? '已配置 · 待实收验证' : '未开通收款';
      badge.className = 'badge ' + (data.configured ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700');
      for (const [field,,secret] of paymentFields[channel]) {
        const input = document.getElementById('payment-' + channel + '-' + field);
        input.value = secret ? '' : data.fields[field] || (field === 'keyType' ? 'PKCS8' : '');
        if (secret) input.placeholder = data.secretSet[field] ? '已保存，留空保持不变' : '请粘贴完整密钥';
        input.disabled = managed;
      }
      document.getElementById('payment-' + channel + '-enabled').disabled = managed;
      document.querySelector('#paymentForm-' + channel + ' button[type=submit]').disabled = managed;
    }
    await loadPersonalPaymentSettings();
    await loadMerchantConnect();
  } catch(error) { paymentMessage(error.message || '无法加载收款设置'); }
}

// Only session identifiers are kept here. Provider tokens never reach this page.
const merchantSessions = new Map();
const merchantTimers = new Map();
function connectNode(channel, name) { return document.getElementById('connect-' + channel + '-' + name); }
function buildMerchantConnectCards() {
  for (const channel of ['alipay','wechat']) {
    const card = document.createElement('section');
    card.className = 'bg-white rounded-lg border p-6';
    const alipay = channel === 'alipay';
    card.innerHTML = `<div class="flex justify-between gap-3 items-center"><h3 class="text-lg font-bold">${alipay ? '商户支付宝' : '商户微信'}</h3><span id="connect-${channel}-badge" class="badge bg-gray-100">加载中</span></div>
      <p class="text-sm text-gray-500 mt-3">${alipay ? '前往支付宝官方页面扫码或登录，授权后返回此处核对收款商户。需已开通当面付及服务商代调用权限。' : '由微信商户超级管理员扫码完成服务商进件签约。仅支持已有服务商进件申请，不是普通微信登录。'}</p>
      <p id="connect-${channel}-config" class="text-sm text-amber-800 bg-amber-50 p-3 rounded mt-4"></p>
      <p id="connect-${channel}-binding" class="text-sm text-gray-700 mt-3"></p>
      ${alipay ? '' : '<label class="block text-sm text-gray-600 mt-4">服务商进件申请单号<input id="connect-wechat-applyment" type="text" inputmode="numeric" placeholder="由服务商平台提供" class="w-full border rounded px-3 py-2 mt-1"></label>'}
      <button id="connect-${channel}-start" type="button" disabled class="w-full bg-purple-700 text-white rounded py-2.5 mt-4 disabled:opacity-50">${alipay ? '扫码 / 登录授权' : '获取签约二维码'}</button>
      <div id="connect-${channel}-session" class="hidden border-t mt-5 pt-4">
        <p id="connect-${channel}-status" role="status" aria-live="polite" class="text-sm text-gray-700"></p>
        <img id="connect-${channel}-qr" alt="${alipay ? '支付宝授权' : '微信商户签约'}二维码" class="hidden mx-auto mt-3" width="220" height="220">
        <a id="connect-${channel}-link" target="_blank" rel="noopener noreferrer" class="hidden text-sm text-blue-700 mt-3">打开官方授权页面 ↗</a>
        <button id="connect-${channel}-refresh" class="border rounded px-3 py-2 text-sm mt-3" type="button">刷新授权状态</button>
        <div id="connect-${channel}-confirmation" class="hidden bg-amber-50 rounded p-3 mt-4">
          <p class="text-sm text-amber-800">请核对收款商户号。确认后网站付款将使用此商户；授权成功不代表已通过实收验证。</p>
          <label class="block text-sm mt-3">输入上方商户号确认<input id="connect-${channel}-merchant" class="w-full border rounded px-3 py-2 mt-1" autocomplete="off"></label>
          <button id="connect-${channel}-confirm" type="button" class="w-full bg-purple-700 text-white rounded py-2 mt-3">确认绑定此收款商户</button>
        </div>
      </div>`;
    document.getElementById('merchantConnectCards').append(card);
    connectNode(channel,'start').addEventListener('click', () => startMerchantConnect(channel));
    connectNode(channel,'refresh').addEventListener('click', () => refreshMerchantSession(channel));
    connectNode(channel,'confirm').addEventListener('click', () => confirmMerchantConnect(channel));
  }
}
async function loadMerchantConnect() {
  const result = await request('/merchant-connect');
  if (result.code !== 200) throw Error(result.message);
  for (const capability of result.data) {
    const channel = capability.channel;
    if (!['alipay','wechat'].includes(channel)) continue;
    connectNode(channel,'start').disabled = !capability.ready;
    connectNode(channel,'badge').textContent = capability.binding?.status === 'bound' ? '已绑定 · 待实收验证' : capability.binding ? '授权已到期' : capability.ready ? '可发起授权' : '待服务商配置';
    connectNode(channel,'config').textContent = capability.ready
      ? '服务商参数已配置。请先在上方输入管理员密码，再发起授权；本站不收集支付宝或微信登录密码。'
      : '暂不能生成真实授权码：网站运营方需先配置官方服务商应用及回调地址。仅有普通支付宝 / 微信账号无法启用自动收款。';
    connectNode(channel,'binding').textContent = capability.binding ? '当前收款商户号：' + capability.binding.merchantId : '尚未通过此入口绑定商户';
    if (merchantSessions.has(channel)) refreshMerchantSession(channel);
  }
}
function renderMerchantSession(channel, data) {
  merchantSessions.set(channel, data.id);
  connectNode(channel,'session').classList.remove('hidden');
  const labels = {pending:'等待平台授权或审核',exchanging:'正在核验平台授权',authorized:'授权已返回，待你确认绑定',confirmed:'已绑定；实际收款仍需实单验证',expired:'授权会话已过期，请重新发起',failed:'授权未完成，请重新发起'};
  connectNode(channel,'status').textContent = (labels[data.status] || '授权状态未知') + (data.merchantId ? ' · 商户号：' + data.merchantId : '') + (data.message ? '。' + data.message : '');
  connectNode(channel,'confirmation').classList.toggle('hidden', data.status !== 'authorized');
  if (data.authorizationUrl) {
    const url = new URL(data.authorizationUrl);
    const hosts = channel === 'alipay' ? ['openauth.alipay.com'] : ['pay.weixin.qq.com','pay.wechatpay.cn'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password) throw Error('平台授权地址无效');
    connectNode(channel,'link').href = url.href;
    connectNode(channel,'link').classList.remove('hidden');
    if (data.qrCode?.startsWith('data:image/png;base64,')) {
      connectNode(channel,'qr').src = data.qrCode; connectNode(channel,'qr').classList.remove('hidden');
    }
  }
  if (!['pending','exchanging'].includes(data.status)) {
    connectNode(channel,'qr').classList.add('hidden'); connectNode(channel,'link').classList.add('hidden');
  }
  clearTimeout(merchantTimers.get(channel));
  if (['pending','exchanging'].includes(data.status)) merchantTimers.set(channel, setTimeout(() => {
    if (!document.getElementById('page-payments').classList.contains('hidden')) refreshMerchantSession(channel);
  }, 5000));
}
async function startMerchantConnect(channel) {
  const password = document.getElementById('paymentAdminPassword'), button = connectNode(channel,'start');
  if (!password.value) { paymentMessage('请先输入当前管理员密码。'); password.focus(); return; }
  if (button.disabled) return;
  button.disabled = true;
  try {
    const body = {admin_password:password.value};
    if (channel === 'wechat') body.applyment_id = connectNode(channel,'applyment').value.trim();
    const result = await request('/merchant-connect/' + channel + '/sessions', {method:'POST',body:JSON.stringify(body)});
    if (result.code !== 200) throw Error(result.message);
    password.value = '';
    connectNode(channel,'qr').classList.add('hidden'); connectNode(channel,'link').classList.add('hidden');
    connectNode(channel,'merchant').value = '';
    renderMerchantSession(channel,result.data);
    paymentMessage('请在官方页面授权。完成后回到此处核对商户号，并再次输入管理员密码确认绑定。',true);
  } catch(error) { paymentMessage(error.message || '无法发起授权'); }
  finally { button.disabled = false; }
}
async function refreshMerchantSession(channel) {
  const id = merchantSessions.get(channel), button = connectNode(channel,'refresh');
  if (!id || button.disabled) return;
  button.disabled = true; clearTimeout(merchantTimers.get(channel));
  try {
    const result = await request('/merchant-connect/sessions/' + encodeURIComponent(id));
    if (result.code !== 200) throw Error(result.message);
    if (merchantSessions.get(channel) === id) renderMerchantSession(channel,result.data);
  } catch(error) { connectNode(channel,'status').textContent = error.message || '状态查询失败，请手动刷新'; }
  finally { button.disabled = false; }
}
async function confirmMerchantConnect(channel) {
  const id = merchantSessions.get(channel), password = document.getElementById('paymentAdminPassword'), button = connectNode(channel,'confirm');
  if (!id || button.disabled) return;
  if (!password.value) { paymentMessage('请再次输入管理员密码确认绑定。'); password.focus(); return; }
  button.disabled = true;
  try {
    const result = await request('/merchant-connect/sessions/' + encodeURIComponent(id) + '/confirm', {method:'POST',body:JSON.stringify({admin_password:password.value,merchant_id:connectNode(channel,'merchant').value.trim()})});
    if (result.code !== 200) throw Error(result.message);
    password.value = ''; await loadPaymentSettings(); paymentMessage(result.message,true);
  } catch(error) { paymentMessage(error.message || '绑定失败'); }
  finally { button.disabled = false; }
}
async function savePaymentSettings(channel) {
  const button = document.querySelector('#paymentForm-' + channel + ' button[type=submit]');
  if (button.disabled) return;
  const password = document.getElementById('paymentAdminPassword');
  if (!password.value) { paymentMessage('请输入当前管理员密码确认保存。'); password.focus(); return; }
  const data = { enabled: document.getElementById('payment-' + channel + '-enabled').checked };
  for (const [field,,secret] of paymentFields[channel]) {
    const input = document.getElementById('payment-' + channel + '-' + field);
    if (!secret || input.value.trim()) data[field] = input.value.trim();
  }
  button.disabled = true;
  try {
    const result = await request('/payment-settings/' + channel, { method:'PUT', body:JSON.stringify({settings:data,admin_password:password.value}) });
    if (result.code !== 200) throw Error(result.message);
    password.value = ''; await loadPaymentSettings(); paymentMessage(result.message, true);
  } catch(error) { paymentMessage(error.message || '保存失败，请重试'); }
  finally { button.disabled = false; }
}
async function changePaymentAdminPassword() {
  const password = document.getElementById('paymentAdminPassword'), next = document.getElementById('paymentNewPassword');
  try {
    const result = await request('/payment-settings/password', {method:'PUT',body:JSON.stringify({admin_password:password.value,new_password:next.value})});
    if (result.code !== 200) throw Error(result.message);
    password.value = ''; next.value = ''; paymentMessage('密码已更新，请在上方输入新密码后保存商户配置。', true);
  } catch(error) { paymentMessage(error.message); }
}
