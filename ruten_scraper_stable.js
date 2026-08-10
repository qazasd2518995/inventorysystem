// 友茂（露天市集）商品同步器
// 使用賣場頁本身正在使用的 JSON API，不啟動 Chromium，也不下載商品圖片。
const axios = require('axios');
const { compareAndUpdateProducts, getProductStats } = require('./database');

const RUTEN_SELLER_ID = process.env.RUTEN_SELLER_ID || '1994160';
const LIST_PAGE_SIZE = 50; // API 超過 50 會回傳 400
const DETAIL_BATCH_SIZE = 100;

const http = axios.create({
    timeout: Number.parseInt(process.env.RUTEN_API_TIMEOUT_MS, 10) || 20000,
    headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'inventorysystem/2.0 (+marketplace inventory synchronization)'
    }
});

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestWithRetry(url, params, attempts = 3) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await http.get(url, { params });
        } catch (error) {
            lastError = error;
            const status = error.response && error.response.status;
            const retryable = !status || status === 429 || status >= 500;

            if (!retryable || attempt === attempts) break;
            await sleep(500 * attempt);
        }
    }

    const status = lastError && lastError.response && lastError.response.status;
    throw new Error(`露天 API 請求失敗${status ? ` (HTTP ${status})` : ''}: ${lastError.message}`);
}

async function fetchProductIds() {
    const endpoint = `https://rtapi.ruten.com.tw/api/search/v3/index.php/core/seller/${RUTEN_SELLER_ID}/prod`;
    const commonParams = { sort: 'rnk/dc', limit: LIST_PAGE_SIZE };
    const firstResponse = await requestWithRetry(endpoint, { ...commonParams, offset: 1 });
    const firstData = firstResponse.data || {};
    const total = Number(firstData.TotalRows);

    if (!Number.isInteger(total) || total <= 0 || !Array.isArray(firstData.Rows)) {
        throw new Error('露天商品清單 API 未回傳有效總數');
    }

    const ids = firstData.Rows.map(row => String(row.Id));
    const totalPages = Math.ceil(total / LIST_PAGE_SIZE);
    const requestDelay = Number.parseInt(process.env.RUTEN_REQUEST_DELAY_MS, 10) || 100;

    for (let page = 2; page <= totalPages; page++) {
        if (requestDelay > 0) await sleep(requestDelay);
        const offset = ((page - 1) * LIST_PAGE_SIZE) + 1;
        const response = await requestWithRetry(endpoint, { ...commonParams, offset });
        const rows = response.data && response.data.Rows;

        if (!Array.isArray(rows)) {
            throw new Error(`露天商品清單第 ${page} 頁格式異常`);
        }

        ids.push(...rows.map(row => String(row.Id)));
        console.log(`📄 露天清單進度: ${Math.min(ids.length, total)}/${total}`);
    }

    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== total) {
        throw new Error(`露天商品 ID 不完整 (${uniqueIds.length}/${total})，保留原資料`);
    }

    return uniqueIds;
}

async function fetchProductDetails(productIds) {
    const endpoint = 'https://rapi.ruten.com.tw/api/items/v2/list';
    const details = [];
    const requestDelay = Number.parseInt(process.env.RUTEN_REQUEST_DELAY_MS, 10) || 100;

    for (let index = 0; index < productIds.length; index += DETAIL_BATCH_SIZE) {
        if (index > 0 && requestDelay > 0) await sleep(requestDelay);
        const batch = productIds.slice(index, index + DETAIL_BATCH_SIZE);
        const response = await requestWithRetry(endpoint, {
            gno: batch.join(','),
            level: 'simple'
        });

        if (!response.data || response.data.status !== 'success' || !Array.isArray(response.data.data)) {
            throw new Error(`露天商品詳情批次 ${Math.floor(index / DETAIL_BATCH_SIZE) + 1} 格式異常`);
        }

        details.push(...response.data.data);
        console.log(`📦 露天詳情進度: ${Math.min(index + batch.length, productIds.length)}/${productIds.length}`);
    }

    const detailsById = new Map(details.map(item => [String(item.id), item]));
    const missingIds = productIds.filter(id => !detailsById.has(id));
    if (missingIds.length > 0) {
        throw new Error(`露天商品詳情缺少 ${missingIds.length} 筆，保留原資料`);
    }

    return productIds.map(id => detailsById.get(id));
}

function normalizeProduct(item) {
    const priceRange = item.goods_price_range || {};
    const price = Number(item.selling_g_now_price ?? item.goods_price ?? priceRange.min ?? 0);
    const imageUrl = (item.images && (
        (Array.isArray(item.images.m_url) && item.images.m_url[0])
        || (Array.isArray(item.images.url) && item.images.url[0])
    )) || '';

    return {
        id: String(item.id),
        name: item.name || `商品 ${item.id}`,
        price: Number.isFinite(price) ? Math.round(price) : 0,
        imageUrl,
        url: `https://www.ruten.com.tw/item/show?${item.id}`,
        store_type: 'youmao',
        sourceUpdatedAt: item.update_time || null,
        scrapedAt: new Date().toISOString()
    };
}

async function fetchRutenCatalog() {
    console.log('🚀 使用露天批次 API 取得友茂商品（不啟動瀏覽器、不下載圖片）...');
    const productIds = await fetchProductIds();
    const details = await fetchProductDetails(productIds);
    const products = details.map(normalizeProduct);

    if (products.length !== productIds.length) {
        throw new Error(`露天商品轉換不完整 (${products.length}/${productIds.length})`);
    }

    return products;
}

async function fetchRutenProducts() {
    let products = [];

    try {
        products = await fetchRutenCatalog();
        const currentStats = await getProductStats('youmao');
        const minimumExpected = currentStats.total > 0 ? Math.floor(currentStats.total * 0.8) : 1;

        if (products.length < minimumExpected) {
            throw new Error(`露天結果疑似不完整 (${products.length}/${currentStats.total})，保留原資料`);
        }

        const updateResult = await compareAndUpdateProducts(products, 'youmao');
        const totalWithImages = products.filter(product => product.imageUrl).length;
        const totalWithPrice = products.filter(product => product.price > 0).length;

        console.log('📊 露天同步統計：');
        console.log(`   商品：${products.length}`);
        console.log(`   圖片網址：${totalWithImages}/${products.length}`);
        console.log(`   有效價格：${totalWithPrice}/${products.length}`);
        console.log(`   新增：${updateResult.newCount}，修改：${updateResult.modifiedCount}，價格變動：${updateResult.priceChangedCount}，下架：${updateResult.removedCount}`);

        return {
            success: true,
            totalProducts: products.length,
            update: updateResult
        };
    } catch (error) {
        console.error('❌ 友茂商品同步失敗:', error.message);
        return {
            success: false,
            error: error.message,
            totalProducts: products.length
        };
    }
}

module.exports = {
    fetchRutenProducts,
    fetchRutenCatalog,
    fetchProductIds,
    fetchProductDetails,
    normalizeProduct
};
