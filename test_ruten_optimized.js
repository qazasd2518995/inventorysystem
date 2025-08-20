// 測試優化版友茂爬蟲
const { fetchRutenProductsOptimized } = require('./ruten_scraper_optimized');

async function testOptimizedRutenScraper() {
    console.log('🧪 測試優化版友茂爬蟲...\n');
    console.log('📋 優化特點:');
    console.log('   ✅ 單一瀏覽器實例 + 單頁面重用（源正山風格）');
    console.log('   ✅ 單階段處理（直接在列表頁抓取所有資料）');
    console.log('   ✅ 簡化設定（移除並行處理和複雜重試）');
    console.log('   ✅ 改進的價格和圖片抓取策略\n');
    
    const startTime = Date.now();
    
    try {
        // 設定只測試前3頁
        process.env.MAX_PAGES = '3';
        
        console.log('🚀 開始測試（前3頁）...\n');
        const result = await fetchRutenProductsOptimized();
        
        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(1);
        
        if (result.success) {
            const products = result.products || [];
            const withPrice = products.filter(p => p.price > 0).length;
            const withImage = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const withName = products.filter(p => p.name && !p.name.startsWith('商品 ')).length;
            
            console.log('\n📊 測試結果:');
            console.log(`   總執行時間: ${totalTime} 秒`);
            console.log(`   抓取商品數: ${products.length} 個`);
            console.log(`   價格成功: ${withPrice}/${products.length} (${((withPrice/products.length)*100).toFixed(1)}%)`);
            console.log(`   圖片成功: ${withImage}/${products.length} (${((withImage/products.length)*100).toFixed(1)}%)`);
            console.log(`   名稱成功: ${withName}/${products.length} (${((withName/products.length)*100).toFixed(1)}%)`);
            
            // 顯示前5個商品樣本
            if (products.length > 0) {
                console.log('\n📝 商品樣本（前5個）:');
                products.slice(0, 5).forEach((product, index) => {
                    const priceDisplay = product.price > 0 ? `NT$${product.price.toLocaleString()}` : '無價格';
                    const imageStatus = product.imageUrl ? '✅' : '❌';
                    console.log(`   ${index + 1}. ${product.name.slice(0, 30)}... | ${priceDisplay} | 圖片${imageStatus}`);
                });
            }
            
            // 預估全部45頁的時間
            const avgTimePerPage = totalTime / 3;
            const estimatedTotalTime = (avgTimePerPage * 45).toFixed(1);
            
            console.log('\n🔮 效能預估（45頁）:');
            console.log(`   預計總時間: ${estimatedTotalTime} 秒 (${(estimatedTotalTime/60).toFixed(1)} 分鐘)`);
            console.log(`   vs 原版: ~18分鐘`);
            console.log(`   速度提升: ${(1080/estimatedTotalTime).toFixed(1)}x`);
            
            // 比較記憶體使用
            console.log('\n💾 資源使用對比:');
            console.log('   原版: 5-8個並行頁面 + 重試機制 = 高CPU/記憶體');
            console.log('   優化版: 1個頁面 + 順序處理 = 低CPU/記憶體');
            
        } else {
            console.log(`\n❌ 測試失敗: ${result.error}`);
        }
        
    } catch (error) {
        console.error('\n❌ 測試過程發生錯誤:', error.message);
    } finally {
        // 清理環境變數
        delete process.env.MAX_PAGES;
    }
}

// 執行測試
if (require.main === module) {
    testOptimizedRutenScraper();
}

module.exports = { testOptimizedRutenScraper };