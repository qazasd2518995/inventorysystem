// 測試完整友茂爬蟲（所有頁面）
const { fetchRutenProducts } = require('./ruten_scraper_stable');
const { initializeDatabase, getActiveProducts } = require('./database');

async function testFullYoumaoScraper() {
    try {
        console.log('🧪 測試完整友茂爬蟲（所有頁面）...');
        
        // 初始化資料庫
        await initializeDatabase();
        
        // 設定環境變數以抓取所有頁面
        process.env.MAX_PAGES = '45'; // 45頁以確保抓取全部1306個商品
        process.env.SCRAPE_DELAY = '1000';
        process.env.PAGE_LOAD_WAIT = '3000';
        
        console.log('🕷️ 開始執行完整友茂爬蟲...');
        console.log('⚠️ 注意：這將需要約30-45分鐘完成所有1300+個商品');
        console.log('📊 預期結果：約1306個商品，45頁');
        
        const startTime = Date.now();
        const result = await fetchRutenProducts();
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000 / 60).toFixed(1); // 分鐘
        
        if (result.success) {
            console.log(`\n✅ 完整友茂爬蟲測試成功！耗時：${duration}分鐘`);
            console.log(`📊 最終統計：`);
            console.log(`   總商品數：${result.totalProducts}`);
            console.log(`   價格成功率：${result.priceSuccessRate} (${result.withPrice}/${result.totalProducts})`);
            console.log(`   名稱成功率：${result.nameSuccessRate} (${result.withName}/${result.totalProducts})`);
            
            // 檢查資料庫中的商品
            const dbProducts = await getActiveProducts('youmao');
            console.log(`💾 資料庫商品：${dbProducts.length} 個`);
            
            // 驗證是否達到預期商品數量
            const expectedProducts = 1306;
            const completionRate = ((result.totalProducts / expectedProducts) * 100).toFixed(1);
            console.log(`🎯 完成度：${completionRate}% (${result.totalProducts}/${expectedProducts})`);
            
            if (result.totalProducts >= 1300) {
                console.log('🎉 成功抓取超過1300個商品！');
            } else if (result.totalProducts >= 1000) {
                console.log('✅ 成功抓取超過1000個商品，表現良好');
            } else {
                console.log('⚠️ 商品數量少於預期，可能需要調整頁面數量');
            }
            
            // 顯示成功抓取的商品樣本
            const successfulProducts = dbProducts.filter(p => p.price > 0 && p.name && !p.name.startsWith('商品 '));
            if (successfulProducts.length > 0) {
                console.log('\n🎯 成功抓取的商品樣本（前5個）：');
                successfulProducts.slice(0, 5).forEach((product, index) => {
                    console.log(`${index + 1}. ${product.name.slice(0, 60)}...`);
                    console.log(`   價格: NT$ ${product.price.toLocaleString()}`);
                    console.log(`   ID: ${product.id}`);
                    console.log('');
                });
            }
            
            // 檢查特定商品（您提到的）
            const specificProduct = dbProducts.find(p => p.id === '21445645243606');
            if (specificProduct) {
                console.log('🎯 特定商品 21445645243606 檢查：');
                console.log(`   名稱: ${specificProduct.name}`);
                console.log(`   價格: ${specificProduct.price > 0 ? `NT$ ${specificProduct.price.toLocaleString()}` : '無價格'}`);
                console.log(`   ✅ 名稱正確: ${specificProduct.name.includes('U-MO') && specificProduct.name.includes('中耕機') ? '是' : '否'}`);
                console.log(`   ✅ 價格正確: ${specificProduct.price > 0 ? '是' : '否'}`);
            } else {
                console.log('❌ 未找到特定商品 21445645243606，可能已下架或在更後面的頁面');
            }
            
            // 統計分析
            const priceRate = parseFloat(result.priceSuccessRate);
            const nameRate = parseFloat(result.nameSuccessRate);
            
            console.log(`\n📈 品質分析：`);
            if (priceRate >= 90) {
                console.log(`   價格抓取：🏆 優秀 (${priceRate}%)`);
            } else if (priceRate >= 70) {
                console.log(`   價格抓取：✅ 良好 (${priceRate}%)`);
            } else {
                console.log(`   價格抓取：⚠️ 需改進 (${priceRate}%)`);
            }
            
            if (nameRate >= 90) {
                console.log(`   名稱抓取：🏆 優秀 (${nameRate}%)`);
            } else if (nameRate >= 70) {
                console.log(`   名稱抓取：✅ 良好 (${nameRate}%)`);
            } else {
                console.log(`   名稱抓取：⚠️ 需改進 (${nameRate}%)`);
            }
            
        } else {
            console.error(`❌ 完整友茂爬蟲測試失敗: ${result.error}`);
        }
        
    } catch (error) {
        console.error('測試過程中發生錯誤:', error);
    } finally {
        console.log('🏁 完整友茂爬蟲測試完成');
        process.exit(0);
    }
}

// 執行測試
testFullYoumaoScraper();
