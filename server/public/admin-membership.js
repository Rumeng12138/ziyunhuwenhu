let memberSettings = null;
function buildMembershipSettings() {
  const page = document.getElementById('page-membership');
  if (document.getElementById('membershipForm')) return;
  page.innerHTML = `<h2 class="text-xl font-bold mb-4">会员与签到设置</h2>
    <form id="membershipForm" class="bg-white border rounded-lg p-6 max-w-xl space-y-4">
      <label class="flex items-center gap-3 font-bold"><input id="membershipEnabled" type="checkbox">开启会员功能</label>
      <p class="text-sm text-gray-600">关闭后，前台隐藏会员等级和权益，新订单不享会员价、不累积消费积分或升级。已有积分、等级和历史订单保留。重新开启后继续使用。</p>
      <label class="flex items-center gap-3 font-bold"><input id="checkinEnabled" type="checkbox">开启每日签到</label>
      <p class="text-sm text-gray-600">独立控制。每天按北京时间仅可领取一次10积分；关闭后前台隐藏签到入口，接口也禁止领取。会员关闭时仍可单独开启签到。</p>
      <p class="text-sm text-gray-500">会员规则：银卡累计500元、金卡2000元、钻石5000元。会员价与商品促销取更优惠的一项，再计算满减和优惠券。已下单的优惠及积分倍率保持原快照，不追溯修改。</p>
      <p id="membershipMessage" role="status" class="text-sm text-purple-700"></p>
      <div class="flex gap-3"><button id="saveMembership" type="submit" class="bg-purple-700 text-white rounded px-4 py-2" disabled>保存设置</button><button id="refreshMembership" type="button" class="border rounded px-4 py-2">重新加载</button></div>
    </form>`;
  document.getElementById('refreshMembership').onclick = loadMembershipSettings;
  document.getElementById('membershipForm').onsubmit = async event => {
    event.preventDefault(); const button = document.getElementById('saveMembership');
    if (button.disabled || !memberSettings) return;
    button.disabled = true;
    const message = document.getElementById('membershipMessage');
    try {
      const result = await request('/store-settings', { method:'PUT', body:JSON.stringify({
        membership_enabled:document.getElementById('membershipEnabled').checked,
        checkin_enabled:document.getElementById('checkinEnabled').checked, revision:memberSettings.revision,
      }) });
      if (result.code !== 200) throw Error(result.message);
      memberSettings = result.data;
      message.textContent = result.message + '。前台将在切换回页面或30秒内同步。';
    } catch(error) { message.textContent = error.message; }
    finally { button.disabled = !memberSettings; }
  };
}
async function loadMembershipSettings() {
  buildMembershipSettings(); memberSettings = null;
  document.getElementById('saveMembership').disabled = true;
  const message = document.getElementById('membershipMessage'); message.textContent = '正在加载…';
  try {
    const result = await request('/store-settings');
    if (result.code !== 200) throw Error(result.message);
    memberSettings = result.data;
    document.getElementById('membershipEnabled').checked = memberSettings.membership_enabled;
    document.getElementById('checkinEnabled').checked = memberSettings.checkin_enabled;
    document.getElementById('saveMembership').disabled = false;
    message.textContent = '当前设置已加载';
  } catch(error) { message.textContent = error.message || '加载失败，请重试'; }
}
