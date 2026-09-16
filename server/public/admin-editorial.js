const editorialPage=document.getElementById('page-editorial');
const editorialLabels={hero:'首页主视觉',treasures:'文房四宝',artisans:'匠人访谈',culture:'文房文化',brand_story:'品牌故事'};
const editorialAllItemFields=['symbol_zh','symbol_en','label_zh','label_en','title_zh','title_en','meta_zh','meta_en','summary_zh','summary_en','body_zh','body_en'];
const editorialItemFields={
  hero:[],
  treasures:[
    ['symbol_zh','中文视觉字'],['symbol_en','English symbol'],['label_zh','中文商品分类代码'],['label_en','English category key'],
    ['title_zh','中文名称'],['title_en','English name'],['summary_zh','中文说明','textarea',3,3000],['summary_en','English description','textarea',3,5000],
  ],
  artisans:[
    ['symbol_zh','中文视觉字'],['symbol_en','English symbol'],['label_zh','中文身份'],['label_en','English role'],
    ['title_zh','中文姓名'],['title_en','English name'],['meta_zh','中文从业信息'],['meta_en','English experience'],
    ['summary_zh','中文卡片摘要','textarea',3,3000],['summary_en','English card summary','textarea',3,5000],
    ['body_zh','中文访谈正文（可添加多段）','textarea',7,20000],['body_en','English interview body','textarea',7,30000],
  ],
  culture:[
    ['label_zh','中文栏目'],['label_en','English category'],['title_zh','中文文章标题'],['title_en','English article title'],
    ['meta_zh','中文阅读信息'],['meta_en','English reading info'],['summary_zh','中文文章摘要','textarea',3,3000],['summary_en','English article summary','textarea',3,5000],
    ['body_zh','中文文章正文（可添加多段）','textarea',8,20000],['body_en','English article body','textarea',8,30000],
  ],
  brand_story:[
    ['symbol_zh','中文序号'],['symbol_en','English number'],['title_zh','中文小标题'],['title_en','English heading'],
    ['summary_zh','中文故事文案','textarea',4,3000],['summary_en','English story copy','textarea',4,5000],
    ['body_zh','中文补充正文（可添加多段）','textarea',6,20000],['body_en','English additional body','textarea',6,30000],
  ],
};
let editorialSections=[];

function editorialInput(section,field,label,{textarea=false,max=1000,rows=3}={}){
  const id=`editorial-${section.section_key}-${field}`;
  return `<label class="block text-sm">${label}${textarea?`<textarea id="${id}" class="w-full border rounded p-2 mt-1" rows="${rows}" maxlength="${max}"></textarea>`:`<input id="${id}" class="w-full border rounded p-2 mt-1" maxlength="${max}">`}</label>`;
}
function editorialItemInput(sectionKey,index,field,label,type,rows=3,max=240){
  const id=`editorial-${sectionKey}-item-${index}-${field}`;
  const required=['title_zh','title_en','summary_zh','summary_en'].includes(field)?' required':'';
  return `<label class="block text-sm">${label}${type==='textarea'?`<textarea id="${id}" class="w-full border rounded p-2 mt-1" rows="${rows}" maxlength="${max}"${required}></textarea>`:`<input id="${id}" class="w-full border rounded p-2 mt-1" maxlength="${max}"${required}>`}</label>`;
}
function renderEditorialItems(section){
  if(section.section_key==='hero')return '<p class="text-sm text-gray-500">主视觉直接使用上方标题、简介和补充正文，不需要卡片。</p>';
  const fields=editorialItemFields[section.section_key];
  return `<div class="space-y-4" id="editorial-${section.section_key}-items">${section.items.map((item,index)=>`
    <details class="border rounded-lg bg-gray-50" open>
      <summary class="cursor-pointer px-4 py-3 font-medium flex items-center justify-between"><span>内容 ${index+1} · ${escapeRecord(item.title_zh||'未命名')}</span><span class="text-xs text-gray-500">点击收起/展开</span></summary>
      <div class="p-4 border-t space-y-4">
        <div class="flex flex-wrap justify-between gap-4 items-center"><label class="flex items-center gap-2 text-sm"><input id="editorial-${section.section_key}-item-${index}-published" type="checkbox">发布此条</label><button type="button" class="border border-red-300 text-red-700 rounded px-3 py-1 text-sm" onclick="removeEditorialItem('${section.section_key}',${index})">删除此条</button></div>
        <div class="grid md:grid-cols-2 gap-4">${fields.map(field=>editorialItemInput(section.section_key,index,...field)).join('')}</div>
        <label class="block text-sm">排列顺序<input id="editorial-${section.section_key}-item-${index}-sort_order" type="number" min="1" max="12" step="1" class="w-full border rounded p-2 mt-1"></label>
      </div>
    </details>`).join('')}</div>
    <button type="button" class="border border-purple-300 text-purple-700 rounded px-4 py-2 mt-4" onclick="addEditorialItem('${section.section_key}')">＋ 添加${editorialLabels[section.section_key]}内容</button>`;
}
function fillEditorialValues(){
  for(const section of editorialSections){
    for(const field of ['eyebrow_zh','eyebrow_en','title_zh','title_en','intro_zh','intro_en','body_zh','body_en','layout','items_layout','sort_order'])document.getElementById(`editorial-${section.section_key}-${field}`).value=section[field]??'';
    document.getElementById(`editorial-${section.section_key}-published`).checked=!!section.published;
    section.items.forEach((item,index)=>{
      for(const field of editorialAllItemFields){const input=document.getElementById(`editorial-${section.section_key}-item-${index}-${field}`);if(input)input.value=item[field]??'';}
      document.getElementById(`editorial-${section.section_key}-item-${index}-sort_order`).value=item.sort_order??index+1;
      document.getElementById(`editorial-${section.section_key}-item-${index}-published`).checked=!!item.published;
    });
  }
}
function renderEditorialEditor(){
  editorialPage.innerHTML=`
    <div class="mb-6"><h2 class="text-xl font-bold text-gray-800">首页装修</h2><p class="text-sm text-gray-500 mt-1">管理首页全部五个模块及其中每一张卡片的中英文文案、正文、顺序和排版。</p></div>
    <form id="editorialForm" class="space-y-5">
      <div id="editorialCards" class="space-y-5"></div>
      <section class="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <label class="block text-sm">管理员密码<input id="editorialPassword" type="password" required autocomplete="current-password" class="w-full border rounded p-2 mt-1"></label>
        <p id="editorialMessage" class="text-sm text-purple-700"></p>
        <button class="bg-purple-700 text-white rounded px-4 py-2">保存首页装修</button>
      </section>
    </form>`;
  document.getElementById('editorialCards').innerHTML=editorialSections.map(section=>`
    <section class="bg-white rounded-lg shadow-sm p-6 space-y-5" data-editorial-key="${section.section_key}">
      <div class="flex flex-wrap justify-between gap-4 items-center"><div><h3 class="font-bold text-gray-800">${editorialLabels[section.section_key]}</h3><p class="text-sm text-gray-500 mt-1">先设置版块标题，再维护下方可增删的具体内容。</p></div><label class="flex items-center gap-2 text-sm"><input id="editorial-${section.section_key}-published" type="checkbox">发布整个版块</label></div>
      <div class="grid md:grid-cols-2 gap-4">${editorialInput(section,'eyebrow_zh','中文眉题',{max:80})}${editorialInput(section,'eyebrow_en','English eyebrow',{max:120})}${editorialInput(section,'title_zh','中文标题',{max:80})}${editorialInput(section,'title_en','English title',{max:120})}${editorialInput(section,'intro_zh','中文简介',{textarea:true,max:1000})}${editorialInput(section,'intro_en','English introduction',{textarea:true,max:1500})}${editorialInput(section,'body_zh','中文补充正文（可添加多段）',{textarea:true,max:10000,rows:5})}${editorialInput(section,'body_en','English body (multiple paragraphs allowed)',{textarea:true,max:15000,rows:5})}</div>
      <div class="grid md:grid-cols-3 gap-4"><label class="block text-sm">标题版式<select id="editorial-${section.section_key}-layout" class="w-full border rounded p-2 mt-1"><option value="centered">居中展示</option><option value="left">左对齐阅读</option><option value="split">标题与简介分栏</option></select></label><label class="block text-sm">卡片排列<select id="editorial-${section.section_key}-items_layout" class="w-full border rounded p-2 mt-1"><option value="four">每行四项</option><option value="three">每行三项</option><option value="two">每行两项</option><option value="list">单列阅读</option></select></label><label class="block text-sm">首页模块顺序<input id="editorial-${section.section_key}-sort_order" type="number" min="1" max="5" step="1" class="w-full border rounded p-2 mt-1"></label></div>
      <div class="border-t pt-5"><h4 class="font-semibold text-gray-800 mb-1">具体内容</h4><p class="text-xs text-gray-500 mb-4">卡片可新增、修改、删除和排序；正文换行会按安全段落排版，不接受脚本或任意 HTML。</p>${renderEditorialItems(section)}</div>
    </section>`).join('');
  fillEditorialValues();
  document.getElementById('editorialForm').onsubmit=saveEditorialContent;
}
function syncEditorialDraft(){
  editorialSections=editorialSections.map(section=>{
    const value={...section};
    for(const field of ['eyebrow_zh','eyebrow_en','title_zh','title_en','intro_zh','intro_en','body_zh','body_en','layout','items_layout'])value[field]=document.getElementById(`editorial-${section.section_key}-${field}`).value;
    value.sort_order=Number(document.getElementById(`editorial-${section.section_key}-sort_order`).value);
    value.published=document.getElementById(`editorial-${section.section_key}-published`).checked;
    value.items=section.items.map((item,index)=>{
      const next={...item};
      for(const field of editorialAllItemFields){const input=document.getElementById(`editorial-${section.section_key}-item-${index}-${field}`);next[field]=input?input.value:'';}
      next.sort_order=Number(document.getElementById(`editorial-${section.section_key}-item-${index}-sort_order`).value);
      next.published=document.getElementById(`editorial-${section.section_key}-item-${index}-published`).checked;
      return next;
    });
    return value;
  });
}
function addEditorialItem(sectionKey){
  syncEditorialDraft();
  const section=editorialSections.find(value=>value.section_key===sectionKey);
  if(section.items.length>=12){alert('每个版块最多添加12条内容');return;}
  section.items.push(Object.fromEntries([...editorialAllItemFields.map(field=>[field,'']),['id',null],['sort_order',section.items.length+1],['published',true]]));
  renderEditorialEditor();
}
function removeEditorialItem(sectionKey,index){
  if(!confirm('确定删除这条品牌内容吗？保存后生效。'))return;
  syncEditorialDraft();
  const section=editorialSections.find(value=>value.section_key===sectionKey);
  section.items.splice(index,1);section.items.forEach((item,itemIndex)=>item.sort_order=itemIndex+1);
  renderEditorialEditor();
}
async function loadEditorialContent(){
  const result=await request('/editorial-content');
  if(result.code!==200){editorialPage.innerHTML=`<div class="bg-white rounded p-6 text-red-600">${escapeRecord(result.message)}</div>`;return;}
  editorialSections=result.data.sections;renderEditorialEditor();
}
async function saveEditorialContent(event){
  event.preventDefault();syncEditorialDraft();
  const password=document.getElementById('editorialPassword').value;
  const result=await request('/editorial-content',{method:'PUT',body:JSON.stringify({sections:editorialSections,admin_password:password})});
  const message=document.getElementById('editorialMessage');message.textContent=result.message||'';
  if(result.code===200){editorialSections=result.data.sections;renderEditorialEditor();document.getElementById('editorialMessage').textContent=result.message;}
}
