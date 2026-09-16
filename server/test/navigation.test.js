const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const relative of ['../frontend/index.html', 'public/index.html']) {
  test(`${relative}: storefront defaults to English and provides a persistent Chinese-English switch`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /const LANGUAGE_KEY = 'zyh_language'/);
    assert.match(html, /function LanguageProvider/);
    assert.match(html, /className(?::\s*|=)"language-switch"/);
    assert.match(html, /language === 'en' \? '中文' : 'EN'/);
    assert.match(html, /root\.render\((?:<LanguageProvider>|React\.createElement\(LanguageProvider)/);
  });

  test(`${relative}: desktop navigation has a compact intermediate layout and collapses before overlap`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /\.header nav \{ flex: 1 1 auto; min-width: 0; \}/);
    assert.match(html, /gap: clamp\(18px, 2vw, 32px\)/);
    assert.match(html, /@media \(max-width: 1180px\)/);
    assert.match(html, /@media \(max-width: 1080px\)[\s\S]*\.header nav,[\s\S]*display: none/);
  });

  test(`${relative}: hero copy is rendered from the bilingual homepage API`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /function Hero\(\{section\}\) \{\s*const \{language\}=useLanguage\(\)/);
    assert.match(html, /title:editorialText\(section,'eyebrow',language\)/);
    assert.match(html, /description:editorialText\(section,'body',language\)/);
    assert.match(html, /hero editorial-layout-/);
    assert.match(html, /(?:<p className="hero-desc">\{copy\.description\}<\/p>|React\.createElement\('p', \{ className: "hero-desc",\}, copy\.description\))/);
  });

  test(`${relative}: product catalog hides shipping and checkout quotes it from the address`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.doesNotMatch(html, /function StoreOffers\(/);
    assert.match(html, /shipping_address:\{country:address\.country,province:address\.province,city:address\.city,district:address\.district\|\|''\}/);
    assert.match(html, /quote\.shipping_rule_name/);
    assert.match(html, /请先填写国家\/地区、省\/州、城市和详细地址/);
  });

  test(`${relative}: fragmented navigation and pagination text is localized explicitly`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /language === 'en' \? `Cart \(\$\{cartCount\}\)`/);
    assert.match(html, /language === 'en' \? `Page \$\{page\} of \$\{Math\.max/);
    assert.match(html, /language === 'en' \? 'Previous' : '上一页'/);
    assert.match(html, /'以笔会友，以墨会友': 'Friendship Through Brush and Ink'/);
  });

  test(`${relative}: storefront rejects HTML API fallbacks with a clear version mismatch message`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /contentType\.includes\('application\/json'\)/);
    assert.match(html, /服务响应格式异常，请确认后端服务与页面版本一致/);
    assert.match(html, /服务响应数据格式错误，请稍后重试/);
  });

  test(`${relative}: English catalog copy and English product search are available`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /'紫云湖狼毫大楷毛笔': 'Ziyun Lake Weasel-Hair Large Regular-Script Brush'/);
    assert.match(html, /kw && language === 'en'/);
    assert.match(html, /translateUiText\(value, 'en'\)/);
  });

  test(`${relative}: the homepage previews eight products and the full catalog uses backend categories`,()=>{
    const html=fs.readFileSync(path.resolve(__dirname,'..',relative),'utf8');
    assert.match(html,/\{ label: '全部商品', href: '\/products' \}/);
    assert.match(html,/const isProductsPage=window\.location\.pathname\.replace/);
    assert.match(html,/productsPage\?'Shop All Products \| Ziyun Lake'/);
    assert.match(html,/window\.location\.assign\('\/products\?category='/);
    assert.match(html,/(?:\? <Products standalone|\? React\.createElement\(Products, \{ standalone: true)/);
    assert.match(html,/API\.get\('\/products\/categories'\)/);
    assert.match(html,/categories\.map\(category=>/);
    assert.match(html,/className(?::\s*|=)"product-catalog-layout"/);
    assert.match(html,/\(category\.children\|\|\[\]\)\.length/);
    assert.match(html,/subcategory=' \+ encodeURIComponent\(activeSubcategory\)/);
    assert.match(html,/homeLimit \|\| \(kw \? 100 : 24\)/);
    assert.match(html,/(?:homeLimit=\{8\}|homeLimit: 8)/);
    assert.match(html,/(?:href="\/products"|href: "\/products")/);
    assert.match(html,/View All Products/);
    assert.match(html,/activeCat === 'brush' \? 'pen' : activeCat/);
    assert.match(html,/editorialContent\.sections\.map\(renderEditorialSection\)/);
  });

  test(`${relative}: homepage content refreshes after admin changes and navigation reports its real state`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /\['#artisans', '#culture', '#story'\]\.includes\(target\.hash\)/);
    assert.match(html, /const refreshPublicContent=useCallback/);
    assert.match(html, /window\.addEventListener\('focus',refreshPublicContent\)/);
    assert.match(html, /document\.addEventListener\('visibilitychange',refreshVisible\)/);
    assert.match(html, /该首页版块尚未发布，请在后台“首页装修”中勾选“发布整个版块”并保存/);
    assert.match(html, /首页内容加载失败，请刷新页面或检查后端是否已更新并重启/);
  });

  test(`${relative}: every published homepage module and nested card uses backend bilingual copy`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /function editorialText\(section, field, language/);
    assert.match(html, /API\.get\('\/editorial-content'\)/);
    assert.match(html, /editorialContent\.sections\.map\(renderEditorialSection\)/);
    assert.match(html, /function editorialItemText\(item,field,language\)/);
    assert.match(html, /editorialParagraphs\(value\)/);
    assert.match(html, /editorial-layout-\$\{section\.layout\}/);
    assert.match(html, /editorial-items-\$\{section\.items_layout\}/);
    assert.match(html, /hero:(?:<Hero|React\.createElement\(Hero)/);
    assert.match(html, /treasures:(?:<CategoriesPreview|React\.createElement\(CategoriesPreview)/);
  });

  test(`${relative}: public store details do not depend on profile publication`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /storeProfile\.store_description\s*\|\|/);
    assert.doesNotMatch(html, /if\s*\(!storeProfile\.published\)\s*return/);
    assert.doesNotMatch(html, /storeProfile\.published\s*\?/);
    assert.match(html, /商家暂未填写客服电话/);
    assert.match(html, /'以笔会友，以文会友': 'Friendship Through Brush and Culture'/);
    assert.match(html, /'客户信息隐私': 'Customer Information Privacy'/);
    assert.match(html, /'正常物流运费，加急另算': 'Standard carrier rates apply; expedited shipping is charged separately'/);
  });

  test(`${relative}: public products and store content refresh without reloading`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /const refreshProducts=\(\)=>loadProducts\(true\)/);
    assert.match(html, /setInterval\(refreshProducts,30000\)/);
    assert.match(html, /setInterval\(refreshPublicContent,30000\)/);
    assert.match(html, /window\.addEventListener\('focus',\s*refreshProducts\)/);
  });

  test(`${relative}: footer shopping and customer-service dialogs have complete English copy`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    for (const englishCopy of [
      'Ziyun Lake offers a complete shopping experience for the Four Treasures.',
      'After placing an order, choose an enabled payment method',
      'Shipping coverage, delivery times, fees, and carriers are pending merchant review.',
      'The after-sales policy is pending merchant review.',
      'The merchant has not published an invoice policy.',
      'Business and customer-service details are pending review.',
      'Frequently Asked Questions',
      'How is payment confirmed?',
      'How should I care for a brush?',
      'How should I store Xuan paper?',
      'How do I prepare a new inkstone?',
      'How do I grind an ink stick?',
    ]) assert.ok(html.includes(englishCopy), `missing English footer help copy: ${englishCopy}`);
  });

  test(`${relative}: every culture article opens readable full content`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert.match(html, /function CultureArticleModal/);
    assert.match(html, /onOpenArticle(?:=\{|:\s*)setCultureArticle/);
    assert.match(html, /className(?::|=)[^\n]*culture-read[^\n]*onClick/);
    assert.match(html, /article\.body\.map/);
    assert.match(html, /如何选择一支适合自己的毛笔/);
    assert.match(html, /生宣、熟宣、半生熟的区别与选用/);
    assert.match(html, /砚台保养指南/);
  });
}
