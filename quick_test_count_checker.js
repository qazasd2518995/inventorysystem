// 快速測試修復後的商品數量檢查器
const { checkYuanzhengshan, checkYoumao } = require('./product_count_checker');

async function quickTest() {
    console.log('🔧 快速測試修復後的商品數量檢查器...\n');

    try {
        // 測試源正山
        console.log('=== 測試源正山 ===');
        const yuanzhengResult = await checkYuanzhengshan();
        console.log('源正山結果:', {
            成功: yuanzhengResult.success,
            商品數量: yuanzhengResult.count,
            錯誤: yuanzhengResult.error
        });
        console.log('');

        // 測試友茂
        console.log('=== 測試友茂 ===');
        const youmaoResult = await checkYoumao();
        console.log('友茂結果:', {
            成功: youmaoResult.success,
            商品數量: youmaoResult.count,
            錯誤: youmaoResult.error
        });
        console.log('');

        // 總結
        console.log('=== 測試總結 ===');
        console.log(`源正山: ${yuanzhengResult.success ? '✅ 成功' : '❌ 失敗'} - 數量: ${yuanzhengResult.count || 'N/A'}`);
        console.log(`友茂: ${youmaoResult.success ? '✅ 成功' : '❌ 失敗'} - 數量: ${youmaoResult.count || 'N/A'}`);

        if (yuanzhengResult.success && youmaoResult.success && 
            yuanzhengResult.count > 0 && youmaoResult.count > 0) {
            console.log('\n🎉 測試通過！商品數量檢查器已修復');
        } else {
            console.log('\n⚠️ 仍有問題需要進一步調試');
        }

    } catch (error) {
        console.error('❌ 測試失敗:', error.message);
    }
}

// 執行測試
if (require.main === module) {
    quickTest();
}

module.exports = { quickTest };