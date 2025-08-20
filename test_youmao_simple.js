const axios = require('axios');

async function testYoumaoStore() {
    console.log('🔍 測試友茂賣場是否存在...');
    
    const storeUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
    
    try {
        const response = await axios.get(storeUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        
        console.log(`✅ 賣場狀態: ${response.status}`);
        console.log(`📄 內容長度: ${response.data.length} 字符`);
        
        // 檢查是否包含商品相關內容
        const html = response.data;
        const indicators = [
            'item/show',
            '商品',
            'product',
            'u-mo0955900924',
            '友茂'
        ];
        
        indicators.forEach(indicator => {
            const found = html.includes(indicator);
            console.log(`   ${indicator}: ${found ? '✅ 找到' : '❌ 未找到'}`);
        });
        
        // 檢查是否是賣場首頁
        if (html.includes('賣場首頁') || html.includes('store')) {
            console.log('✅ 確認這是賣場頁面');
        } else {
            console.log('❌ 可能不是賣場頁面');
        }
        
        // 檢查錯誤訊息
        if (html.includes('找不到') || html.includes('不存在') || html.includes('404')) {
            console.log('❌ 賣場可能不存在或已關閉');
        }
        
    } catch (error) {
        console.error('❌ 無法訪問賣場:', error.message);
        
        if (error.response) {
            console.log(`   狀態碼: ${error.response.status}`);
            console.log(`   狀態文字: ${error.response.statusText}`);
        }
    }
}

testYoumaoStore();
