// 測試修復後的友茂爬蟲功能
const { fetchRutenProducts } = require('./ruten_scraper');
const { initializeDatabase, getActiveProducts, getProductStats } = require('./database');

async function testFixedYoumaoScraper() {
    try {
        console.log('🧪 測試修復後的友茂爬蟲功能...');
        
        // 初始化資料庫
        await initializeDatabase();
        
        // 檢查友茂商品數量（測試前）
        const beforeProducts = await getActiveProducts('youmao');
        const beforeStats = await getProductStats('youmao');
        console.log(`📊 測試前 - 友茂商品: ${beforeProducts.length} 個`);
        console.log(`📊 測試前 - 圖片統計: ${beforeStats.withImages}/${beforeStats.total} (${beforeStats.imageSuccessRate})`);
        
        // 執行友茂爬蟲（限制抓取頁數進行測試）
        process.env.MAX_PAGES = '5'; // 先測試5頁，約150個商品
        process.env.SCRAPE_DELAY = '800'; // 適中的延遲
        process.env.PAGE_LOAD_WAIT = '3000'; // 等待時間
        
        console.log('🕷️ 開始執行修復後的友茂爬蟲（測試5頁）...');
        const result = await fetchRutenProducts();
        
        if (result.success) {
            console.log(`✅ 爬蟲成功: ${result.totalProducts} 個商品，${result.totalPages} 頁`);
            
            // 檢查友茂商品數量（測試後）
            const afterProducts = await getActiveProducts('youmao');
            const afterStats = await getProductStats('youmao');
            console.log(`📊 測試後 - 友茂商品: ${afterProducts.length} 個`);
            console.log(`📊 測試後 - 圖片統計: ${afterStats.withImages}/${afterStats.total} (${afterStats.imageSuccessRate})`);
            
            // 分析價格抓取情況
            const productsWithPrice = afterProducts.filter(p => p.price && p.price > 0);
            const priceSuccessRate = afterProducts.length > 0 ? ((productsWithPrice.length / afterProducts.length) * 100).toFixed(1) : 0;
            console.log(`💰 價格統計: ${productsWithPrice.length}/${afterProducts.length} (${priceSuccessRate}%) 有價格`);
            
            // 顯示一些有價格的樣本商品
            console.log('\n📋 有價格的樣本商品:');
            const samplesWithPrice = productsWithPrice.slice(0, 5);
            samplesWithPrice.forEach((product, index) => {
                console.log(`${index + 1}. ${product.name.slice(0, 50)}...`);
                console.log(`   ID: ${product.id}`);
                console.log(`   價格: NT$ ${product.price.toLocaleString()}`);
                console.log(`   圖片: ${product.imageUrl ? '✅ 有' : '❌ 無'}`);
                console.log(`   連結: ${product.url}`);
                console.log('');
            });
            
            // 顯示價格範圍統計
            if (productsWithPrice.length > 0) {
                const prices = productsWithPrice.map(p => p.price).sort((a, b) => a - b);
                const minPrice = prices[0];
                const maxPrice = prices[prices.length - 1];
                const avgPrice = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
                
                console.log('💰 價格統計分析:');
                console.log(`   最低價: NT$ ${minPrice.toLocaleString()}`);
                console.log(`   最高價: NT$ ${maxPrice.toLocaleString()}`);
                console.log(`   平均價: NT$ ${avgPrice.toLocaleString()}`);
            }
            
        } else {
            console.error(`❌ 爬蟲失敗: ${result.error}`);
        }
        
    } catch (error) {
        console.error('測試過程中發生錯誤:', error);
    } finally {
        console.log('🏁 修復後的友茂爬蟲測試完成');
        process.exit(0);
    }
}

// 執行測試
testFixedYoumaoScraper();
