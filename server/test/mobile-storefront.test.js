const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storefronts = ['../frontend/index.html', 'public/index.html'];

for (const relative of storefronts) {
  const read = () => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

  test(`${relative}: mobile viewport supports safe areas and resizing keyboards`, () => {
    const html = read();
    assert.match(html, /viewport-fit=cover, interactive-widget=resizes-content/);
    assert.match(html, /<meta name="theme-color" content="#faf8f2"/);
    assert.match(html, /env\(safe-area-inset-top\)/);
    assert.match(html, /env\(safe-area-inset-bottom\)/);
  });

  test(`${relative}: compact header remains operable at phone widths`, () => {
    const html = read();
    assert.match(html, /\.nav-icon-btn, \.mobile-menu-btn \{[\s\S]*?width: 44px; height: 44px; min-width: 44px/);
    assert.match(html, /\.nav-actions \.language-switch \{ display: none; \}/);
    assert.match(html, /aria-(?:label|expanded)[\s\S]*?mobile-navigation/);
    assert.match(html, /mobile-language-switch/);
    assert.match(html, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(html, /event\.key !== 'Escape'/);
  });

  test(`${relative}: phone navigation and overlays use the dynamic viewport`, () => {
    const html = read();
    assert.match(html, /height: calc\(100dvh - var\(--nav-height\) - env\(safe-area-inset-top\)\)/);
    assert.match(html, /\.modal-overlay \{ align-items: flex-end; padding: env\(safe-area-inset-top\) 0 0; \}/);
    assert.match(html, /max-height: calc\(100dvh - env\(safe-area-inset-top\)\)/);
    assert.match(html, /\.cart-drawer \{ width: 100%; max-width: none; height: 100dvh; bottom: auto; \}/);
    assert.match(html, /overscroll-behavior: contain/);
  });

  test(`${relative}: mobile catalog uses two columns with a narrow-screen fallback`, () => {
    const html = read();
    const tabletStart = html.indexOf('@media (max-width: 768px)');
    const phoneStart = html.indexOf('@media (max-width: 480px)', tabletStart);
    const narrowStart = html.indexOf('@media (max-width: 340px)', phoneStart);
    assert.ok(tabletStart >= 0 && phoneStart > tabletStart && narrowStart > phoneStart);
    assert.match(html.slice(tabletStart, phoneStart), /\.product-grid \{ grid-template-columns: 1fr 1fr; gap: 12px; \}/);
    assert.match(html.slice(tabletStart, phoneStart), /\.cat-grid\.editorial-items-four \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    assert.doesNotMatch(html.slice(phoneStart, narrowStart), /\.product-grid \{ grid-template-columns: 1fr; \}/);
    assert.match(html.slice(narrowStart), /\.product-grid \{ grid-template-columns: 1fr; \}/);
  });

  test(`${relative}: mobile controls avoid iOS zoom and expose touch-sized actions`, () => {
    const html = read();
    assert.match(html, /\.form-input, \.form-textarea, \.form-select \{ min-height: 44px; font-size: 16px; \}/);
    assert.match(html, /\.catalog-category-button \{ min-height: 44px; \}/);
    assert.match(html, /\.catalog-subcategory-button \{ min-height: 40px; \}/);
    assert.match(html, /\.qty-btn \{ width: 44px; height: 44px; \}/);
    assert.match(html, /\.culture-read, \.spec-option \{ min-height: 44px/);
  });
}
