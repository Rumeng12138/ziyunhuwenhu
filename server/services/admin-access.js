const PERMISSIONS = Object.freeze([
  { id:'dashboard', label:'仪表盘' },
  { id:'products', label:'商品管理' },
  { id:'orders', label:'订单管理' },
  { id:'users', label:'用户管理' },
  { id:'feedbacks', label:'反馈管理' },
  { id:'after_sales', label:'售后管理' },
  { id:'payments', label:'收款设置' },
  { id:'marketing', label:'运费与活动' },
  { id:'membership', label:'会员与签到' },
  { id:'editorial', label:'首页装修' },
  { id:'store_profile', label:'店铺设置' },
]);

const permissionIds = new Set(PERMISSIONS.map(item=>item.id));

function parsePermissions(value) {
  try {
    const parsed=Array.isArray(value)?value:JSON.parse(value||'[]');
    return [...new Set(parsed.filter(item=>permissionIds.has(item)))];
  } catch { return []; }
}

function normalizePermissions(value) {
  if(!Array.isArray(value))throw Object.assign(new Error('请选择子账号权限'),{status:400});
  const result=[...new Set(value)];
  if(!result.length||result.some(item=>!permissionIds.has(item)))throw Object.assign(new Error('子账号权限无效'),{status:400});
  return result;
}

function publicAdmin(row) {
  return {
    id:row.id,
    username:row.username,
    nickname:row.nickname||row.username,
    is_owner:Boolean(row.is_owner),
    permissions:row.is_owner?PERMISSIONS.map(item=>item.id):parsePermissions(row.admin_permissions),
  };
}

function requiredPermission(req) {
  const base=req.baseUrl||'';
  if(base.endsWith('/payment-settings')||base.endsWith('/merchant-connect')||base.endsWith('/personal-payments'))return 'payments';
  if(base.endsWith('/marketing'))return 'marketing';
  if(base.endsWith('/store-settings'))return 'membership';
  if(base.endsWith('/editorial-content'))return 'editorial';
  if(base.endsWith('/store-profile'))return 'store_profile';
  if(base.endsWith('/after-sales'))return 'after_sales';
  if(base.endsWith('/admin')){
    const section=(req.path||'/').split('/').filter(Boolean)[0];
    return ({dashboard:'dashboard',products:'products',upload:'products',orders:'orders',users:'users',feedbacks:'feedbacks'})[section]||null;
  }
  return null;
}

module.exports={PERMISSIONS,parsePermissions,normalizePermissions,publicAdmin,requiredPermission};
