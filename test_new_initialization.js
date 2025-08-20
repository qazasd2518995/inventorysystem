// 測試新的初始化邏輯
const { initializationCheck } = require('./smart_scraper');
const { getProductStats } = require('./database');

async function testNewInitialization() {
    console.log('🧪 測試新的初始化邏輯...\n');

    try {
        // 1. 查看當前資料庫狀態
        console.log('1️⃣ 查看當前資料庫狀態...');
        const currentStats = await getProductStats();
        console.log('📊 資料庫當前狀態:', {
            源正山: currentStats.yuanzhengshan,
            友茂: currentStats.youmao,
            總計: currentStats.total
        });
        console.log('');

        // 2. 執行新的初始化檢查
        console.log('2️⃣ 執行新的初始化檢查...');
        const initResult = await initializationCheck();
        
        console.log('🎯 初始化結果:', {
            成功: initResult.initialized,
            類型: initResult.type,
            錯誤: initResult.error || '無'
        });

        if (initResult.result) {
            console.log('📋 更新結果:', {
                總結: initResult.result.summary,
                源正山執行: initResult.result.yuanzhengshan?.executed || false,
                友茂執行: initResult.result.youmao?.executed || false
            });
        }

        console.log('');

        // 3. 查看更新後的資料庫狀態
        console.log('3️⃣ 查看更新後的資料庫狀態...');
        const finalStats = await getProductStats();
        console.log('📊 資料庫最終狀態:', {
            源正山: finalStats.yuanzhengshan,
            友茂: finalStats.youmao,
            總計: finalStats.total
        });

        // 4. 總結
        console.log('\n=== 測試總結 ===');
        console.log('✅ 新的初始化邏輯特點:');
        console.log('   - 不再檢查資料庫是否為空');  
        console.log('   - 直接根據商品總數一致性決定更新');
        console.log('   - 源正山和友茂獨立檢查');
        console.log('   - 只在數量不一致時執行爬蟲');

        if (initResult.initialized && initResult.result) {
            console.log(`\n🎉 測試成功！${initResult.result.summary}`);
        } else {
            console.log(`\n⚠️ 測試完成，但有問題: ${initResult.error || '未知錯誤'}`);
        }

    } catch (error) {
        console.error('❌ 測試過程發生錯誤:', error.message);
        console.error(error);
    }
}

// 執行測試
if (require.main === module) {
    testNewInitialization();
}

module.exports = { testNewInitialization };