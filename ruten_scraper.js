// 露天市集爬蟲邏輯
const puppeteer = require('puppeteer');
const { 
    initializeDatabase, 
    compareAndUpdateProducts, 
    upsertProducts,
    getActiveProducts, 
    getProductStats,
    addUpdateLogToDB 
} = require('./database');

// 露天市集商品抓取
async function fetchRutenProducts(storeUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/') {
    let allProducts = [];
    let browser = null;

    try {
        console.log('🔄 開始抓取露天市集商品...');
        console.log(`📍 目標賣場: ${storeUrl}`);

        // 啟動瀏覽器
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--max-old-space-size=2048'
            ],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // 設定用戶代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // 攔截不必要的資源
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'stylesheet' || resourceType === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        let currentPage = 1;
        let hasMorePages = true;
        const maxPages = parseInt(process.env.MAX_PAGES) || 50;

        while (hasMorePages && currentPage <= maxPages) {
            console.log(`📄 正在載入第 ${currentPage} 頁...`);
            
            // 構建分頁URL
            const pageUrl = currentPage === 1 ? storeUrl : `${storeUrl}?p=${currentPage}`;
            
            try {
                await page.goto(pageUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });

                // 等待頁面載入
                await page.waitForTimeout(parseInt(process.env.PAGE_LOAD_WAIT) || 3000);

                // 滾動頁面觸發懶加載
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

                // 抓取商品資料
                const products = await page.evaluate(() => {
                    const productList = [];
                    
                    try {
                        // 露天市集商品選擇器（需要根據實際網頁結構調整）
                        const productElements = document.querySelectorAll('.rt-list-item, .item, .product-item, [data-item-id]');
                        
                        console.log(`找到 ${productElements.length} 個商品元素`);

                        productElements.forEach((element, index) => {
                            try {
                                // 商品ID - 多種可能的選擇器
                                let productId = '';
                                const idElement = element.querySelector('[data-item-id]') || 
                                                element.querySelector('[data-id]') ||
                                                element.querySelector('a[href*="/item/"]');
                                
                                if (idElement) {
                                    if (idElement.dataset.itemId) {
                                        productId = idElement.dataset.itemId;
                                    } else if (idElement.dataset.id) {
                                        productId = idElement.dataset.id;
                                    } else if (idElement.href) {
                                        const match = idElement.href.match(/item\/([^/?]+)/);
                                        if (match) productId = match[1];
                                    }
                                }

                                // 商品名稱
                                let productName = '';
                                const nameElement = element.querySelector('.rt-item-title, .item-title, .product-title, h3, h4, .title') ||
                                                  element.querySelector('a[title]');
                                
                                if (nameElement) {
                                    productName = nameElement.textContent?.trim() || nameElement.title?.trim() || '';
                                }

                                // 商品價格
                                let price = 0;
                                const priceElement = element.querySelector('.rt-item-price, .item-price, .product-price, .price');
                                if (priceElement) {
                                    const priceText = priceElement.textContent || '';
                                    const priceMatch = priceText.match(/[\d,]+/);
                                    if (priceMatch) {
                                        price = parseInt(priceMatch[0].replace(/,/g, ''));
                                    }
                                }

                                // 商品圖片
                                let imageUrl = '';
                                const imgElement = element.querySelector('img');
                                if (imgElement) {
                                    imageUrl = imgElement.src || imgElement.dataset.src || imgElement.dataset.original || '';
                                    // 處理相對路徑
                                    if (imageUrl && imageUrl.startsWith('/')) {
                                        imageUrl = 'https://www.ruten.com.tw' + imageUrl;
                                    }
                                }

                                // 商品連結
                                let productUrl = '';
                                const linkElement = element.querySelector('a[href*="/item/"]') || 
                                                  element.querySelector('a[href]');
                                if (linkElement) {
                                    productUrl = linkElement.href;
                                    // 處理相對路徑
                                    if (productUrl && productUrl.startsWith('/')) {
                                        productUrl = 'https://www.ruten.com.tw' + productUrl;
                                    }
                                }

                                // 驗證必要資料
                                if (productId && productName && productUrl) {
                                    productList.push({
                                        id: productId,
                                        name: productName,
                                        price: price,
                                        imageUrl: imageUrl,
                                        url: productUrl,
                                        scrapedAt: new Date()
                                    });
                                }

                            } catch (error) {
                                console.error(`處理第${index}個商品時發生錯誤:`, error);
                            }
                        });

                    } catch (error) {
                        console.error('抓取商品時發生錯誤:', error);
                    }

                    return productList;
                });

                const productsWithImages = products.filter(p => p.imageUrl).length;
                const imageSuccessRate = products.length > 0 ? ((productsWithImages / products.length) * 100).toFixed(1) : 0;
                console.log(`✅ 第 ${currentPage} 頁: ${products.length} 個商品, 圖片 ${productsWithImages}/${products.length} (${imageSuccessRate}%)`);

                allProducts.push(...products);

                // 每5頁存入資料庫（只插入/更新，不檢查下架）
                if (currentPage % 5 === 0 && allProducts.length > 0) {
                    try {
                        console.log(`💾 存入資料庫 (${allProducts.length} 個商品)...`);
                        await upsertProducts(allProducts, 'youmao');
                        await addUpdateLogToDB('info', `已處理前 ${currentPage} 頁，共 ${allProducts.length} 個友茂商品`);
                    } catch (dbError) {
                        console.error('資料庫存儲失敗:', dbError.message);
                    }
                }

                // 檢查是否有下一頁
                const hasNextPage = await page.evaluate(() => {
                    // 露天市集分頁檢查（需要根據實際網頁結構調整）
                    const nextButton = document.querySelector('.rt-pagination-next:not(.disabled), .pagination-next:not(.disabled), .next:not(.disabled)');
                    const currentPageIndicator = document.querySelector('.rt-pagination-current, .pagination-current, .current');
                    
                    return !!nextButton && !nextButton.classList.contains('disabled');
                });

                if (products.length === 0 || !hasNextPage) {
                    hasMorePages = false;
                    console.log(`📄 第 ${currentPage} 頁為最後一頁，停止抓取`);
                } else {
                    currentPage++;
                    await page.waitForTimeout(parseInt(process.env.SCRAPE_DELAY) || 1000);
                }

            } catch (pageError) {
                console.error(`抓取第 ${currentPage} 頁時發生錯誤:`, pageError.message);
                hasMorePages = false;
            }
        }

        // 最終存入資料庫
        if (allProducts.length > 0) {
            console.log(`💾 最終存入資料庫...`);
            const updateResult = await compareAndUpdateProducts(allProducts, 'youmao');
            
            await addUpdateLogToDB('success', 
                `友茂商品更新完成：新增 ${updateResult.newCount} 個，修改 ${updateResult.modifiedCount} 個，下架 ${updateResult.removedCount} 個`
            );
        }

        console.log(`🎉 露天市集抓取完成！總共成功抓取 ${allProducts.length} 個商品，共 ${currentPage - 1} 頁`);
        
        return {
            success: true,
            totalProducts: allProducts.length,
            totalPages: currentPage - 1,
            products: allProducts
        };

    } catch (error) {
        console.error('❌ 露天市集抓取失敗:', error.message);
        await addUpdateLogToDB('error', `友茂商品抓取失敗: ${error.message}`);
        
        return {
            success: false,
            error: error.message,
            totalProducts: allProducts.length
        };
        
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    fetchRutenProducts
};
