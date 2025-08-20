// 測試新版友茂價格抓取功能
const { fetchRutenProducts } = require('./ruten_scraper_v2');
const { initializeDatabase, getActiveProducts } = require('./database');

async function testNewRutenScraper() {
    try {
        console.log('🧪 測試新版友茂價格抓取功能...');
        
        // 初始化資料庫
        await initializeDatabase();
        
        // 檢查測試前的商品數量
        const beforeProducts = await getActiveProducts('youmao');
        console.log(`📊 測試前 - 友茂商品: ${beforeProducts.length} 個`);
        
        // 設定測試環境變數（只測試少量商品）
        process.env.MAX_PAGES = '1';  // 只測試1頁
        process.env.SCRAPE_DELAY = '500';
        process.env.PAGE_LOAD_WAIT = '2000';
        
        console.log('🕷️ 開始執行新版友茂價格測試（1頁）...');
        const result = await fetchRutenProducts();
        
        if (result.success) {
            console.log(`✅ 爬蟲成功: ${result.totalProducts} 個商品`);
            console.log(`💰 價格統計:`);
            console.log(`   有價格: ${result.withPrice} 個`);
            console.log(`   無價格: ${result.withoutPrice} 個`);
            console.log(`   成功率: ${result.priceSuccessRate}`);
            
            // 檢查測試後的商品
            const afterProducts = await getActiveProducts('youmao');
            console.log(`📊 測試後 - 友茂商品: ${afterProducts.length} 個`);
            
            // 顯示有價格的樣本商品
            const productsWithPrice = afterProducts.filter(p => p.price && p.price > 0);
            if (productsWithPrice.length > 0) {
                console.log('\n✅ 有價格的商品樣本:');
                productsWithPrice.slice(0, 5).forEach((product, index) => {
                    console.log(`${index + 1}. ${product.name.slice(0, 60)}...`);
                    console.log(`   價格: NT$ ${product.price.toLocaleString()}`);
                    console.log(`   連結: ${product.url}`);
                    console.log('');
                });
            }
            
            // 顯示無價格的樣本商品
            const productsWithoutPrice = afterProducts.filter(p => !p.price || p.price === 0);
            if (productsWithoutPrice.length > 0) {
                console.log('\n❌ 無價格的商品樣本:');
                productsWithoutPrice.slice(0, 3).forEach((product, index) => {
                    console.log(`${index + 1}. ${product.name.slice(0, 60)}...`);
                    console.log(`   價格: ${product.price || '未抓取到'}`);
                    console.log(`   連結: ${product.url}`);
                    console.log('');
                });
            }
            
        } else {
            console.error(`❌ 爬蟲失敗: ${result.error}`);
        }
        
    } catch (error) {
        console.error('測試過程中發生錯誤:', error);
    } finally {
        console.log('🏁 新版友茂價格抓取測試完成');
        process.exit(0);
    }
}

// 執行測試
testNewRutenScraper();
