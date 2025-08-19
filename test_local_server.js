const axios = require('axios');

async function testLocalServer() {
    const baseURL = 'http://localhost:3000';
    
    try {
        console.log('🚀 開始本地伺服器完整測試...\n');
        
        // 1. 登入系統
        console.log('🔐 嘗試登入系統...');
        const loginData = {
            username: '2518995',
            password: '2518995'
        };
        
        let sessionCookies = '';
        try {
            const loginResponse = await axios.post(`${baseURL}/api/login`, loginData);
            console.log('✅ 登入成功');
            
            // 保存會話cookie
            if (loginResponse.headers['set-cookie']) {
                sessionCookies = loginResponse.headers['set-cookie'].join('; ');
            }
        } catch (error) {
            console.log(`❌ 登入失敗: ${error.response?.data?.message || error.message}`);
            return;
        }
        
        // 2. 檢查伺服器狀態
        console.log('\n📡 檢查伺服器狀態...');
        try {
            const healthCheck = await axios.get(`${baseURL}/api/products`, {
                headers: {
                    'Cookie': sessionCookies
                }
            });
            console.log(`✅ 伺服器正常運行，當前商品數：${healthCheck.data.total}`);
        } catch (error) {
            console.log(`❌ 無法獲取商品狀態: ${error.message}`);
        }
        
        // 3. 觸發完整更新
        console.log('\n📥 觸發完整商品抓取...');
        console.log('⏰ 預計需要 3-5 分鐘完成，請耐心等候...');
        
        const startTime = Date.now();
        
        try {
            const refreshResponse = await axios.post(`${baseURL}/api/refresh`, {}, {
                headers: {
                    'Cookie': sessionCookies
                },
                timeout: 600000 // 10分鐘超時
            });
            
            const endTime = Date.now();
            const duration = Math.round((endTime - startTime) / 1000);
            
            console.log(`✅ 抓取完成！耗時 ${duration} 秒`);
            console.log(`📊 抓取結果: ${refreshResponse.data.message}`);
            
        } catch (error) {
            console.log(`❌ 抓取過程發生錯誤: ${error.message}`);
            if (error.code === 'ECONNABORTED') {
                console.log('⏰ 可能是抓取時間過長導致超時，讓我們檢查當前狀態...');
            }
        }
        
        // 4. 檢查最終結果
        console.log('\n📊 檢查最終抓取結果...');
        try {
            const finalResult = await axios.get(`${baseURL}/api/products`, {
                headers: {
                    'Cookie': sessionCookies
                }
            });
            
            const totalProducts = finalResult.data.total;
            const products = finalResult.data.products || [];
            
            // 計算圖片統計
            const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const imageSuccessRate = totalProducts > 0 ? ((productsWithImages / totalProducts) * 100).toFixed(1) : 0;
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🎯 本地伺服器測試結果');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📦 總商品數: ${totalProducts}`);
            console.log(`🖼️  有圖片: ${productsWithImages} (${imageSuccessRate}%)`);
            console.log(`❌ 無圖片: ${totalProducts - productsWithImages}`);
            console.log(`🕒 最後更新: ${finalResult.data.lastUpdate ? new Date(finalResult.data.lastUpdate).toLocaleString('zh-TW') : '未知'}`);
            
            // 顯示前10個商品的圖片狀態
            console.log('\n🔍 前10個商品圖片狀態:');
            products.slice(0, 10).forEach((product, index) => {
                const hasImage = product.imageUrl && product.imageUrl.trim() !== '';
                console.log(`${index + 1}. ${product.id} - ${hasImage ? '✅' : '❌'} ${hasImage ? product.imageUrl.substring(0, 50) + '...' : '無圖片'}`);
            });
            
            // 分析圖片域名分布
            const imageDomains = {};
            products.forEach(product => {
                if (product.imageUrl && product.imageUrl.trim() !== '') {
                    try {
                        const url = new URL(product.imageUrl);
                        imageDomains[url.hostname] = (imageDomains[url.hostname] || 0) + 1;
                    } catch (e) {
                        imageDomains['invalid'] = (imageDomains['invalid'] || 0) + 1;
                    }
                }
            });
            
            console.log('\n🌐 圖片域名分布:');
            Object.entries(imageDomains).forEach(([domain, count]) => {
                console.log(`   • ${domain}: ${count} 個`);
            });
            
            // 與Render環境對比
            console.log('\n📈 環境對比分析:');
            console.log(`🖥️  本地環境: ${imageSuccessRate}%`);
            console.log(`☁️  Render環境: 32.4%`);
            const improvement = (parseFloat(imageSuccessRate) - 32.4).toFixed(1);
            console.log(`📊 差異: ${improvement > 0 ? '+' : ''}${improvement}%`);
            
            if (parseFloat(imageSuccessRate) > 80) {
                console.log('\n✅ 本地環境圖片抓取表現良好！問題確實出在Render環境限制。');
            } else {
                console.log('\n⚠️  本地環境圖片抓取也有問題，需要進一步優化抓取邏輯。');
            }
            
        } catch (error) {
            console.log(`❌ 無法獲取最終結果: ${error.message}`);
        }
        
        // 5. 獲取更新日誌
        console.log('\n📝 檢查更新日誌...');
        try {
            const logsResponse = await axios.get(`${baseURL}/api/update-logs`, {
                headers: {
                    'Cookie': sessionCookies
                }
            });
            
            const logs = logsResponse.data.logs || [];
            console.log(`📋 共有 ${logs.length} 條更新日誌`);
            
            // 顯示最新的5條日誌
            console.log('\n🔍 最新5條更新日誌:');
            logs.slice(0, 5).forEach((log, index) => {
                const time = new Date(log.timestamp).toLocaleString('zh-TW');
                console.log(`${index + 1}. [${log.type.toUpperCase()}] ${time}`);
                console.log(`   ${log.message}`);
                if (log.details && log.details.imageStats) {
                    const stats = log.details.imageStats;
                    console.log(`   📊 圖片統計: ${stats.withImages}/${stats.total} (${stats.successRate})`);
                }
            });
            
        } catch (error) {
            console.log(`❌ 無法獲取更新日誌: ${error.message}`);
        }
        
    } catch (error) {
        console.error('❌ 測試過程發生未預期錯誤:', error.message);
    }
}

// 執行測試
testLocalServer();
