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
                '--disable-images',
                '--disable-javascript'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log('🔍 檢查源正山商品總數...');
        await page.goto('https://tw.bid.yahoo.com/booth/Y1823944291', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        const totalCount = await page.evaluate(() => {
            // 尋找商品總數 <span class="sc-eEfxbP bSHwST">2009筆結果</span>
            const countSelectors = [
                '.sc-eEfxbP.bSHwST',
                '[class*="bSHwST"]',
                '[data-testid*="result"]',
                '.result-count',
                '.total-count'
            ];
            
            for (const selector of countSelectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent) {
                    const match = element.textContent.match(/(\d+)筆結果/);
                    if (match) {
                        return parseInt(match[1]);
                    }
                }
            }
            
            // 備用方法：從頁面標題或其他位置抓取
            const bodyText = document.body.textContent || '';
            const titleMatch = bodyText.match(/(\d+)筆結果/);
            if (titleMatch) {
                return parseInt(titleMatch[1]);
            }
            
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
                '--disable-images',
                '--disable-javascript'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log('🔍 檢查友茂商品總數...');
        await page.goto('https://www.ruten.com.tw/store/u-mo0955900924/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        const totalCount = await page.evaluate(() => {
            // 尋找 <a href="..." class="category-listing-item-link category-current">全部商品 (1306)</a>
            const countSelectors = [
                '.category-listing-item-link.category-current',
                '.category-current',
                '.category-listing-item-link',
                '[href*="/list"]',
                '.total-products'
            ];
            
            for (const selector of countSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (element.textContent && element.textContent.includes('全部商品')) {
                        const match = element.textContent.match(/全部商品\s*\((\d+)\)/);
                        if (match) {
                            return parseInt(match[1]);
                        }
                    }
                }
            }
            
            // 備用方法：查找任何包含商品數量的文字
            const bodyText = document.body.textContent || '';
            const generalMatch = bodyText.match(/全部商品\s*\((\d+)\)/);
            if (generalMatch) {
                return parseInt(generalMatch[1]);
            }
            
            // 另一個備用方法：查找分頁信息
            const paginationMatch = bodyText.match(/共\s*(\d+)\s*件商品/);
            if (paginationMatch) {
                return parseInt(paginationMatch[1]);
            }
            
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