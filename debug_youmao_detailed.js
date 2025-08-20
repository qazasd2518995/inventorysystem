const puppeteer = require('puppeteer-core');
require('dotenv').config();

async function debugYoumaoPagination() {
    console.log('🔍 深度調試友茂賣場...');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false, // 使用有頭模式來觀察
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: [
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });

        const page = await browser.newPage();
        
        // 設置用戶代理
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        const baseUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        
        console.log(`\n🌐 訪問賣場首頁: ${baseUrl}`);
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // 等待頁面完全載入
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 檢查頁面內容
        const pageContent = await page.evaluate(() => {
            const info = {
                title: document.title,
                url: window.location.href,
                products: [],
                pagination: '',
                totalText: '',
                allSelectors: []
            };
            
            // 尋找商品
            const productSelectors = [
                'a[href*="/item/show?"]',
                '.item', 
                '.product',
                '[class*="item"]',
                '[class*="product"]',
                'a[href*="item"]'
            ];
            
            productSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    info.allSelectors.push(`${selector}: ${elements.length} 個`);
                    if (selector === 'a[href*="/item/show?"]') {
                        Array.from(elements).slice(0, 3).forEach((el, index) => {
                            info.products.push({
                                href: el.href,
                                text: el.textContent.trim().substring(0, 50)
                            });
                        });
                    }
                }
            });
            
            // 尋找分頁資訊
            const paginationSelectors = [
                '.rt-pagination',
                '.pagination',
                '[class*="page"]',
                '[class*="nav"]'
            ];
            
            paginationSelectors.forEach(selector => {
                const element = document.querySelector(selector);
                if (element) {
                    info.pagination += `${selector}: ${element.textContent.trim()}\n`;
                }
            });
            
            // 尋找總數資訊
            const bodyText = document.body.textContent;
            const patterns = [
                /共\s*(\d+)\s*筆/g,
                /總共\s*(\d+)\s*件/g,
                /\d+\s*件商品/g,
                /第\s*\d+\s*\/\s*\d+\s*頁/g
            ];
            
            patterns.forEach(pattern => {
                const matches = Array.from(bodyText.matchAll(pattern));
                if (matches.length > 0) {
                    info.totalText += matches.map(m => m[0]).join(', ') + '\n';
                }
            });
            
            return info;
        });
        
        console.log('📊 頁面分析結果:');
        console.log(`   標題: ${pageContent.title}`);
        console.log(`   URL: ${pageContent.url}`);
        console.log(`   選擇器結果: ${pageContent.allSelectors.join(', ')}`);
        console.log(`   商品數量: ${pageContent.products.length}`);
        console.log(`   分頁資訊: ${pageContent.pagination || '無'}`);
        console.log(`   總數資訊: ${pageContent.totalText || '無'}`);
        
        if (pageContent.products.length > 0) {
            console.log('\n🛍️ 找到的商品:');
            pageContent.products.forEach((product, index) => {
                console.log(`   ${index + 1}. ${product.text}`);
                console.log(`      URL: ${product.href}`);
            });
        }
        
        // 滾動頁面看是否有更多商品
        console.log('\n📜 測試滾動載入...');
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const afterScrollProducts = await page.evaluate(() => {
            return document.querySelectorAll('a[href*="/item/show?"]').length;
        });
        
        console.log(`   滾動後商品數量: ${afterScrollProducts}`);
        
        // 手動等待15秒讓您觀察頁面
        console.log('\n⏰ 等待15秒讓您觀察頁面...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
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
