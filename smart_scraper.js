// 智能爬蟲管理器 - 只在必要時執行爬蟲
const { checkIfScrapingNeeded } = require('./product_count_checker');
const { fetchYahooAuctionProductsWithDB } = require('./database_scraper');
const { fetchRutenProducts } = require('./ruten_scraper_stable');
const { addUpdateLogToDB } = require('./database');

// 智能更新 - 只在必要時爬蟲
async function smartUpdate(options = {}) {
    const { force = false, storeType = null } = options;
    
    try {
        console.log('🧠 智能更新開始...');
        
        if (force) {
            console.log('🔧 強制更新模式，跳過檢查直接執行爬蟲');
            return await executeFullScraping(storeType);
        }

        // 檢查是否需要爬蟲
        const checkResult = await checkIfScrapingNeeded();
        
        if (checkResult.error) {
            console.log('⚠️ 檢查過程有錯誤，保守執行爬蟲');
            return await executeFullScraping(storeType);
        }

        const needsYuanzhengshan = checkResult.yuanzhengshan.needsUpdate;
        const needsYoumao = checkResult.youmao.needsUpdate;

        let results = {
            timestamp: new Date().toISOString(),
            yuanzhengshan: { executed: false, result: null },
            youmao: { executed: false, result: null },
            summary: ''
        };

        // 根據檢查結果決定執行哪些爬蟲
        if (storeType === 'yuanzhengshan' || (!storeType && needsYuanzhengshan)) {
            console.log(`🎯 源正山需要更新 (資料庫: ${checkResult.yuanzhengshan.database}, 賣場: ${checkResult.yuanzhengshan.marketplace})`);
            try {
                await addUpdateLogToDB('info', '開始更新源正山商品資料');
                const yahoResult = await fetchYahooAuctionProductsWithDB();
                results.yuanzhengshan = { executed: true, result: yahoResult };
                await addUpdateLogToDB('success', `源正山更新完成，共處理 ${yahoResult.length} 個商品`);
            } catch (error) {
                console.error('❌ 源正山更新失敗:', error.message);
                await addUpdateLogToDB('error', `源正山更新失敗: ${error.message}`);
                results.yuanzhengshan = { executed: true, result: null, error: error.message };
            }
        } else {
            console.log(`✅ 源正山無需更新 (資料庫: ${checkResult.yuanzhengshan.database}, 賣場: ${checkResult.yuanzhengshan.marketplace})`);
        }

        if (storeType === 'youmao' || (!storeType && needsYoumao)) {
            console.log(`🎯 友茂需要更新 (資料庫: ${checkResult.youmao.database}, 賣場: ${checkResult.youmao.marketplace})`);
            try {
                await addUpdateLogToDB('info', '開始更新友茂商品資料');
                const rutenResult = await fetchRutenProducts();
                results.youmao = { executed: true, result: rutenResult };
                await addUpdateLogToDB('success', `友茂更新完成，共處理 ${rutenResult.totalProducts} 個商品`);
            } catch (error) {
                console.error('❌ 友茂更新失敗:', error.message);
                await addUpdateLogToDB('error', `友茂更新失敗: ${error.message}`);
                results.youmao = { executed: true, result: null, error: error.message };
            }
        } else {
            console.log(`✅ 友茂無需更新 (資料庫: ${checkResult.youmao.database}, 賣場: ${checkResult.youmao.marketplace})`);
        }

        // 生成總結
        const executedCount = (results.yuanzhengshan.executed ? 1 : 0) + (results.youmao.executed ? 1 : 0);
        if (executedCount === 0) {
            results.summary = '✅ 所有商店商品數量一致，無需執行爬蟲';
        } else {
            const stores = [];
            if (results.yuanzhengshan.executed) stores.push('源正山');
            if (results.youmao.executed) stores.push('友茂');
            results.summary = `🔄 已更新 ${stores.join('、')} 商店資料`;
        }

        console.log(`🎉 智能更新完成: ${results.summary}`);
        return results;

    } catch (error) {
        console.error('❌ 智能更新失敗:', error.message);
        await addUpdateLogToDB('error', `智能更新失敗: ${error.message}`);
        throw error;
    }
}

// 強制執行完整爬蟲
async function executeFullScraping(storeType = null) {
    console.log('🚀 執行完整爬蟲更新...');
    
    const results = {
        timestamp: new Date().toISOString(),
        yuanzhengshan: { executed: false, result: null },
        youmao: { executed: false, result: null }
    };

    try {
        if (!storeType || storeType === 'yuanzhengshan') {
            console.log('🔄 更新源正山商品...');
            await addUpdateLogToDB('info', '強制更新源正山商品資料');
            const yahooResult = await fetchYahooAuctionProductsWithDB();
            results.yuanzhengshan = { executed: true, result: yahooResult };
            await addUpdateLogToDB('success', `源正山強制更新完成，共處理 ${yahooResult.length} 個商品`);
        }

        if (!storeType || storeType === 'youmao') {
            console.log('🔄 更新友茂商品...');
            await addUpdateLogToDB('info', '強制更新友茂商品資料');
            const rutenResult = await fetchRutenProducts();
            results.youmao = { executed: true, result: rutenResult };
            await addUpdateLogToDB('success', `友茂強制更新完成，共處理 ${rutenResult.totalProducts} 個商品`);
        }

        results.summary = '🚀 強制完整更新完成';
        console.log('🎉 完整爬蟲更新完成');
        return results;

    } catch (error) {
        console.error('❌ 完整爬蟲更新失敗:', error.message);
        await addUpdateLogToDB('error', `完整爬蟲更新失敗: ${error.message}`);
        throw error;
    }
}

// 伺服器啟動時的初始化檢查
async function initializationCheck() {
    console.log('🔍 伺服器啟動：檢查資料庫是否需要初始化...');
    
    try {
        const checkResult = await checkIfScrapingNeeded();
        
        // 只有在資料庫完全沒有資料時才執行初始化
        const yuanzhengNeedsInit = checkResult.yuanzhengshan.database === 0;
        const youmaoNeedsInit = checkResult.youmao.database === 0;
        
        if (!yuanzhengNeedsInit && !youmaoNeedsInit) {
            console.log('✅ 資料庫已有資料，跳過初始化');
            console.log(`   源正山: ${checkResult.yuanzhengshan.database} 個商品`);
            console.log(`   友茂: ${checkResult.youmao.database} 個商品`);
            return { initialized: false, reason: 'database_has_data' };
        }

        console.log('🚀 檢測到空資料庫，執行初始化爬蟲...');
        
        let initResults = {
            yuanzhengshan: { needed: yuanzhengNeedsInit, executed: false },
            youmao: { needed: youmaoNeedsInit, executed: false }
        };

        if (yuanzhengNeedsInit) {
            console.log('📈 初始化源正山商品資料...');
            try {
                await addUpdateLogToDB('info', '伺服器啟動：初始化源正山商品資料');
                const yahooResult = await fetchYahooAuctionProductsWithDB();
                initResults.yuanzhengshan.executed = true;
                initResults.yuanzhengshan.result = yahooResult;
                console.log(`✅ 源正山初始化完成：${yahooResult.length} 個商品`);
            } catch (error) {
                console.error('❌ 源正山初始化失敗:', error.message);
                await addUpdateLogToDB('error', `源正山初始化失敗: ${error.message}`);
                initResults.yuanzhengshan.error = error.message;
            }
        }

        if (youmaoNeedsInit) {
            console.log('📈 初始化友茂商品資料...');
            try {
                await addUpdateLogToDB('info', '伺服器啟動：初始化友茂商品資料');
                const rutenResult = await fetchRutenProducts();
                initResults.youmao.executed = true;
                initResults.youmao.result = rutenResult;
                console.log(`✅ 友茂初始化完成：${rutenResult.totalProducts} 個商品`);
            } catch (error) {
                console.error('❌ 友茂初始化失敗:', error.message);
                await addUpdateLogToDB('error', `友茂初始化失敗: ${error.message}`);
                initResults.youmao.error = error.message;
            }
        }

        return { initialized: true, results: initResults };

    } catch (error) {
        console.error('❌ 初始化檢查失敗:', error.message);
        await addUpdateLogToDB('error', `初始化檢查失敗: ${error.message}`);
        return { initialized: false, error: error.message };
    }
}

module.exports = {
    smartUpdate,
    executeFullScraping,
    initializationCheck,
    checkIfScrapingNeeded
};