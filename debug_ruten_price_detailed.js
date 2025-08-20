// 詳細調試友茂價格HTML結構
const puppeteer = require('puppeteer');

async function debugRutenPriceStructure() {
    let browser = null;
    
    try {
        console.log('🔍 詳細調試友茂價格HTML結構...');
        
        browser = await puppeteer.launch({
            headless: false,
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
        console.log(`📍 訪問: ${url}`);
        
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('🔍 分析商品價格HTML結構...');
        
        const priceAnalysis = await page.evaluate(() => {
            const analysis = {
                productLinks: [],
                priceElements: []
            };
            
            // 獲取前3個商品連結
            const productLinks = document.querySelectorAll('a[href*="/item/"]');
            const firstThreeLinks = Array.from(productLinks).slice(0, 3);
            
            firstThreeLinks.forEach((linkElement, index) => {
                const productInfo = {
                    index: index,
                    href: linkElement.href,
                    text: linkElement.textContent.trim().slice(0, 100),
                    parentHTML: '',
                    priceAnalysis: {}
                };
                
                // 獲取商品ID
                const match = linkElement.href.match(/[?&](\d+)/);
                if (match) {
                    productInfo.id = match[1];
                }
                
                // 找到父元素
                const parentElement = linkElement.closest('[class*="item"], [class*="product"], .rt-product-card') || linkElement.parentElement;
                if (parentElement) {
                    productInfo.parentHTML = parentElement.outerHTML.slice(0, 2000);
                    
                    // 測試所有可能的價格選擇器
                    const priceSelectors = [
                        '.rt-text-xx-large.rt-text-important',
                        'strong.rt-text-xx-large.rt-text-important',
                        '.rt-text-important',
                        '.rt-text-xx-large',
                        '.text-price-dollar',
                        '.rt-text-price',
                        '[class*="price"]',
                        'strong',
                        'span',
                        'div'
                    ];
                    
                    priceSelectors.forEach(selector => {
                        try {
                            const elements = parentElement.querySelectorAll(selector);
                            const results = [];
                            
                            elements.forEach(el => {
                                const text = el.textContent.trim();
                                if (text && text.match(/[\d,]+/) && parseInt(text.replace(/[^\d]/g, '')) > 0) {
                                    results.push({
                                        text: text,
                                        innerHTML: el.innerHTML,
                                        className: el.className,
                                        tagName: el.tagName,
                                        value: parseInt(text.replace(/[^\d]/g, ''))
                                    });
                                }
                            });
                            
                            if (results.length > 0) {
                                productInfo.priceAnalysis[selector] = results;
                            }
                        } catch (e) {
                            // 忽略錯誤
                        }
                    });
                }
                
                analysis.productLinks.push(productInfo);
            });
            
            // 全局搜索所有包含價格格式的元素
            const allPriceElements = document.querySelectorAll('*');
            const pricePattern = /\$[\d,]+|\d+[,\d]*元/;
            
            Array.from(allPriceElements).forEach(el => {
                const text = el.textContent;
                if (text && pricePattern.test(text) && text.length < 50) {
                    analysis.priceElements.push({
                        text: text.trim(),
                        className: el.className,
                        tagName: el.tagName,
                        innerHTML: el.innerHTML.slice(0, 200)
                    });
                }
            });
            
            // 限制結果數量
            analysis.priceElements = analysis.priceElements.slice(0, 20);
            
            return analysis;
        });

        console.log('\n📋 商品價格分析結果:');
        
        priceAnalysis.productLinks.forEach(product => {
            console.log(`\n商品 ${product.index + 1}:`);
            console.log(`ID: ${product.id}`);
            console.log(`連結: ${product.href}`);
            console.log(`標題: ${product.text}`);
            
            const priceCount = Object.keys(product.priceAnalysis).length;
            console.log(`找到價格選擇器: ${priceCount} 個`);
            
            if (priceCount > 0) {
                Object.entries(product.priceAnalysis).forEach(([selector, results]) => {
                    console.log(`  ${selector}:`);
                    results.forEach(result => {
                        console.log(`    💰 ${result.text} (NT$ ${result.value})`);
                        console.log(`       標籤: ${result.tagName}, 類名: ${result.className}`);
                    });
                });
            } else {
                console.log('  ❌ 沒有找到價格信息');
                console.log(`  HTML預覽: ${product.parentHTML.slice(0, 300)}...`);
            }
        });
        
        console.log('\n🔍 全域價格元素:');
        priceAnalysis.priceElements.forEach((el, index) => {
            console.log(`${index + 1}. "${el.text}" (${el.tagName}.${el.className})`);
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
        console.log('🏁 友茂價格HTML結構調試完成');
    }
}

// 執行調試
debugRutenPriceStructure();
