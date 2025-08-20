// 商品數量檢查器 - 避免不必要的爬蟲行為
const puppeteer = require('puppeteer');
const { getProductStats } = require('./database');

// 檢查源正山商品總數
async function checkYuanzhengshan() {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-images', // 只禁用圖片載入以節省資源
                // 移除 --disable-javascript 因為現代網站需要JS
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('🔍 檢查源正山商品總數...');
        await page.goto('https://tw.bid.yahoo.com/booth/Y1823944291', {
            waitUntil: 'networkidle2', // 等待網路安靜
            timeout: 45000
        });

        // 等待頁面完全載入動態內容
        await new Promise(resolve => setTimeout(resolve, 3000));

        const totalCount = await page.evaluate(() => {
            // 尋找商品總數的多種策略
            console.log('開始搜索源正山商品數量...');
            
            // 策略1: 使用已知的CSS選擇器
            const countSelectors = [
                '.sc-eEfxbP.bSHwST',
                '[class*="bSHwST"]',
                '[data-testid*="result"]',
                '.result-count',
                '.total-count',
                '.sc-fqkvVR', // 新增更多可能的選擇器
                '.sc-iBPRYJ',
                '[class*="result"]',
                'span[class*="sc-"]'
            ];
            
            for (const selector of countSelectors) {
                const elements = document.querySelectorAll(selector);
                console.log(`選擇器 ${selector}: 找到 ${elements.length} 個元素`);
                
                for (const element of elements) {
                    if (element && element.textContent) {
                        const text = element.textContent.trim();
                        console.log(`檢查文字: "${text}"`);
                        const match = text.match(/(\d+)\s*筆結果/);
                        if (match) {
                            console.log(`✅ 找到商品數量: ${match[1]}`);
                            return parseInt(match[1]);
                        }
                    }
                }
            }
            
            // 策略2: 從整個頁面文字搜索
            console.log('策略2: 搜索整個頁面文字...');
            const bodyText = document.body.textContent || '';
            console.log(`頁面文字長度: ${bodyText.length}`);
            
            // 查找所有可能的數字+筆結果格式
            const allMatches = bodyText.match(/(\d+)\s*筆結果/g);
            if (allMatches && allMatches.length > 0) {
                console.log(`找到的所有匹配: ${allMatches}`);
                const firstMatch = bodyText.match(/(\d+)\s*筆結果/);
                if (firstMatch) {
                    const count = parseInt(firstMatch[1]);
                    console.log(`✅ 從頁面文字找到: ${count}`);
                    return count;
                }
            }
            
            // 策略3: 檢查頁面標題
            const title = document.title || '';
            console.log(`頁面標題: "${title}"`);
            const titleMatch = title.match(/(\d+)\s*筆結果/);
            if (titleMatch) {
                console.log(`✅ 從標題找到: ${titleMatch[1]}`);
                return parseInt(titleMatch[1]);
            }
            
            console.log('❌ 所有策略都未找到商品數量');
            return null;
        });

        return { success: true, count: totalCount, store: 'yuanzhengshan' };

    } catch (error) {
        console.error('❌ 檢查源正山商品數量失敗:', error.message);
        return { success: false, error: error.message, store: 'yuanzhengshan' };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 檢查友茂（露天）商品總數
async function checkYoumao() {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-images', // 只禁用圖片載入以節省資源
                // 移除 --disable-javascript 因為現代網站需要JS
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('🔍 檢查友茂商品總數...');
        await page.goto('https://www.ruten.com.tw/store/u-mo0955900924/', {
            waitUntil: 'networkidle2', // 等待網路安靜
            timeout: 45000
        });

        // 等待頁面完全載入動態內容
        await new Promise(resolve => setTimeout(resolve, 3000));

        const totalCount = await page.evaluate(() => {
            // 友茂商品數量檢查的多種策略
            console.log('開始搜索友茂商品數量...');
            
            // 策略1: 使用已知的CSS選擇器
            const countSelectors = [
                '.category-listing-item-link.category-current',
                '.category-current',
                '.category-listing-item-link',
                '[href*="/list"]',
                '.total-products',
                'a[href*="list"]', // 新增更多可能的選擇器
                '.category-item',
                '.category-link'
            ];
            
            for (const selector of countSelectors) {
                const elements = document.querySelectorAll(selector);
                console.log(`選擇器 ${selector}: 找到 ${elements.length} 個元素`);
                
                for (const element of elements) {
                    if (element && element.textContent) {
                        const text = element.textContent.trim();
                        console.log(`檢查文字: "${text}"`);
                        
                        if (text.includes('全部商品')) {
                            const match = text.match(/全部商品\s*\((\d+)\)/);
                            if (match) {
                                console.log(`✅ 找到友茂商品數量: ${match[1]}`);
                                return parseInt(match[1]);
                            }
                        }
                    }
                }
            }
            
            // 策略2: 從整個頁面文字搜索
            console.log('策略2: 搜索整個友茂頁面文字...');
            const bodyText = document.body.textContent || '';
            console.log(`頁面文字長度: ${bodyText.length}`);
            
            // 查找 "全部商品 (數字)" 格式
            const allProductsMatches = bodyText.match(/全部商品\s*\((\d+)\)/g);
            if (allProductsMatches && allProductsMatches.length > 0) {
                console.log(`找到的所有匹配: ${allProductsMatches}`);
                const firstMatch = bodyText.match(/全部商品\s*\((\d+)\)/);
                if (firstMatch) {
                    const count = parseInt(firstMatch[1]);
                    console.log(`✅ 從頁面文字找到: ${count}`);
                    return count;
                }
            }
            
            // 策略3: 查找其他可能的商品數量格式
            const paginationMatches = [
                /共\s*(\d+)\s*件商品/,
                /總共\s*(\d+)\s*個商品/,
                /(\d+)\s*個商品/
            ];
            
            for (const pattern of paginationMatches) {
                const match = bodyText.match(pattern);
                if (match) {
                    const count = parseInt(match[1]);
                    console.log(`✅ 從其他格式找到: ${count} (模式: ${pattern})`);
                    return count;
                }
            }
            
            console.log('❌ 所有策略都未找到友茂商品數量');
            return null;
        });

        return { success: true, count: totalCount, store: 'youmao' };

    } catch (error) {
        console.error('❌ 檢查友茂商品數量失敗:', error.message);
        return { success: false, error: error.message, store: 'youmao' };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 主要檢查函數 - 比對資料庫與賣場數量
async function checkIfScrapingNeeded() {
    try {
        console.log('📊 開始檢查是否需要爬蟲...');
        
        // 獲取資料庫統計
        const dbStats = await getProductStats();
        console.log('📈 資料庫統計:', {
            yuanzhengshan: dbStats.yuanzhengshan || 0,
            youmao: dbStats.youmao || 0,
            total: dbStats.total || 0
        });

        // 檢查賣場商品總數
        const [yuanzhengResult, youmaoResult] = await Promise.all([
            checkYuanzhengshan(),
            checkYoumao()
        ]);

        const result = {
            timestamp: new Date().toISOString(),
            yuanzhengshan: {
                database: dbStats.yuanzhengshan || 0,
                marketplace: yuanzhengResult.count || 0,
                needsUpdate: false,
                error: yuanzhengResult.success ? null : yuanzhengResult.error
            },
            youmao: {
                database: dbStats.youmao || 0,
                marketplace: youmaoResult.count || 0,
                needsUpdate: false,
                error: youmaoResult.success ? null : youmaoResult.error
            }
        };

        // 判斷是否需要更新
        if (yuanzhengResult.success && yuanzhengResult.count) {
            result.yuanzhengshan.needsUpdate = result.yuanzhengshan.database !== yuanzhengResult.count;
        } else {
            result.yuanzhengshan.needsUpdate = true; // 如果無法獲取數量，保守起見執行爬蟲
        }

        if (youmaoResult.success && youmaoResult.count) {
            result.youmao.needsUpdate = result.youmao.database !== youmaoResult.count;
        } else {
            result.youmao.needsUpdate = true; // 如果無法獲取數量，保守起見執行爬蟲
        }

        // 輸出結果
        console.log('🔍 檢查結果:');
        console.log(`   源正山: 資料庫 ${result.yuanzhengshan.database} vs 賣場 ${result.yuanzhengshan.marketplace} - ${result.yuanzhengshan.needsUpdate ? '需要更新' : '無需更新'}`);
        console.log(`   友茂: 資料庫 ${result.youmao.database} vs 賣場 ${result.youmao.marketplace} - ${result.youmao.needsUpdate ? '需要更新' : '無需更新'}`);

        return result;

    } catch (error) {
        console.error('❌ 檢查過程發生錯誤:', error.message);
        return {
            timestamp: new Date().toISOString(),
            error: error.message,
            yuanzhengshan: { needsUpdate: true }, // 錯誤時保守執行爬蟲
            youmao: { needsUpdate: true }
        };
    }
}

module.exports = {
    checkYuanzhengshan,
    checkYoumao,
    checkIfScrapingNeeded
};