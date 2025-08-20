const puppeteer = require('puppeteer-core');
require('dotenv').config();

async function debugYoumaoPagination() {
    console.log('🔍 調試友茂分頁問題...');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        
        // 設置用戶代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        const baseUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        
        for (let pageNum = 1; pageNum <= 5; pageNum++) {
            console.log(`\n📄 測試第 ${pageNum} 頁...`);
            
            // 構建URL - 測試不同的分頁格式
            const testUrls = [
                `${baseUrl}?p=${pageNum}`,
                `${baseUrl}page${pageNum}`,
                `${baseUrl}?page=${pageNum}`,
                `${baseUrl}?rt_page=${pageNum}`
            ];
            
            for (const url of testUrls) {
                try {
                    console.log(`   🔗 測試URL: ${url}`);
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    
                    // 檢查商品數量
                    const productCount = await page.evaluate(() => {
                        const products = document.querySelectorAll('a[href*="/item/show?"]');
                        return products.length;
                    });
                    
                    // 檢查分頁資訊
                    const paginationInfo = await page.evaluate(() => {
                        const paginationElement = document.querySelector('.rt-pagination');
                        if (paginationElement) {
                            return paginationElement.textContent.trim();
                        }
                        
                        // 尋找其他分頁元素
                        const otherPagination = document.querySelector('.pagination, .page-nav, [class*="page"]');
                        if (otherPagination) {
                            return otherPagination.textContent.trim();
                        }
                        
                        return null;
                    });
                    
                    console.log(`     📦 商品數量: ${productCount}`);
                    console.log(`     📄 分頁資訊: ${paginationInfo}`);
                    
                    if (productCount > 0) {
                        console.log(`     ✅ 找到有效URL格式: ${url}`);
                        break;
                    }
                    
                } catch (error) {
                    console.log(`     ❌ URL失敗: ${error.message}`);
                }
            }
        }
        
        // 測試總頁數檢查
        console.log('\n🔍 檢查賣場總頁數...');
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        
        const totalInfo = await page.evaluate(() => {
            // 尋找總商品數或總頁數資訊
            const selectors = [
                '.rt-pagination',
                '.pagination',
                '[class*="total"]',
                '[class*="count"]',
                '.result-info',
                '.search-result'
            ];
            
            const results = {};
            
            selectors.forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    results[selector] = element.textContent.trim();
                }
            });
            
            // 檢查所有可能的總數元素
            const allText = document.body.textContent;
            const patterns = [
                /共\s*(\d+)\s*筆/,
                /總共\s*(\d+)\s*件/,
                /\d+\s*件商品/,
                /第\s*\d+\s*\/\s*(\d+)\s*頁/
            ];
            
            patterns.forEach(pattern => {
                const match = allText.match(pattern);
                if (match) {
                    results[`pattern_${pattern.source}`] = match[0];
                }
            });
            
            return results;
        });
        
        console.log('📊 找到的資訊:');
        Object.entries(totalInfo).forEach(([key, value]) => {
            console.log(`   ${key}: ${value}`);
        });
        
    } catch (error) {
        console.error('❌ 調試過程中發生錯誤:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 執行調試
debugYoumaoPagination();
