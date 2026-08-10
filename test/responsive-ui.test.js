const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'public', 'styles.css'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(projectRoot, 'database.js'), 'utf8');

test('商品列表採用 50 筆分頁，避免一次建立全部 DOM', () => {
    assert.match(appSource, /const PRODUCTS_PER_PAGE = 50/);
    assert.match(appSource, /products\.slice\(pageStart, pageStart \+ PRODUCTS_PER_PAGE\)/);
    assert.match(html, /id="productPagination"/);
    assert.match(html, /id="previousPageBtn"/);
    assert.match(html, /id="nextPageBtn"/);
});

test('手機商品列表使用卡片網格且不依賴水平捲動', () => {
    assert.match(css, /@media \(max-width: 767\.98px\)/);
    assert.match(css, /grid-template-areas:\s*"image name"\s*"image price"\s*"image actions"/);
    assert.match(css, /\.table-responsive \{\s*overflow: visible;/);
    assert.match(css, /--touch-target: 44px/);
});

test('介面尊重減少動態效果偏好且沒有 transition all', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /transition:\s*all\b/);
});

test('重要控制項具有手機與無障礙所需語意', () => {
    assert.match(html, /name="username" autocomplete="username"/);
    assert.match(html, /name="password" autocomplete="current-password"/);
    assert.match(html, /aria-live="assertive"/);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /<th scope="col">/);
});

test('資料庫時間欄位使用 TIMESTAMPTZ 並保留舊資料升級路徑', () => {
    assert.match(databaseSource, /async function migrateTimestampColumns/);
    assert.match(databaseSource, /ALTER COLUMN \$\{column\} TYPE TIMESTAMPTZ/);
    assert.match(databaseSource, /last_success_at TIMESTAMPTZ/);
    assert.match(databaseSource, /dataChangedAt: stats\.data_changed_at/);
});
