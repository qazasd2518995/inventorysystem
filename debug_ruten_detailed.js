// 詳細調試露天市集價格和分頁結構
const puppeteer = require('puppeteer');

async function debugRutenDetailed() {
    let browser = null;
    
    try {
        console.log('🔍 啟動詳細調試...');
        
        browser = await puppeteer.launch({
            headless: false, // 設為false以便觀察
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // 設定用戶代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        const url = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 正在訪問: ${url}`);
        
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        // 等待頁面載入
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('🔍 分析商品價格結構...');
        
        const priceAnalysis = await page.evaluate(() => {
            const analysis = {
                totalLinks: 0,
                sampleProducts: [],
                priceSelectors: {},
                paginationInfo: {}
            };
            
            // 找到所有商品連結
            const productLinks = document.querySelectorAll('a[href*="/item/"]');
            analysis.totalLinks = productLinks.length;
            
            // 分析前5個商品的價格結構
            Array.from(productLinks).slice(0, 5).forEach((linkElement, index) => {
                const productInfo = {
                    index: index,
                    href: linkElement.href,
                    text: linkElement.textContent.trim().slice(0, 100),
                    prices: []
                };
                
                // 找到商品ID
                const match = linkElement.href.match(/[?&](\d+)/);
                if (match) {
                    productInfo.id = match[1];
                }
                
                // 尋找價格 - 從父元素開始
                const parentElement = linkElement.closest('[class*="item"], [class*="product"]') || linkElement.parentElement;
                if (parentElement) {
                    // 嘗試多種價格選擇器
                    const priceSelectors = [
                        '[class*="price"]',
                        '.money',
                        '[class*="cost"]',
                        '[class*="amount"]',
                        '[class*="dollar"]',
                        '[data-price]',
                        '.rt-price',
                        '.item-price',
                        '.product-price',
                        'span[class*="price"]',
                        'div[class*="price"]'
                    ];
                    
                    priceSelectors.forEach(selector => {
                        const priceElements = parentElement.querySelectorAll(selector);
                        priceElements.forEach(priceEl => {
                            const priceText = priceEl.textContent || '';
                            const priceMatch = priceText.match(/[\d,]+/);
                            if (priceMatch && parseInt(priceMatch[0].replace(/,/g, '')) > 0) {
                                productInfo.prices.push({
                                    selector: selector,
                                    text: priceText.trim(),
                                    value: parseInt(priceMatch[0].replace(/,/g, '')),
                                    element: priceEl.outerHTML.slice(0, 200)
                                });
                            }
                        });
                    });
                }
                
                analysis.sampleProducts.push(productInfo);
            });
            
            // 統計價格選擇器效果
            const selectorCounts = {};
            analysis.sampleProducts.forEach(product => {
                product.prices.forEach(price => {
                    if (!selectorCounts[price.selector]) {
                        selectorCounts[price.selector] = 0;
                    }
                    selectorCounts[price.selector]++;
                });
            });
            analysis.priceSelectors = selectorCounts;
            
            // 分析分頁結構
            const paginationSelectors = [
                '.pagination',
                '.rt-pagination',
                '[class*="pagination"]',
                '.page-nav',
                '.pager',
                'a[href*="p="]',
                '.next',
                '.rt-next',
                '[class*="next"]'
            ];
            
            paginationSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    analysis.paginationInfo[selector] = {
                        count: elements.length,
                        samples: Array.from(elements).slice(0, 3).map(el => ({
                            text: el.textContent.trim(),
                            href: el.href || '',
                            classes: el.className,
                            outerHTML: el.outerHTML.slice(0, 200)
                        }))
                    };
                }
            });
            
            return analysis;
        });

        console.log('\n📋 價格分析結果:');
        console.log(`總商品連結數: ${priceAnalysis.totalLinks}`);
        
        console.log('\n💰 價格選擇器效果統計:');
        Object.entries(priceAnalysis.priceSelectors).forEach(([selector, count]) => {
            console.log(`${selector}: ${count} 次成功`);
        });
        
        console.log('\n🛍️ 樣本商品詳細分析:');
        priceAnalysis.sampleProducts.forEach(product => {
            console.log(`\n商品 ${product.index + 1}:`);
            console.log(`ID: ${product.id}`);
            console.log(`連結: ${product.href}`);
            console.log(`文字: ${product.text}`);
            console.log(`找到價格: ${product.prices.length} 個`);
            product.prices.forEach((price, idx) => {
                console.log(`  價格${idx + 1}: NT$ ${price.value} (選擇器: ${price.selector})`);
                console.log(`  原始文字: "${price.text}"`);
            });
        });
        
        console.log('\n📄 分頁結構分析:');
        Object.entries(priceAnalysis.paginationInfo).forEach(([selector, info]) => {
            console.log(`${selector}: ${info.count} 個元素`);
            info.samples.forEach((sample, idx) => {
                console.log(`  樣本${idx + 1}: "${sample.text}" (${sample.href})`);
            });
        });
        
        // 檢查總商品數量指示
        const totalProductsInfo = await page.evaluate(() => {
            const possibleIndicators = [
                '[class*="total"]',
                '[class*="count"]',
                '[class*="result"]',
                '.rt-search-result',
                '.search-result',
                'span:contains("共")',
                'div:contains("共")'
            ];
            
            const results = [];
            possibleIndicators.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => {
                        const text = el.textContent;
                        if (text && (text.includes('共') || text.match(/\d+/))) {
                            results.push({
                                selector: selector,
                                text: text.trim(),
                                element: el.outerHTML.slice(0, 200)
                            });
                        }
                    });
                } catch (e) {
                    // 忽略錯誤
                }
            });
            return results;
        });
        
        console.log('\n📊 商品總數指示器:');
        totalProductsInfo.forEach((info, idx) => {
            console.log(`${idx + 1}. "${info.text}" (選擇器: ${info.selector})`);
        });
        
        // 保持瀏覽器開啟15秒以便觀察
        console.log('\n⏰ 保持瀏覽器開啟15秒以便觀察...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
    } catch (error) {
        console.error('調試過程中發生錯誤:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🏁 詳細調試完成');
    }
}

// 執行調試
debugRutenDetailed();
