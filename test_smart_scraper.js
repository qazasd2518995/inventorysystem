// 智能爬蟲測試腳本
const { checkIfScrapingNeeded } = require('./product_count_checker');
const { initializationCheck, smartUpdate } = require('./smart_scraper');
const { getProductStats, initializeDatabase } = require('./database');

async function testSmartScraper() {
    console.log('🧪 開始測試智能爬蟲系統...\n');

    try {
        // 1. 初始化資料庫
        console.log('1️⃣ 初始化資料庫...');
        await initializeDatabase();
        console.log('✅ 資料庫初始化完成\n');

        // 2. 測試商品數量檢查
        console.log('2️⃣ 測試商品數量檢查...');
        const checkResult = await checkIfScrapingNeeded();
        console.log('🔍 檢查結果:', JSON.stringify(checkResult, null, 2));
        console.log('');

        // 3. 測試資料庫統計
        console.log('3️⃣ 測試資料庫統計...');
        const allStats = await getProductStats(); // 不指定 store_type 獲取所有統計
        console.log('📊 資料庫統計:', JSON.stringify(allStats, null, 2));
        console.log('');

        // 4. 測試初始化檢查
        console.log('4️⃣ 測試初始化檢查...');
        const initResult = await initializationCheck();
        console.log('🚀 初始化結果:', JSON.stringify(initResult, null, 2));
        console.log('');

        // 5. 測試智能更新（不強制）
        console.log('5️⃣ 測試智能更新（不強制）...');
        const smartResult = await smartUpdate({ force: false });
        console.log('🧠 智能更新結果:', JSON.stringify(smartResult, null, 2));
        console.log('');

        // 6. 最終統計
        console.log('6️⃣ 測試完成，顯示最終統計...');
        const finalStats = await getProductStats();
        console.log('📈 最終統計:', JSON.stringify(finalStats, null, 2));

        console.log('\n🎉 智能爬蟲測試完成！');

    } catch (error) {
        console.error('❌ 測試過程發生錯誤:', error.message);
        console.error('錯誤詳細信息:', error);
    }
}

// 執行測試
if (require.main === module) {
    testSmartScraper();
}

module.exports = { testSmartScraper };