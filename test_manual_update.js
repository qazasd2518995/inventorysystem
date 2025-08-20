// 測試手動更新是否會強制執行爬蟲
const axios = require('axios');

async function testManualUpdate() {
    console.log('🧪 測試手動更新功能...\n');
    
    const serverUrl = 'http://localhost:3000';
    
    try {
        // 先登入
        console.log('1️⃣ 登入系統...');
        const loginResponse = await axios.post(`${serverUrl}/api/login`, {
            username: '2518995',
            password: '2518995'
        });
        
        if (!loginResponse.data.success) {
            throw new Error('登入失敗');
        }
        
        const cookies = loginResponse.headers['set-cookie'];
        console.log('✅ 登入成功\n');
        
        // 執行手動更新
        console.log('2️⃣ 執行手動更新（應該強制執行爬蟲）...');
        console.log('   預期行為：即使商品數量一致，也會強制執行爬蟲\n');
        
        const updateResponse = await axios.post(
            `${serverUrl}/api/refresh`,
            {},
            {
                headers: {
                    'Cookie': cookies
                }
            }
        );
        
        console.log('3️⃣ 更新結果：');
        console.log(`   訊息: ${updateResponse.data.message}`);
        console.log(`   結果摘要: ${updateResponse.data.result?.summary || '未提供摘要'}`);
        
        // 檢查結果
        const result = updateResponse.data.result;
        if (result) {
            console.log('\n4️⃣ 詳細執行狀況：');
            
            if (result.yuanzhengshan?.executed) {
                console.log('   ✅ 源正山：已執行爬蟲');
            } else {
                console.log('   ⏭️ 源正山：未執行（可能數量一致）');
            }
            
            if (result.youmao?.executed) {
                console.log('   ✅ 友茂：已執行爬蟲');
            } else {
                console.log('   ⏭️ 友茂：未執行（可能數量一致）');
            }
            
            // 驗證是否為強制更新
            if (result.summary && result.summary.includes('強制')) {
                console.log('\n✅ 測試通過：手動更新確實強制執行了爬蟲！');
            } else {
                console.log('\n⚠️ 注意：手動更新可能沒有強制執行爬蟲');
                console.log('   如果商品資料有問題，這可能不是預期的行為');
            }
        }
        
    } catch (error) {
        console.error('\n❌ 測試失敗：', error.message);
        if (error.response) {
            console.error('   錯誤詳情：', error.response.data);
        }
    }
}

// 執行測試
if (require.main === module) {
    console.log('=====================================');
    console.log('   手動更新強制爬蟲測試');
    console.log('=====================================\n');
    
    testManualUpdate().then(() => {
        console.log('\n=====================================');
        console.log('   測試完成');
        console.log('=====================================');
        process.exit(0);
    });
}

module.exports = { testManualUpdate };