// 調試當前商品的實際價格
const puppeteer = require('puppeteer');

async function debugCurrentProductPrice() {
    let browser = null;
    
    try {
        console.log('🔍 調試當前商品的實際價格...');
        
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
        
        // 訪問一個有明確價格的商品
        // 讓我們嘗試不同的商品
        const testUrls = [
            'https://www.ruten.com.tw/item/show?21628103440809', // 第二個商品
            'https://www.ruten.com.tw/item/show?21305238104043', // 第三個商品
            'https://www.ruten.com.tw/item/show?21628089049784'  // 第四個商品
        ];

        for (let i = 0; i < testUrls.length; i++) {
            const url = testUrls[i];
            console.log(`\n🔍 測試商品 ${i + 1}: ${url}`);
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });

            await new Promise(resolve => setTimeout(resolve, 5000));

            // 專門尋找當前商品的價格
            const currentProductPrice = await page.evaluate(() => {
                const info = {
                    title: document.title,
                    url: window.location.href,
                    currentPrice: null,
                    priceInfo: {}
                };
                
                // 尋找主要商品價格區域
                const mainPriceSelectors = [
                    '.item-price',
                    '.rt-item-price',
                    '.main-price',
                    '.current-price',
                    '.product-price',
                    '#price',
                    '[data-current-price]',
                    '.price-current'
                ];
                
                // 尋找商品詳情區域中的價格
                const productDetailArea = document.querySelector('.item-detail, .product-detail, .item-info, .product-info, .rt-item-detail, .main-content');
                
                if (productDetailArea) {
                    // 在商品詳情區域中尋找價格
                    const priceElements = productDetailArea.querySelectorAll('[class*="price"], .money, [class*="cost"], [class*="amount"], [data-price]');
                    
                    priceElements.forEach((el, idx) => {
                        const text = el.textContent.trim();
                        const priceMatch = text.match(/[\d,]+/);
                        if (priceMatch) {
                            const value = parseInt(priceMatch[0].replace(/,/g, ''));
                            if (value > 0) {
                                info.priceInfo[`detail_price_${idx}`] = {
                                    text: text,
                                    value: value,
                                    selector: el.className || el.tagName,
                                    position: 'product-detail-area'
                                };
                            }
                        }
                    });
                }
                
                // 檢查是否是「面議」、「來電詢價」等特殊情況
                const bodyText = document.body.textContent;
                const specialPriceKeywords = ['面議', '來電詢價', '電洽', '詢價', '面洽', 'Contact for Price', 'Call for Price'];
                const hasSpecialPrice = specialPriceKeywords.some(keyword => bodyText.includes(keyword));
                
                info.hasSpecialPrice = hasSpecialPrice;
                
                // 尋找購買按鈕附近的價格
                const buyButton = document.querySelector('.btn-buy, .buy-button, [class*="buy"], .purchase-btn, .add-to-cart');
                if (buyButton) {
                    const buyArea = buyButton.closest('.item-purchase, .purchase-area, .buy-area') || buyButton.parentElement;
                    if (buyArea) {
                        const nearbyPrices = buyArea.querySelectorAll('[class*="price"], .money, [data-price]');
                        nearbyPrices.forEach((el, idx) => {
                            const text = el.textContent.trim();
                            const priceMatch = text.match(/[\d,]+/);
                            if (priceMatch) {
                                const value = parseInt(priceMatch[0].replace(/,/g, ''));
                                if (value > 0) {
                                    info.priceInfo[`buy_area_price_${idx}`] = {
                                        text: text,
                                        value: value,
                                        selector: el.className || el.tagName,
                                        position: 'near-buy-button'
                                    };
                                }
                            }
                        });
                    }
                }
                
                // 檢查頁面標題中是否有價格信息
                const titlePriceMatch = info.title.match(/NT\$?\s*[\d,]+|[\d,]+\s*元/);
                if (titlePriceMatch) {
                    const value = parseInt(titlePriceMatch[0].replace(/[^\d]/g, ''));
                    if (value > 0) {
                        info.priceInfo.title_price = {
                            text: titlePriceMatch[0],
                            value: value,
                            position: 'page-title'
                        };
                    }
                }
                
                // 選擇最可能的當前商品價格
                const prices = Object.values(info.priceInfo);
                if (prices.length > 0) {
                    // 優先選擇購買區域的價格，然後是商品詳情區域的價格
                    const buyAreaPrices = prices.filter(p => p.position === 'near-buy-button');
                    const detailAreaPrices = prices.filter(p => p.position === 'product-detail-area');
                    
                    if (buyAreaPrices.length > 0) {
                        info.currentPrice = buyAreaPrices[0];
                    } else if (detailAreaPrices.length > 0) {
                        info.currentPrice = detailAreaPrices[0];
                    } else {
                        info.currentPrice = prices[0];
                    }
                }
                
                return info;
            });

            console.log(`標題: ${currentProductPrice.title}`);
            console.log(`特殊價格情況: ${currentProductPrice.hasSpecialPrice ? '是（面議/詢價）' : '否'}`);
            console.log(`找到的價格信息: ${Object.keys(currentProductPrice.priceInfo).length} 個`);
            
            if (currentProductPrice.currentPrice) {
                console.log(`✅ 推薦的當前商品價格: NT$ ${currentProductPrice.currentPrice.value.toLocaleString()}`);
                console.log(`   來源: ${currentProductPrice.currentPrice.position}`);
                console.log(`   原始文字: "${currentProductPrice.currentPrice.text}"`);
            } else {
                console.log('❌ 未找到明確的商品價格');
            }
            
            console.log('\n📋 所有找到的價格信息:');
            Object.entries(currentProductPrice.priceInfo).forEach(([key, price]) => {
                console.log(`  ${key}: NT$ ${price.value.toLocaleString()} (${price.position}) - "${price.text}"`);
            });
            
            // 如果找到價格就停止測試
            if (currentProductPrice.currentPrice) {
                break;
            }
        }
        
        // 保持瀏覽器開啟10秒以便觀察
        console.log('\n⏰ 保持瀏覽器開啟10秒以便觀察...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
    } catch (error) {
        console.error('調試過程中發生錯誤:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🏁 當前商品價格調試完成');
    }
}

// 執行調試
debugCurrentProductPrice();
