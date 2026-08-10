const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStoreResult } = require('../product_count_checker');
const { parseOptions } = require('../jobs/sync');
const { normalizeProduct } = require('../ruten_scraper_stable');

test('數量一致時不執行完整爬蟲', () => {
    const result = buildStoreResult(100, { success: true, count: 100, method: 'http' });
    assert.equal(result.needsUpdate, false);
    assert.equal(result.indeterminate, false);
});

test('數量不同時才要求完整更新', () => {
    const result = buildStoreResult(100, { success: true, count: 101, method: 'http' });
    assert.equal(result.needsUpdate, true);
});

test('平台檢查失敗時停止，不放大成完整爬蟲', () => {
    const result = buildStoreResult(100, { success: false, error: 'timeout', method: 'http' });
    assert.equal(result.needsUpdate, false);
    assert.equal(result.indeterminate, true);
});

test('排程每週指定日期才做完整校對', () => {
    const sunday = new Date('2026-08-09T18:00:00Z');
    const monday = new Date('2026-08-10T18:00:00Z');
    assert.equal(parseOptions(['--scheduled'], sunday).force, true);
    assert.equal(parseOptions(['--scheduled'], monday).force, false);
});

test('拒絕未知賣場', () => {
    assert.throws(() => parseOptions(['--store=unknown']), /不支援的賣場/);
});

test('露天 API 商品會正確轉成價格與圖片欄位', () => {
    const product = normalizeProduct({
        id: '1234567890',
        name: '測試商品',
        goods_price: 1200,
        selling_g_now_price: 999,
        update_time: '2026-08-10',
        images: {
            m_url: ['https://example.com/image_m.jpg'],
            url: ['https://example.com/image.jpg']
        }
    });

    assert.equal(product.id, '1234567890');
    assert.equal(product.price, 999);
    assert.equal(product.imageUrl, 'https://example.com/image_m.jpg');
    assert.equal(product.sourceUpdatedAt, '2026-08-10');
    assert.equal(product.store_type, 'youmao');
});
