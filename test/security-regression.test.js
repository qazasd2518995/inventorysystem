const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { safeHyperlink } = require('../excel_export');

const projectRoot = path.resolve(__dirname, '..');

test('舊版高流量 Yahoo API 與抓取器不再存在於 Web Server', () => {
    const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
    const removedPaths = [
        '/api/check-updates',
        '/api/partial-update',
        '/api/force-update',
        '/api/refresh-yuanzhengshan',
        '/api/refresh-youmao'
    ];

    for (const removedPath of removedPaths) {
        assert.equal(serverSource.includes(removedPath), false, `${removedPath} 不應再被註冊`);
    }
    assert.equal(serverSource.includes('fetchYahooAuctionProductsProgressive'), false);
    assert.equal(serverSource.includes('fetchYahooAuctionProductsFast'), false);
});

test('HTML 不使用 inline JavaScript 事件處理器', () => {
    const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /\son(?:click|submit|error)\s*=/i);
});

test('商品與日誌渲染不再將外部資料插入 HTML 字串', () => {
    const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
    assert.doesNotMatch(appSource, /\$\{\s*product\.(?:name|imageUrl|url)/);
    assert.doesNotMatch(appSource, /\$\{\s*log\.(?:message|details)/);
    assert.match(appSource, /textContent\s*=/);
    assert.match(appSource, /replaceChildren\(/);
});

test('Excel 超連結只接受 HTTP 與 HTTPS', () => {
    assert.equal(safeHyperlink('javascript:alert(1)'), null);
    assert.equal(safeHyperlink('data:text/html,hello'), null);
    assert.equal(safeHyperlink('not a url'), null);
    assert.equal(safeHyperlink('https://example.com/item/1'), 'https://example.com/item/1');
});
