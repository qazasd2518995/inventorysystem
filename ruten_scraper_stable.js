// 友茂（露天市集）商品爬蟲 - 優化版本
const puppeteer = require('puppeteer');
const { upsertProducts, compareAndUpdateProducts } = require('./database');

async function fetchRutenProducts() {
    let browser = null;
    let allProducts = [];
    
    try {
        console.log('🚀 開始抓取露天市集商品（優化版）...');
        
        const storeUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 目標賣場: ${storeUrl}`);

        // 使用源正山風格的簡單瀏覽器設定
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'  // 源正山風格的單一進程
            ],
            timeout: 60000
        });

        // 單一頁面重用（源正山風格）
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        let currentPage = 1;
        const maxPages = parseInt(process.env.MAX_PAGES) || 50; // 預設50頁以確保抓取所有商品
        let hasMorePages = true;

        while (hasMorePages && currentPage <= maxPages) {
            console.log(`📄 正在載入第 ${currentPage} 頁...`);
            
            const pageUrl = currentPage === 1 
                ? storeUrl 
                : `${storeUrl}?p=${currentPage}`;
            
            const startTime = Date.now();
            
            await page.goto(pageUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // 源正山風格的固定等待時間
            const waitTime = process.env.NODE_ENV === 'production' ? 2500 : 3000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // 源正山風格的滾動
            await page.evaluate(() => {
                return new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        
                        if(totalHeight >= scrollHeight){
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            console.log(`🔍 正在抓取第 ${currentPage} 頁商品資料...`);

            // 直接在列表頁抓取所有資料（單階段處理）
            const products = await page.evaluate(() => {
                const productList = [];
                const processedIds = new Set();
                
                // 找出所有商品卡片容器
                const productCards = document.querySelectorAll('.rt-product-card, [class*="product-item"], [class*="item-container"], div[class*="col-"]');
                
                productCards.forEach(card => {
                    try {
                        // 找商品連結和ID
                        const linkElement = card.querySelector('a[href*="/item/show?"]');
                        if (!linkElement) return;
                        
                        const href = linkElement.href;
                        const match = href.match(/[?&](\d+)/);
                        if (!match) return;
                        
                        const productId = match[1];
                        
                        // 避免重複
                        if (processedIds.has(productId)) return;
                        processedIds.add(productId);
                        
                        // 取得商品名稱（多種策略）
                        let name = '';
                        
                        // 策略1: 直接找 rt-product-card-name 類別（露天的標準名稱類別）
                        const nameElement = card.querySelector('.rt-product-card-name, p.rt-product-card-name');
                        if (nameElement) {
                            name = nameElement.textContent.trim();
                        }
                        
                        // 策略2: 從商品標題元素取得
                        if (!name) {
                            const titleElement = card.querySelector('.rt-product-title, .product-title, h3, h4, .title');
                            if (titleElement) {
                                name = titleElement.textContent.trim();
                            }
                        }
                        
                        // 策略3: 從圖片的 title 或 alt 屬性取得（通常包含完整商品名）
                        if (!name) {
                            const imgElement = card.querySelector('img.rt-product-card-img, img');
                            if (imgElement) {
                                name = imgElement.getAttribute('title') || imgElement.getAttribute('alt') || '';
                            }
                        }
                        
                        // 策略4: 從連結的title屬性取得
                        if (!name) {
                            name = linkElement.getAttribute('title') || '';
                        }
                        
                        // 策略5: 從連結內的文字取得
                        if (!name) {
                            const linkText = linkElement.querySelector('.rt-text-wrap, span, div');
                            if (linkText) {
                                name = linkText.textContent.trim();
                            }
                        }
                        
                        // 取得價格（多種策略）
                        let price = 0;
                        
                        // 策略1: 直接找 rt-text-price 類別（露天的標準價格類別）
                        const priceElement = card.querySelector('.rt-text-price, .text-price-dollar');
                        if (priceElement) {
                            const priceText = priceElement.textContent || '';
                            // 直接解析數字（露天價格通常是純數字，如 "3,910"）
                            const priceMatch = priceText.match(/([0-9,]+)/);
                            if (priceMatch) {
                                price = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
                            }
                        }
                        
                        // 策略2: 如果沒找到，嘗試其他常見價格元素
                        if (price === 0) {
                            const priceSelectors = [
                                '.rt-product-price',
                                '.product-price',
                                '.price',
                                'span[class*="price"]',
                                'div[class*="price"]'
                            ];
                            
                            for (const selector of priceSelectors) {
                                const elem = card.querySelector(selector);
                                if (elem) {
                                    const text = elem.textContent || '';
                                    const priceMatch = text.match(/([0-9,]+)/);
                                    if (priceMatch) {
                                        const parsedPrice = parseInt(priceMatch[1].replace(/,/g, ''));
                                        if (parsedPrice > 0) {
                                            price = parsedPrice;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 策略3: 從整個卡片文字中尋找價格模式
                        if (price === 0) {
                            const cardText = card.textContent || '';
                            // 尋找獨立的價格數字（通常是3-6位數）
                            const priceMatch = cardText.match(/(?:NT\$?|NTD|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*)/);
                            if (priceMatch) {
                                price = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
                            }
                        }
                        
                        // 取得圖片URL（多種策略）
                        let imageUrl = '';
                        const imgElement = card.querySelector('img');
                        if (imgElement) {
                            // 優先使用src
                            imageUrl = imgElement.src || '';
                            
                            // 如果src是懶加載的placeholder，嘗試其他屬性
                            if (imageUrl.includes('placeholder') || imageUrl.includes('loading') || !imageUrl) {
                                imageUrl = imgElement.dataset.src || 
                                          imgElement.dataset.original || 
                                          imgElement.dataset.lazy ||
                                          imgElement.getAttribute('data-src') ||
                                          imgElement.getAttribute('data-original') || '';
                            }
                            
                            // 處理相對路徑
                            if (imageUrl && imageUrl.startsWith('/')) {
                                imageUrl = 'https://www.ruten.com.tw' + imageUrl;
                            }
                        }
                        
                        // 只有當有基本資訊時才加入商品
                        if (productId && (name || price > 0)) {
                            productList.push({
                                id: productId,
                                name: name || `商品 ${productId}`,
                                price: price,
                                imageUrl: imageUrl,
                                url: href,
                                store_type: 'youmao',
                                scrapedAt: new Date().toISOString()
                            });
                        }
                    } catch (error) {
                        // 忽略單個商品錯誤
                    }
                });
                
                // 如果卡片方式沒找到，嘗試直接找連結（備用方案）
                if (productList.length === 0) {
                    const linkElements = document.querySelectorAll('a[href*="/item/show?"]');
                    linkElements.forEach(linkElement => {
                        try {
                            const href = linkElement.href;
                            const match = href.match(/[?&](\d+)/);
                            if (!match) return;
                            
                            const productId = match[1];
                            if (processedIds.has(productId)) return;
                            processedIds.add(productId);
                            
                            // 從父元素找資訊
                            const parentElement = linkElement.closest('div, li, article') || linkElement.parentElement;
                            let name = linkElement.textContent.trim() || linkElement.getAttribute('title') || '';
                            let price = 0;
                            let imageUrl = '';
                            
                            if (parentElement) {
                                const priceText = parentElement.textContent || '';
                                const priceMatch = priceText.match(/NT?\$?\s*([0-9,]+)/);
                                if (priceMatch) {
                                    price = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
                                }
                                
                                const imgElement = parentElement.querySelector('img');
                                if (imgElement) {
                                    imageUrl = imgElement.src || imgElement.dataset.src || '';
                                }
                            }
                            
                            if (productId) {
                                productList.push({
                                    id: productId,
                                    name: name || `商品 ${productId}`,
                                    price: price,
                                    imageUrl: imageUrl,
                                    url: href,
                                    store_type: 'youmao',
                                    scrapedAt: new Date().toISOString()
                                });
                            }
                        } catch (error) {}
                    });
                }
                
                return productList;
            });

            const loadTime = Date.now() - startTime;
            const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const productsWithPrice = products.filter(p => p.price > 0).length;
            const imageSuccessRate = products.length > 0 ? ((productsWithImages / products.length) * 100).toFixed(1) : 0;
            const priceSuccessRate = products.length > 0 ? ((productsWithPrice / products.length) * 100).toFixed(1) : 0;
            
            console.log(`✅ 第 ${currentPage} 頁: ${products.length} 個商品 | 圖片: ${productsWithImages}/${products.length} (${imageSuccessRate}%) | 價格: ${productsWithPrice}/${products.length} (${priceSuccessRate}%) | 載入時間: ${loadTime}ms`);
            
            allProducts.push(...products);
            
            // 每10頁存入資料庫（源正山風格）
            if (currentPage % 10 === 0 && allProducts.length > 0) {
                try {
                    console.log(`💾 中間保存 (${allProducts.length} 個商品)...`);
                    await upsertProducts(allProducts, 'youmao');
                } catch (dbError) {
                    console.error('資料庫存儲失敗:', dbError.message);
                }
            }
            
            // 檢查是否為最後一頁
            // 友茂正常情況下每頁有30個商品，如果少於30個代表是最後一頁
            const isLastPage = products.length < 30 && products.length > 0;
            
            if (isLastPage) {
                console.log(`📄 第 ${currentPage} 頁為最後一頁（只有 ${products.length} 個商品）`);
                hasMorePages = false;
            } else if (products.length === 0) {
                console.log(`📄 第 ${currentPage} 頁沒有商品，停止抓取`);
                hasMorePages = false;
            } else {
                // 檢查是否有下一頁按鈕
                const hasNextPage = await page.evaluate(() => {
                    // 檢查下一頁按鈕
                    const nextButtons = document.querySelectorAll('a[title="下一頁"], .rt-pagination a');
                    for (const button of nextButtons) {
                        if (button.textContent.includes('下一頁') || button.classList.contains('next')) {
                            if (!button.classList.contains('disabled')) {
                                return true;
                            }
                        }
                    }
                    
                    // 檢查頁碼資訊
                    const paginationText = document.querySelector('.rt-pagination')?.textContent || '';
                    const pageMatch = paginationText.match(/第\s*(\d+)\s*\/\s*(\d+)\s*頁/);
                    if (pageMatch) {
                        const current = parseInt(pageMatch[1]);
                        const total = parseInt(pageMatch[2]);
                        return current < total;
                    }
                    
                    return false;
                });
                
                if (!hasNextPage) {
                    console.log(`📄 第 ${currentPage} 頁為最後一頁（無下一頁按鈕）`);
                    hasMorePages = false;
                } else {
                    currentPage++;
                    // 源正山風格的頁面間延遲
                    const pageDelay = process.env.NODE_ENV === 'production' ? 500 : 800;
                    await new Promise(resolve => setTimeout(resolve, pageDelay));
                }
            }
        }

        // 最終存入資料庫
        if (allProducts.length > 0) {
            console.log(`💾 最終存入資料庫...`);
            const updateResult = await compareAndUpdateProducts(allProducts, 'youmao');
            
            const totalWithImages = allProducts.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const totalWithPrice = allProducts.filter(p => p.price > 0).length;
            const overallImageRate = allProducts.length > 0 ? ((totalWithImages / allProducts.length) * 100).toFixed(1) : 0;
            const overallPriceRate = allProducts.length > 0 ? ((totalWithPrice / allProducts.length) * 100).toFixed(1) : 0;
            
            console.log(`\n📊 最終統計：`);
            console.log(`   總商品數：${allProducts.length}`);
            console.log(`   圖片成功：${totalWithImages}/${allProducts.length} (${overallImageRate}%)`);
            console.log(`   價格成功：${totalWithPrice}/${allProducts.length} (${overallPriceRate}%)`);
            console.log(`🎉 資料庫更新完成: 新增 ${updateResult.newCount}, 修改 ${updateResult.modifiedCount}, 下架 ${updateResult.removedCount}`);
        }
        
        return {
            success: true,
            totalProducts: allProducts.length,
            products: allProducts
        };

    } catch (error) {
        console.error('❌ 友茂商品抓取失敗:', error.message);
        
        // 即使失敗也嘗試保存已處理的商品
        if (allProducts.length > 0) {
            console.log(`⚠️ 抓取中斷，嘗試保存已處理的 ${allProducts.length} 個商品...`);
            try {
                await upsertProducts(allProducts, 'youmao');
                console.log(`✅ 已保存 ${allProducts.length} 個商品到資料庫`);
            } catch (saveError) {
                console.error('❌ 保存失敗:', saveError.message);
            }
        }
        
        return {
            success: false,
            error: error.message,
            totalProducts: allProducts.length
        };
        
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🎉 露天市集抓取完成！');
    }
}

module.exports = {
    fetchRutenProducts
};