const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sessionSecretPath}=require('./storage');
// Replace a demo signing secret without changing the administrator's password or editing .env.
function initialize() {
  const configured=process.env.JWT_SECRET||'';
  if(configured.length>=32&&!configured.includes('ziyunhu_wenfang_secret'))return;
  const file=sessionSecretPath;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(48).toString('hex'),{flag:'wx',mode:0o600});
  const secret=fs.readFileSync(file,'utf8').trim();
  if(secret.length<64)throw Error('本机会话签名文件无效');
  process.env.JWT_SECRET=secret;
}
module.exports={initialize};
