// 調試價格獲取策略
const puppeteer = require('puppeteer');

async function debugPriceStrategy() {
    let browser = null;
    
    try {
        console.log('🔍 調試價格獲取策略...');
        
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
        
        // 訪問商品列表頁面
        const listUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 訪問商品列表: ${listUrl}`);
        
        await page.goto(listUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        // 從列表頁面獲取第一個商品的連結
        const firstProductInfo = await page.evaluate(() => {
            const productLinks = document.querySelectorAll('a[href*="/item/"]');
            if (productLinks.length > 0) {
                const firstLink = productLinks[0];
                const href = firstLink.href;
                const match = href.match(/[?&](\d+)/);
                return {
                    url: href,
                    id: match ? match[1] : '',
                    text: firstLink.textContent.trim()
                };
            }
            return null;
        });

        if (!firstProductInfo) {
            console.log('❌ 找不到商品連結');
            return;
        }

        console.log(`🔍 找到第一個商品: ${firstProductInfo.id}`);
        console.log(`📄 商品連結: ${firstProductInfo.url}`);
        console.log(`📝 商品標題: ${firstProductInfo.text}`);

        // 訪問商品詳細頁面
        console.log('\n🔍 訪問商品詳細頁面...');
        await page.goto(firstProductInfo.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        // 從商品詳細頁面獲取價格
        const productDetailInfo = await page.evaluate(() => {
            const info = {
                title: document.title,
                url: window.location.href,
                prices: [],
                allPriceTexts: []
            };
            
            // 尋找所有可能的價格元素
            const priceSelectors = [
                '.item-price',
                '.rt-item-price', 
                '.price',
                '.money',
                '[data-price]',
                '.cost',
                '.amount',
                '.dollar',
                '[id*="price"]',
                '[class*="price"]',
                'span:contains("$")',
                'div:contains("$")',
                'span:contains("NT")',
                'div:contains("NT")'
            ];
            
            priceSelectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text && text.match(/[\d,]+/) && parseInt(text.replace(/[^\d]/g, '')) > 0) {
                            info.prices.push({
                                selector: selector,
                                text: text,
                                value: parseInt(text.replace(/[^\d]/g, '')),
                                innerHTML: el.innerHTML.slice(0, 100),
                                className: el.className
                            });
                        }
                    });
                } catch (e) {
                    // 忽略錯誤
                }
            });
            
            // 搜尋頁面中所有包含價格的文字
            const bodyText = document.body.textContent;
            const priceMatches = bodyText.match(/NT\$?\s*[\d,]+|[\d,]+\s*元|\$\s*[\d,]+/gi) || [];
            info.allPriceTexts = priceMatches.slice(0, 20); // 只取前20個
            
            // 特別檢查商品資訊區域
            const productInfo = document.querySelector('.item-info, .product-info, .rt-item-info, [class*="item-info"], [class*="product-info"]');
            if (productInfo) {
                info.productInfoText = productInfo.textContent.slice(0, 500);
            }
            
            return info;
        });

        console.log('\n💰 商品詳細頁面價格分析:');
        console.log(`標題: ${productDetailInfo.title}`);
        console.log(`找到的價格元素: ${productDetailInfo.prices.length} 個`);
        
        if (productDetailInfo.prices.length > 0) {
            console.log('\n🎯 找到的價格元素:');
            productDetailInfo.prices.forEach((price, idx) => {
                console.log(`${idx + 1}. NT$ ${price.value.toLocaleString()} (選擇器: ${price.selector})`);
                console.log(`   文字: "${price.text}"`);
                console.log(`   類名: ${price.className}`);
                console.log('');
            });
        }
        
        console.log('\n🔍 頁面中所有價格文字:');
        productDetailInfo.allPriceTexts.forEach((text, idx) => {
            console.log(`${idx + 1}. "${text}"`);
        });
        
        if (productDetailInfo.productInfoText) {
            console.log('\n📋 商品資訊區域文字:');
            console.log(productDetailInfo.productInfoText);
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
        console.log('🏁 價格策略調試完成');
    }
}

// 執行調試
debugPriceStrategy();
