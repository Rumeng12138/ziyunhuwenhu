const db = require('../config/db');
const { fail } = require('./commerce');
const validate = require('./validation');

const fields = ['display_name','store_description','legal_name','contact_phone','contact_email','business_address','service_hours','icp_no','privacy_policy','terms_of_service','return_policy','shipping_policy','invoice_policy'];

function get() {
  const row = db.prepare('SELECT * FROM store_profile WHERE id=1').get();
  return { ...row, published: !!row.published, editorial_content_published:!!row.editorial_content_published };
}

function publicProfile() {
  const profile = get();
  return Object.fromEntries([...fields, 'published', 'revision', 'updated_at'].map(key => [key, profile[key]]));
}
function catalogStatus(){
  const row=db.prepare("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN TRIM(COALESCE(image,''))='' OR image LIKE '%picsum.photos%' THEN 1 ELSE 0 END),0) invalid FROM products WHERE status=1").get();
  return {ok:row.total>0&&row.invalid===0,total:row.total,invalid:row.invalid};
}
function tradeReady(){return get().published&&catalogStatus().ok;}

function normalize(input) {
  const profile = {
    display_name: validate.text(input.display_name, '店铺名称', { max: 60 }),
    store_description: validate.optionalText(input.store_description, '店铺简介', 500),
    legal_name: validate.optionalText(input.legal_name, '经营主体', 100),
    contact_phone: validate.optionalText(input.contact_phone, '客服电话', 40),
    contact_email: validate.optionalText(input.contact_email, '客服邮箱', 120),
    business_address: validate.optionalText(input.business_address, '经营地址', 200),
    service_hours: validate.optionalText(input.service_hours, '服务时间', 100),
    icp_no: validate.optionalText(input.icp_no, '备案号', 80),
    privacy_policy: validate.optionalText(input.privacy_policy, '隐私政策', 20000),
    terms_of_service: validate.optionalText(input.terms_of_service, '服务条款', 20000),
    return_policy: validate.optionalText(input.return_policy, '售后政策', 10000),
    shipping_policy: validate.optionalText(input.shipping_policy, '配送政策', 10000),
    invoice_policy: validate.optionalText(input.invoice_policy, '发票政策', 10000),
    published: validate.boolean(input.published, '发布状态'),
  };
  if (profile.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.contact_email)) fail('客服邮箱格式不正确');
  if (profile.published) {
    for (const [key, label] of [['legal_name','经营主体'],['contact_phone','客服电话'],['business_address','经营地址'],['privacy_policy','隐私政策'],['terms_of_service','服务条款'],['return_policy','售后政策'],['shipping_policy','配送政策']]) {
      if (!profile[key]) fail(`发布前请填写${label}`);
    }
    if (process.env.REQUIRE_ICP === '1' && !profile.icp_no) fail('当前部署要求填写真实备案号后才能发布');
  }
  return profile;
}

const save = db.transaction(input => {
  const current = get();
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) fail('经营资料已被其他管理员修改，请刷新后重试', 409);
  const value = normalize(input);
  db.prepare(`UPDATE store_profile SET ${fields.map(key=>`${key}=?`).join(',')},published=?,revision=revision+1,updated_at=datetime('now','localtime') WHERE id=1`)
    .run(...fields.map(key => value[key]), value.published ? 1 : 0);
  return get();
});

module.exports = { get, publicProfile, save, catalogStatus, tradeReady };
