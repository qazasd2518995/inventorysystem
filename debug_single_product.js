// 調試單個商品頁面的價格結構
const puppeteer = require('puppeteer');

async function debugSingleProduct() {
    let browser = null;
    
    try {
        console.log('🔍 調試單個商品頁面...');
        
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
        
        // 先訪問商品列表頁面
        const listUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 訪問商品列表: ${listUrl}`);
        
        await page.goto(listUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        // 分析列表頁面的商品結構
        const listAnalysis = await page.evaluate(() => {
            const products = [];
            const productLinks = document.querySelectorAll('a[href*="/item/"]');
            
            Array.from(productLinks).slice(0, 5).forEach((linkElement, index) => {
                const productInfo = {
                    index: index,
                    href: linkElement.href,
                    text: linkElement.textContent.trim(),
                    parentHTML: '',
                    allText: '',
                    priceTexts: []
                };
                
                // 獲取父元素的完整HTML
                const parentElement = linkElement.closest('div, li, article, section') || linkElement.parentElement;
                if (parentElement) {
                    productInfo.parentHTML = parentElement.outerHTML.slice(0, 1000);
                    productInfo.allText = parentElement.textContent.trim();
                    
                    // 尋找所有包含數字的文字
                    const textNodes = [];
                    const walker = document.createTreeWalker(
                        parentElement,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    
                    let node;
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        if (text && text.match(/[\d,]+/) && parseInt(text.replace(/[^\d]/g, '')) > 0) {
                            textNodes.push(text);
                        }
                    }
                    productInfo.priceTexts = textNodes;
                }
                
                products.push(productInfo);
            });
            
            return products;
        });

        console.log('\n📋 列表頁面商品分析:');
        listAnalysis.forEach(product => {
            console.log(`\n商品 ${product.index + 1}:`);
            console.log(`連結: ${product.href}`);
            console.log(`標題: ${product.text}`);
            console.log(`所有文字: ${product.allText.slice(0, 200)}...`);
            console.log(`價格相關文字: ${JSON.stringify(product.priceTexts)}`);
            console.log(`HTML結構: ${product.parentHTML.slice(0, 300)}...`);
        });

        // 訪問第一個商品的詳細頁面
        if (listAnalysis.length > 0) {
            const firstProductUrl = listAnalysis[0].href;
            console.log(`\n🔍 訪問商品詳細頁面: ${firstProductUrl}`);
            
            await page.goto(firstProductUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });

            await new Promise(resolve => setTimeout(resolve, 5000));

            const productPageAnalysis = await page.evaluate(() => {
                const analysis = {
                    title: document.title,
                    url: window.location.href,
                    priceElements: []
                };
                
                // 尋找價格相關元素
                const priceSelectors = [
                    '[class*="price"]',
                    '[data-price]',
                    '.money',
                    '[class*="cost"]',
                    '[class*="amount"]',
                    '[class*="dollar"]',
                    'span:contains("$")',
                    'div:contains("$")',
                    'span:contains("NT")',
                    'div:contains("NT")',
                    '[id*="price"]',
                    '.rt-price',
                    '.item-price',
                    '.product-price'
                ];
                
                priceSelectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            const text = el.textContent.trim();
                            if (text && text.match(/[\d,]+/)) {
                                analysis.priceElements.push({
                                    selector: selector,
                                    text: text,
                                    innerHTML: el.innerHTML,
                                    outerHTML: el.outerHTML.slice(0, 200),
                                    className: el.className,
                                    id: el.id
                                });
                            }
                        });
                    } catch (e) {
                        // 忽略錯誤
                    }
                });
                
                // 直接搜尋頁面中所有包含金額的文字
                const allText = document.body.textContent;
                const priceMatches = allText.match(/NT\$?\s*[\d,]+|[\d,]+\s*元/g) || [];
                analysis.foundPriceTexts = priceMatches.slice(0, 10); // 只取前10個
                
                return analysis;
            });

            console.log('\n💰 商品詳細頁面價格分析:');
            console.log(`標題: ${productPageAnalysis.title}`);
            console.log(`找到的價格元素: ${productPageAnalysis.priceElements.length} 個`);
            
            productPageAnalysis.priceElements.forEach((price, idx) => {
                console.log(`\n價格元素 ${idx + 1}:`);
                console.log(`選擇器: ${price.selector}`);
                console.log(`文字: "${price.text}"`);
                console.log(`類名: ${price.className}`);
                console.log(`ID: ${price.id}`);
                console.log(`HTML: ${price.outerHTML}`);
            });
            
            console.log('\n🔍 頁面中找到的價格文字:');
            productPageAnalysis.foundPriceTexts.forEach((text, idx) => {
                console.log(`${idx + 1}. "${text}"`);
            });
        }
        
        // 保持瀏覽器開啟20秒以便觀察
        console.log('\n⏰ 保持瀏覽器開啟20秒以便觀察...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
    } catch (error) {
        console.error('調試過程中發生錯誤:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🏁 單個商品調試完成');
    }
}

// 執行調試
debugSingleProduct();
