// 測試友茂價格抓取功能
const { fetchRutenProducts } = require('./ruten_scraper');
const { initializeDatabase, getActiveProducts } = require('./database');

async function testRutenPriceCapture() {
    try {
        console.log('🧪 測試友茂價格抓取功能...');
        
        // 初始化資料庫
        await initializeDatabase();
        
        // 檢查測試前的商品數量
        const beforeProducts = await getActiveProducts('youmao');
        console.log(`📊 測試前 - 友茂商品: ${beforeProducts.length} 個`);
        
        // 執行友茂爬蟲（限制測試2頁）
        process.env.MAX_PAGES = '2';
        process.env.SCRAPE_DELAY = '1000';
        process.env.PAGE_LOAD_WAIT = '3000';
        
        console.log('🕷️ 開始執行友茂價格測試（2頁）...');
        const result = await fetchRutenProducts();
        
        if (result.success) {
            console.log(`✅ 爬蟲成功: ${result.totalProducts} 個商品`);
            
            // 檢查測試後的商品和價格
            const afterProducts = await getActiveProducts('youmao');
            console.log(`📊 測試後 - 友茂商品: ${afterProducts.length} 個`);
            
            // 分析價格抓取情況
            const productsWithPrice = afterProducts.filter(p => p.price && p.price > 0);
            const productsWithoutPrice = afterProducts.filter(p => !p.price || p.price === 0);
            const priceSuccessRate = afterProducts.length > 0 ? ((productsWithPrice.length / afterProducts.length) * 100).toFixed(1) : 0;
            
            console.log('\n💰 價格抓取分析:');
            console.log(`有價格商品: ${productsWithPrice.length} 個`);
            console.log(`無價格商品: ${productsWithoutPrice.length} 個`);
            console.log(`價格成功率: ${priceSuccessRate}%`);
            
            // 顯示有價格的樣本商品
            if (productsWithPrice.length > 0) {
                console.log('\n✅ 有價格的商品樣本:');
                productsWithPrice.slice(0, 10).forEach((product, index) => {
                    console.log(`${index + 1}. ${product.name.slice(0, 50)}...`);
                    console.log(`   價格: NT$ ${product.price.toLocaleString()}`);
                    console.log(`   ID: ${product.id}`);
                    console.log('');
                });
            }
            
            // 顯示無價格的樣本商品
            if (productsWithoutPrice.length > 0) {
                console.log('\n❌ 無價格的商品樣本:');
                productsWithoutPrice.slice(0, 5).forEach((product, index) => {
                    console.log(`${index + 1}. ${product.name.slice(0, 50)}...`);
                    console.log(`   價格: ${product.price || '未抓取到'}`);
                    console.log(`   ID: ${product.id}`);
                    console.log('');
                });
            }
            
            // 價格範圍統計
            if (productsWithPrice.length > 0) {
                const prices = productsWithPrice.map(p => p.price).sort((a, b) => a - b);
                const minPrice = prices[0];
                const maxPrice = prices[prices.length - 1];
                const avgPrice = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
                
                console.log('\n📊 價格統計:');
                console.log(`最低價: NT$ ${minPrice.toLocaleString()}`);
                console.log(`最高價: NT$ ${maxPrice.toLocaleString()}`);
                console.log(`平均價: NT$ ${avgPrice.toLocaleString()}`);
            }
            
        } else {
            console.error(`❌ 爬蟲失敗: ${result.error}`);
        }
        
    } catch (error) {
        console.error('測試過程中發生錯誤:', error);
    } finally {
        console.log('🏁 友茂價格抓取測試完成');
        process.exit(0);
    }
}

// 執行測試
testRutenPriceCapture();
