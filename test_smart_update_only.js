// 測試智能更新功能
const { checkIfScrapingNeeded } = require('./product_count_checker');
const { smartUpdate } = require('./smart_scraper');

async function testSmartUpdateOnly() {
    console.log('🧪 測試智能更新系統（僅智能模式）...\n');

    try {
        // 1. 測試商品數量檢查
        console.log('1️⃣ 檢查賣場與資料庫商品數量...');
        const checkResult = await checkIfScrapingNeeded();
        
        console.log('📊 檢查結果:');
        console.log(`   源正山: 資料庫 ${checkResult.yuanzhengshan.database} vs 賣場 ${checkResult.yuanzhengshan.marketplace}`);
        console.log(`   友茂: 資料庫 ${checkResult.youmao.database} vs 賣場 ${checkResult.youmao.marketplace}`);
        console.log(`   源正山需要更新: ${checkResult.yuanzhengshan.needsUpdate ? '是' : '否'}`);
        console.log(`   友茂需要更新: ${checkResult.youmao.needsUpdate ? '是' : '否'}\n`);

        // 2. 執行智能更新
        console.log('2️⃣ 執行智能更新...');
        const updateResult = await smartUpdate({ force: false });
        
        console.log('🧠 智能更新結果:');
        console.log(`   總結: ${updateResult.summary}`);
        console.log(`   源正山執行: ${updateResult.yuanzhengshan.executed ? '是' : '否'}`);
        console.log(`   友茂執行: ${updateResult.youmao.executed ? '是' : '否'}`);
        
        if (updateResult.yuanzhengshan.executed && updateResult.yuanzhengshan.error) {
            console.log(`   源正山錯誤: ${updateResult.yuanzhengshan.error}`);
        }
        
        if (updateResult.youmao.executed && updateResult.youmao.error) {
            console.log(`   友茂錯誤: ${updateResult.youmao.error}`);
        }

        console.log('\n✅ 智能更新測試完成！');
        console.log('💡 系統將只在賣場商品數量與資料庫不一致時執行爬蟲');

    } catch (error) {
        console.error('❌ 測試過程發生錯誤:', error.message);
        console.error('錯誤詳細信息:', error);
    }
}

// 執行測試
if (require.main === module) {
    testSmartUpdateOnly();
}

module.exports = { testSmartUpdateOnly };