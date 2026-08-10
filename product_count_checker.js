// 輕量商品數量檢查器：只下載公開 HTML，不啟動 Chromium。
const axios = require('axios');
const cheerio = require('cheerio');
const { getProductStats } = require('./database');

const REQUEST_TIMEOUT_MS = parseInt(process.env.COUNT_CHECK_TIMEOUT_MS, 10) || 15000;
const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Encoding': 'gzip, deflate, br'
};

async function fetchPublicHtml(url) {
    const response = await axios.get(url, {
        headers: REQUEST_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
        maxRedirects: 5,
        maxContentLength: 2 * 1024 * 1024
    });
    return response.data;
}

// Yahoo 首頁 HTML 的 isoredux-data 已包含各分類數量，約 60KB。
async function checkYuanzhengshan() {
    try {
        console.log('🔍 使用輕量 HTTP 檢查源正山商品總數...');
        const html = await fetchPublicHtml('https://tw.bid.yahoo.com/booth/Y1823944291');
        const $ = cheerio.load(html);
        const rawState = $('#isoredux-data').text();

        if (!rawState) throw new Error('Yahoo 頁面缺少 isoredux-data');

        const state = JSON.parse(rawState);
        const categories = state?.booth?.categories;
        if (!Array.isArray(categories)) throw new Error('Yahoo 頁面缺少分類數量');

        const count = categories.reduce((total, category) => total + (Number(category.amount) || 0), 0);
        console.log(`✅ Yahoo 輕量數量檢查完成: ${count}`);
        return { success: true, count, store: 'yuanzhengshan', method: 'http' };
    } catch (error) {
        console.error('❌ 檢查源正山商品數量失敗:', error.message);
        return { success: false, error: error.message, store: 'yuanzhengshan', method: 'http' };
    }
}

// 露天首頁 HTML 的 RT.context.class_data 已包含各分類數量，約 40KB。
async function checkYoumao() {
    try {
        console.log('🔍 使用輕量 HTTP 檢查友茂商品總數...');
        const html = await fetchPublicHtml('https://www.ruten.com.tw/store/u-mo0955900924/');
        const $ = cheerio.load(html);
        let context = null;

        $('script').each((_, element) => {
            if (context) return;
            const script = $(element).html() || '';
            const match = script.match(/RT\.context\s*=\s*(\{[\s\S]*?\});/);
            if (match) context = JSON.parse(match[1]);
        });

        if (!context || !context.class_data || typeof context.class_data !== 'object') {
            throw new Error('露天頁面缺少 RT.context.class_data');
        }

        const count = Object.values(context.class_data)
            .reduce((total, category) => total + (Number(category.count) || 0), 0);
        console.log(`✅ 露天輕量數量檢查完成: ${count}`);
        return { success: true, count, store: 'youmao', method: 'http' };
    } catch (error) {
        console.error('❌ 檢查友茂商品數量失敗:', error.message);
        return { success: false, error: error.message, store: 'youmao', method: 'http' };
    }
}

function buildStoreResult(databaseCount, marketplaceResult) {
    const hasReliableCount = marketplaceResult.success && Number.isInteger(marketplaceResult.count);
    return {
        database: databaseCount || 0,
        marketplace: hasReliableCount ? marketplaceResult.count : null,
        needsUpdate: hasReliableCount ? (databaseCount || 0) !== marketplaceResult.count : false,
        indeterminate: !hasReliableCount,
        error: hasReliableCount ? null : marketplaceResult.error,
        method: marketplaceResult.method
    };
}

// 檢查失敗時只記錄並稍後重試，絕不再把錯誤放大成完整爬蟲。
async function checkIfScrapingNeeded(storeType = null) {
    try {
        console.log(`📊 開始輕量檢查${storeType ? ` (${storeType})` : ''}...`);
        const dbStats = await getProductStats();

        const shouldCheckYahoo = !storeType || storeType === 'yuanzhengshan';
        const shouldCheckRuten = !storeType || storeType === 'youmao';
        const [yahooResult, rutenResult] = await Promise.all([
            shouldCheckYahoo ? checkYuanzhengshan() : Promise.resolve({ success: false, error: '未檢查', method: 'skipped' }),
            shouldCheckRuten ? checkYoumao() : Promise.resolve({ success: false, error: '未檢查', method: 'skipped' })
        ]);

        const result = {
            timestamp: new Date().toISOString(),
            yuanzhengshan: shouldCheckYahoo
                ? buildStoreResult(dbStats.yuanzhengshan || 0, yahooResult)
                : { skipped: true, needsUpdate: false },
            youmao: shouldCheckRuten
                ? buildStoreResult(dbStats.youmao || 0, rutenResult)
                : { skipped: true, needsUpdate: false }
        };

        for (const [key, value] of Object.entries(result)) {
            if (key === 'timestamp' || value.skipped) continue;
            const marketplaceText = value.marketplace === null ? '未知' : value.marketplace;
            console.log(`   ${key}: 資料庫 ${value.database} vs 賣場 ${marketplaceText} - ${value.indeterminate ? '稍後重試' : value.needsUpdate ? '需要更新' : '無需更新'}`);
        }

        return result;
    } catch (error) {
        console.error('❌ 輕量檢查過程發生錯誤:', error.message);
        return {
            timestamp: new Date().toISOString(),
            error: error.message,
            yuanzhengshan: { needsUpdate: false, indeterminate: true, error: error.message },
            youmao: { needsUpdate: false, indeterminate: true, error: error.message }
        };
    }
}

module.exports = {
    fetchPublicHtml,
    checkYuanzhengshan,
    checkYoumao,
    checkIfScrapingNeeded,
    buildStoreResult
};
