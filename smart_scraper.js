// 智能爬蟲管理器 - 只在必要時執行爬蟲
const { checkIfScrapingNeeded } = require('./product_count_checker');
const { fetchYahooAuctionProductsWithDB } = require('./database_scraper');
const { fetchRutenProducts } = require('./ruten_scraper_stable');
const {
    addUpdateLogToDB,
    tryAcquireSyncLock,
    recordSyncState
} = require('./database');

function describeRutenChanges(result) {
    if (!result || !result.update) return '';
    const update = result.update;
    return `；新增 ${update.newCount}、修改 ${update.modifiedCount}、價格變動 ${update.priceChangedCount}、下架 ${update.removedCount}`;
}

// 智能更新 - 只在必要時爬蟲
async function smartUpdate(options = {}) {
    const { force = false, storeType = null } = options;
    let releaseLock = null;
    
    try {
        releaseLock = await tryAcquireSyncLock();
        if (!releaseLock) {
            return {
                busy: true,
                timestamp: new Date().toISOString(),
                summary: '⏳ 另一個同步工作正在執行，本次不重複啟動'
            };
        }

        console.log('🧠 智能更新開始...');
        
        if (force) {
            console.log('🔧 強制更新模式，跳過檢查直接執行爬蟲');
            return await executeFullScraping(storeType);
        }

        // 檢查是否需要爬蟲
        const checkResult = await checkIfScrapingNeeded(storeType);
        
        if (checkResult.error) {
            console.log('⚠️ 檢查過程有錯誤，保留現有資料並稍後重試');
        }

        const needsYuanzhengshan = checkResult.yuanzhengshan.needsUpdate;
        // 露天批次 API 本身已是低流量同步；只看總數會漏掉「數量不變但價格改變」。
        const shouldSyncYoumaoViaApi = !storeType || storeType === 'youmao';

        let results = {
            timestamp: new Date().toISOString(),
            yuanzhengshan: { executed: false, result: null },
            youmao: { executed: false, result: null },
            check: checkResult,
            summary: ''
        };

        // 根據檢查結果決定執行哪些爬蟲
        if ((!storeType && needsYuanzhengshan) || (storeType === 'yuanzhengshan' && needsYuanzhengshan)) {
            console.log(`🎯 源正山需要更新 (資料庫: ${checkResult.yuanzhengshan.database}, 賣場: ${checkResult.yuanzhengshan.marketplace})`);
            try {
                await addUpdateLogToDB('info', '開始更新源正山商品資料');
                await recordSyncState('yuanzhengshan', 'started');
                const yahoResult = await fetchYahooAuctionProductsWithDB();
                results.yuanzhengshan = { executed: true, result: yahoResult };
                await recordSyncState('yuanzhengshan', 'success', { totalProducts: yahoResult.length, mode: 'smart' });
                await addUpdateLogToDB('success', `源正山更新完成，共處理 ${yahoResult.length} 個商品`);
            } catch (error) {
                console.error('❌ 源正山更新失敗:', error.message);
                await addUpdateLogToDB('error', `源正山更新失敗: ${error.message}`);
                await recordSyncState('yuanzhengshan', 'failed', { error: error.message });
                results.yuanzhengshan = { executed: true, result: null, error: error.message };
            }
        } else {
            console.log('✅ 源正山未執行完整更新');
        }

        if (shouldSyncYoumaoViaApi) {
            console.log(`🎯 友茂執行低流量 API 差異同步 (資料庫: ${checkResult.youmao.database}, 賣場: ${checkResult.youmao.marketplace ?? '未知'})`);
            try {
                await addUpdateLogToDB('info', '開始更新友茂商品資料');
                await recordSyncState('youmao', 'started');
                const rutenResult = await fetchRutenProducts();
                results.youmao = { executed: true, result: rutenResult };
                if (rutenResult.success === false) {
                    throw new Error(rutenResult.error || '露天同步失敗');
                }
                await recordSyncState('youmao', 'success', {
                    totalProducts: rutenResult.totalProducts,
                    mode: 'smart',
                    update: rutenResult.update
                });
                await addUpdateLogToDB('success', `友茂更新完成，共處理 ${rutenResult.totalProducts} 個商品${describeRutenChanges(rutenResult)}`);
            } catch (error) {
                console.error('❌ 友茂更新失敗:', error.message);
                await addUpdateLogToDB('error', `友茂更新失敗: ${error.message}`);
                await recordSyncState('youmao', 'failed', { error: error.message });
                results.youmao = { executed: true, result: null, error: error.message };
            }
        } else {
            console.log('✅ 友茂未執行完整更新');
        }

        // 生成總結
        const executedCount = (results.yuanzhengshan.executed ? 1 : 0) + (results.youmao.executed ? 1 : 0);
        if (executedCount === 0) {
            const selectedChecks = storeType ? [checkResult[storeType]] : [checkResult.yuanzhengshan, checkResult.youmao];
            results.summary = selectedChecks.some(result => result && result.indeterminate)
                ? '⚠️ 平台檢查暫時失敗，已保留資料並停止，稍後再試'
                : '✅ 商品數量一致，無需執行完整爬蟲';
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
    } finally {
        if (releaseLock) await releaseLock();
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
            await recordSyncState('yuanzhengshan', 'started');
            const yahooResult = await fetchYahooAuctionProductsWithDB();
            results.yuanzhengshan = { executed: true, result: yahooResult };
            await recordSyncState('yuanzhengshan', 'success', { totalProducts: yahooResult.length, mode: 'force' });
            await addUpdateLogToDB('success', `源正山強制更新完成，共處理 ${yahooResult.length} 個商品`);
        }

        if (!storeType || storeType === 'youmao') {
            console.log('🔄 更新友茂商品...');
            await addUpdateLogToDB('info', '強制更新友茂商品資料');
            await recordSyncState('youmao', 'started');
            const rutenResult = await fetchRutenProducts();
            if (rutenResult.success === false) {
                throw new Error(rutenResult.error || '露天同步失敗');
            }
            results.youmao = { executed: true, result: rutenResult };
            await recordSyncState('youmao', 'success', {
                totalProducts: rutenResult.totalProducts,
                mode: 'force',
                update: rutenResult.update
            });
            await addUpdateLogToDB('success', `友茂強制更新完成，共處理 ${rutenResult.totalProducts} 個商品${describeRutenChanges(rutenResult)}`);
        }

        results.summary = '🚀 強制完整更新完成';
        console.log('🎉 完整爬蟲更新完成');
        return results;

    } catch (error) {
        console.error('❌ 完整爬蟲更新失敗:', error.message);
        await addUpdateLogToDB('error', `完整爬蟲更新失敗: ${error.message}`);
        if (storeType) {
            await recordSyncState(storeType, 'failed', { error: error.message });
        }
        throw error;
    }
}

// 保留給既有維護腳本手動呼叫；Web Service 啟動流程不會執行此函式。
async function initializationCheck() {
    try {
        const result = await smartUpdate({ force: false });
        return { initialized: true, type: 'manual_smart_update', result };
    } catch (error) {
        return { initialized: false, type: 'manual_smart_update_failed', error: error.message };
    }
}

module.exports = {
    smartUpdate,
    executeFullScraping,
    initializationCheck,
    checkIfScrapingNeeded
};
