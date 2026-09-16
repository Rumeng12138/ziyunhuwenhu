const db=require('../config/db');
const validate=require('./validation');
const {fail}=require('./commerce');
const KEYS=['hero','treasures','artisans','culture','brand_story'];
const LAYOUTS=['centered','left','split'];
const ITEM_LAYOUTS=['two','three','four','list'];

function itemRow(item){return {...item,published:Boolean(item.published)};}
function row(section){
  return {...section,published:Boolean(section.published),items:db.prepare('SELECT * FROM editorial_items WHERE section_key=? ORDER BY sort_order,id').all(section.section_key).map(itemRow)};
}
function get(){return {sections:db.prepare('SELECT * FROM editorial_sections ORDER BY sort_order,section_key').all().map(row)};}
function publicContent(){return {sections:get().sections.filter(section=>section.published).map(section=>({...section,items:section.items.filter(item=>item.published)}))};}
function readinessStatus(){
  const sections=get().sections;
  const missing=KEYS.filter(key=>{
    const section=sections.find(value=>value.section_key===key);
    return !section?.published||(key!=='hero'&&!section.items.some(item=>item.published));
  });
  return {ok:missing.length===0,missing};
}
function normalizeItem(item,sectionKey,index){
  const value={
    id:item.id===null||item.id===undefined||item.id===''?null:Number(item.id),
    section_key:sectionKey,
    symbol_zh:validate.optionalText(item.symbol_zh,'中文视觉字',20),symbol_en:validate.optionalText(item.symbol_en,'英文视觉字',30),
    label_zh:validate.optionalText(item.label_zh,'中文标签',80),label_en:validate.optionalText(item.label_en,'英文标签',120),
    title_zh:validate.text(item.title_zh,'子内容中文标题',{max:160}),title_en:validate.text(item.title_en,'子内容英文标题',{max:240}),
    meta_zh:validate.optionalText(item.meta_zh,'中文辅助信息',160),meta_en:validate.optionalText(item.meta_en,'英文辅助信息',240),
    summary_zh:validate.text(item.summary_zh,'子内容中文摘要',{max:3000}),summary_en:validate.text(item.summary_en,'子内容英文摘要',{max:5000}),
    body_zh:validate.optionalText(item.body_zh,'子内容中文正文',20000),body_en:validate.optionalText(item.body_en,'子内容英文正文',30000),
    sort_order:Number(item.sort_order??index+1),published:validate.boolean(item.published,'子内容发布状态'),
  };
  if(value.id!==null&&(!Number.isSafeInteger(value.id)||value.id<1))fail('子内容编号无效');
  if(!Number.isSafeInteger(value.sort_order)||value.sort_order<1)fail('子内容顺序必须是正整数');
  return value;
}
function normalize(section){
  const value={
    section_key:validate.oneOf(section.section_key,KEYS,'内容版块'),
    eyebrow_zh:validate.text(section.eyebrow_zh,'中文眉题',{max:80}),
    eyebrow_en:validate.text(section.eyebrow_en,'英文眉题',{max:120}),
    title_zh:validate.text(section.title_zh,'中文标题',{max:80}),
    title_en:validate.text(section.title_en,'英文标题',{max:120}),
    intro_zh:validate.text(section.intro_zh,'中文简介',{max:1000}),
    intro_en:validate.text(section.intro_en,'英文简介',{max:1500}),
    body_zh:validate.optionalText(section.body_zh,'中文正文',10000),
    body_en:validate.optionalText(section.body_en,'英文正文',15000),
    layout:validate.oneOf(section.layout,LAYOUTS,'版式'),
    items_layout:validate.oneOf(section.items_layout,ITEM_LAYOUTS,'卡片排列'),
    sort_order:Number(section.sort_order),
    published:validate.boolean(section.published,'发布状态'),
    revision:Number(section.revision),
  };
  if(!Number.isSafeInteger(value.sort_order)||value.sort_order<1||value.sort_order>KEYS.length)fail(`展示顺序必须是1至${KEYS.length}的整数`);
  if(!Number.isSafeInteger(value.revision)||value.revision<0)fail('内容版本无效');
  if(!Array.isArray(section.items)||section.items.length>12)fail('每个版块最多可设置12条子内容');
  value.items=section.items.map((item,index)=>normalizeItem(item,value.section_key,index));
  if(new Set(value.items.map(item=>item.sort_order)).size!==value.items.length)fail('同一版块的子内容顺序不能重复');
  return value;
}
const save=db.transaction(input=>{
  if(!Array.isArray(input.sections)||input.sections.length!==KEYS.length)fail('请完整提交五个首页装修版块');
  const sections=input.sections.map(normalize);
  if(new Set(sections.map(section=>section.section_key)).size!==KEYS.length||new Set(sections.map(section=>section.sort_order)).size!==KEYS.length)fail('版块或展示顺序重复');
  const existingItems=new Map(db.prepare('SELECT id,section_key FROM editorial_items').all().map(item=>[item.id,item.section_key]));
  const keptIds=new Set();
  const update=db.prepare(`UPDATE editorial_sections SET eyebrow_zh=?,eyebrow_en=?,title_zh=?,title_en=?,intro_zh=?,intro_en=?,body_zh=?,body_en=?,layout=?,items_layout=?,sort_order=?,published=?,revision=revision+1,updated_at=datetime('now','localtime') WHERE section_key=? AND revision=?`);
  const insertItem=db.prepare(`INSERT INTO editorial_items(section_key,symbol_zh,symbol_en,label_zh,label_en,title_zh,title_en,meta_zh,meta_en,summary_zh,summary_en,body_zh,body_en,sort_order,published) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const updateItem=db.prepare(`UPDATE editorial_items SET symbol_zh=?,symbol_en=?,label_zh=?,label_en=?,title_zh=?,title_en=?,meta_zh=?,meta_en=?,summary_zh=?,summary_en=?,body_zh=?,body_en=?,sort_order=?,published=?,updated_at=datetime('now','localtime') WHERE id=? AND section_key=?`);
  for(const section of sections){
    const changed=update.run(section.eyebrow_zh,section.eyebrow_en,section.title_zh,section.title_en,section.intro_zh,section.intro_en,section.body_zh,section.body_en,section.layout,section.items_layout,section.sort_order,section.published?1:0,section.section_key,section.revision);
    if(!changed.changes)fail('品牌内容已被其他管理员修改，请刷新后重试',409);
    for(const item of section.items){
      const values=[item.symbol_zh,item.symbol_en,item.label_zh,item.label_en,item.title_zh,item.title_en,item.meta_zh,item.meta_en,item.summary_zh,item.summary_en,item.body_zh,item.body_en,item.sort_order,item.published?1:0];
      if(item.id===null){const inserted=insertItem.run(section.section_key,...values);keptIds.add(Number(inserted.lastInsertRowid));continue;}
      if(existingItems.get(item.id)!==section.section_key)fail('子内容不存在或不属于当前版块',400);
      updateItem.run(...values,item.id,section.section_key);keptIds.add(item.id);
    }
  }
  const removeItem=db.prepare('DELETE FROM editorial_items WHERE id=?');
  for(const [id] of existingItems)if(!keptIds.has(id))removeItem.run(id);
  return get();
});
module.exports={KEYS,LAYOUTS,ITEM_LAYOUTS,get,publicContent,readinessStatus,save};
