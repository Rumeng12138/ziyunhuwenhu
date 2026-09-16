const staffPage=document.getElementById('page-staff');
staffPage.innerHTML=`
  <div class="flex justify-between items-center mb-6">
    <div><h2 class="text-xl font-bold text-gray-800">子账号管理</h2><p class="text-sm text-gray-500 mt-1">主账号可创建后台子账号，并按工作职责分配可访问的功能。</p></div>
    <button onclick="openStaffModal()" class="text-white px-4 py-2 rounded text-sm" style="background:#6B4E91;"><i class="fa fa-plus mr-1"></i>新增子账号</button>
  </div>
  <div class="bg-white rounded-lg shadow-sm overflow-hidden">
    <div class="overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-gray-50 text-gray-600"><tr><th class="text-left p-3">账号</th><th class="text-left p-3">显示名称</th><th class="text-left p-3">权限</th><th class="text-left p-3">创建时间</th><th class="text-left p-3">操作</th></tr></thead>
      <tbody id="staffTable"></tbody>
    </table></div>
  </div>
  <div id="staffModal" class="fixed inset-0 z-50 hidden items-center justify-center modal-mask">
    <div class="bg-white rounded-lg w-full max-w-xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4"><h3 id="staffModalTitle" class="text-lg font-bold">新增子账号</h3><button onclick="closeStaffModal()" class="text-gray-400 text-xl"><i class="fa fa-times"></i></button></div>
      <input id="staffId" type="hidden">
      <div class="space-y-4">
        <div><label class="text-sm text-gray-600">登录账号</label><input id="staffUsername" autocomplete="off" class="w-full border px-3 py-2 rounded mt-1 text-sm" placeholder="3-32位字母、数字、点、横线或下划线"></div>
        <div><label class="text-sm text-gray-600">显示名称</label><input id="staffNickname" class="w-full border px-3 py-2 rounded mt-1 text-sm" placeholder="例如：商品运营"></div>
        <div><label class="text-sm text-gray-600">登录密码</label><input id="staffPassword" type="password" autocomplete="new-password" class="w-full border px-3 py-2 rounded mt-1 text-sm" placeholder="新增时必填；修改时留空则不变"></div>
        <fieldset><legend class="text-sm text-gray-600 mb-2">功能权限（至少选择一项）</legend><div id="staffPermissionList" class="grid grid-cols-2 gap-3"></div></fieldset>
        <p id="staffFormMessage" class="text-sm text-red-600"></p>
      </div>
      <div class="flex gap-3 mt-5"><button onclick="saveStaff()" class="flex-1 text-white py-2 rounded" style="background:#6B4E91;">保存</button><button onclick="closeStaffModal()" class="flex-1 border py-2 rounded text-gray-600">取消</button></div>
    </div>
  </div>`;

let staffList=[],staffPermissionOptions=[];
function renderStaffPermissions(selected=[]){
  const chosen=new Set(selected);
  document.getElementById('staffPermissionList').innerHTML=staffPermissionOptions.map(item=>`<label class="flex items-center gap-2 border rounded p-3"><input type="checkbox" name="staffPermission" value="${item.id}" ${chosen.has(item.id)?'checked':''}><span>${escapeRecord(item.label)}</span></label>`).join('');
}
function loadStaff(){
  request('/staff').then(res=>{
    if(res.code!==200){alert(res.message);return;}
    staffList=res.data.list;staffPermissionOptions=res.data.permission_options;
    const table=document.getElementById('staffTable');
    table.innerHTML=staffList.length?staffList.map(item=>{const safe=escapeRecord({...item,permissionLabels:item.permissions.map(id=>staffPermissionOptions.find(p=>p.id===id)?.label||id).join('、')});return `<tr class="border-t"><td class="p-3 font-medium">${safe.username}</td><td class="p-3">${safe.nickname}</td><td class="p-3 text-gray-600">${safe.permissionLabels}</td><td class="p-3 text-gray-500">${safe.created_at||'-'}</td><td class="p-3 whitespace-nowrap"><button class="text-purple-600 mr-3" onclick="openStaffModal(${safe.id})">修改</button><button class="text-red-600" onclick="deleteStaff(${safe.id})">删除</button></td></tr>`;}).join(''):'<tr><td colspan="5" class="p-8 text-center text-gray-400">暂无子账号</td></tr>';
  }).catch(error=>alert(error.message));
}
function openStaffModal(id){
  const item=id?staffList.find(staff=>staff.id===id):null;
  document.getElementById('staffModalTitle').textContent=item?'修改子账号':'新增子账号';
  document.getElementById('staffId').value=item?.id||'';
  document.getElementById('staffUsername').value=item?.username||'';
  document.getElementById('staffNickname').value=item?.nickname||'';
  document.getElementById('staffPassword').value='';
  document.getElementById('staffFormMessage').textContent='';
  renderStaffPermissions(item?.permissions||[]);
  document.getElementById('staffModal').classList.remove('hidden');document.getElementById('staffModal').classList.add('flex');
}
function closeStaffModal(){document.getElementById('staffModal').classList.add('hidden');document.getElementById('staffModal').classList.remove('flex');}
async function saveStaff(){
  const id=document.getElementById('staffId').value;
  const permissions=[...document.querySelectorAll('input[name="staffPermission"]:checked')].map(input=>input.value);
  const body={username:document.getElementById('staffUsername').value,nickname:document.getElementById('staffNickname').value,password:document.getElementById('staffPassword').value,permissions};
  const result=await request(id?'/staff/'+id:'/staff',{method:id?'PUT':'POST',body:JSON.stringify(body)});
  document.getElementById('staffFormMessage').textContent=result.code===200?'':result.message;
  if(result.code===200){closeStaffModal();loadStaff();}
}
async function deleteStaff(id){
  const item=staffList.find(staff=>staff.id===id);if(!item||!confirm(`确定删除子账号“${item.nickname}（${item.username}）”吗？删除后其登录会话会立即失效。`))return;
  const result=await request('/staff/'+id,{method:'DELETE'});if(result.code===200)loadStaff();else alert(result.message);
}
