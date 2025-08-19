// 簡化的資料庫整合爬蟲
const puppeteer = require('puppeteer');
const { 
    initializeDatabase, 
    compareAndUpdateProducts, 
    getActiveProducts, 
    getProductStats,
    addUpdateLogToDB 
} = require('./database');

// 原始順序抓取 + 資料庫存儲
async function fetchYahooAuctionProductsWithDB() {
    let allProducts = [];
    let browser = null;
    const maxPages = 10; // 先測試10頁

    try {
        console.log('🔄 使用原始順序抓取邏輯 + 資料庫存儲...');
        
        // 初始化資料庫
        await initializeDatabase();
        await addUpdateLogToDB('info', '開始商品抓取，使用原始順序邏輯確保100%圖片成功率');
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--single-process'
            ],
            timeout: 60000
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= maxPages) {
            console.log(`📄 正在載入第 ${currentPage} 頁...`);
            
            const pageUrl = currentPage === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${currentPage}&mode=list`;
            
            await page.goto(pageUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // 原始版本：等待5秒確保圖片載入
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // 原始版本：簡單滾動邏輯
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

            // 抓取商品
            const products = await page.evaluate(() => {
                const productList = [];
                
                // JSON解析
                try {
                    const scriptElement = document.getElementById('isoredux-data');
                    if (scriptElement) {
                        const jsonData = JSON.parse(scriptElement.textContent);
                        const possiblePaths = ['items', 'booth.items', 'data.items', 'listings', 'booth.listings'];
                        
                        for (const path of possiblePaths) {
                            const pathParts = path.split('.');
                            let currentData = jsonData;
                            
                            for (const part of pathParts) {
                                if (currentData && currentData[part]) {
                                    currentData = currentData[part];
                                } else {
                                    currentData = null;
                                    break;
                                }
                            }
                            
                            if (currentData && Array.isArray(currentData)) {
                                currentData.forEach(item => {
                                    if (item.id && item.title) {
                                        let price = parseInt(item.price) || 0;
                                        if (price === 0 && item.title) {
                                            const dollarMatch = item.title.match(/\$([0-9,]+)/);
                                            if (dollarMatch) {
                                                price = parseInt(dollarMatch[1].replace(/,/g, '')) || 0;
                                            }
                                        }
                                        
                                        // 原始版本圖片邏輯
                                        let imageUrl = '';
                                        if (item.images && item.images.length > 0) {
                                            for (const image of item.images) {
                                                if (image.url && !image.url.includes('item-no-image.svg')) {
                                                    imageUrl = image.url;
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        productList.push({
                                            id: item.id,
                                            name: item.title,
                                            price: price,
                                            imageUrl: imageUrl,
                                            url: `https://tw.bid.yahoo.com/item/${item.id}`,
                                            scrapedAt: new Date().toISOString()
                                        });
                                    }
                                });
                                if (productList.length > 0) break;
                            }
                        }
                    }
                } catch (e) {
                    console.error('JSON解析失敗:', e);
                }
                
                // DOM解析備用
                if (productList.length === 0) {
                    const itemLinks = document.querySelectorAll('a[href*="item/"]');
                    itemLinks.forEach((linkElement) => {
                        try {
                            const href = linkElement.getAttribute('href');
                            const match = href.match(/item\/([^?]+)/);
                            if (!match) return;
                            
                            const id = match[1];
                            let name = linkElement.textContent.trim();
                            if (!name.trim()) return;
                            
                            let price = 0;
                            const priceMatch = name.match(/\$\s?([\d,]+)/);
                            if (priceMatch) {
                                price = parseInt(priceMatch[1].replace(/,/g, ''));
                            }
                            
                            let imageUrl = '';
                            const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                            if (parentElement) {
                                const imageElement = parentElement.querySelector('img');
                                if (imageElement) {
                                    imageUrl = imageElement.src || 
                                              imageElement.getAttribute('data-src') ||
                                              imageElement.getAttribute('data-original') || '';
                                }
                            }
                            
                            productList.push({
                                id: id,
                                name: name,
                                price: price,
                                imageUrl: imageUrl,
                                url: href.startsWith('http') ? href : `https://tw.bid.yahoo.com${href}`,
                                scrapedAt: new Date().toISOString()
                            });
                        } catch (error) {}
                    });
                }
                
                return productList;
            });

            const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const imageSuccessRate = products.length > 0 ? ((productsWithImages / products.length) * 100).toFixed(1) : 0;
            console.log(`✅ 第 ${currentPage} 頁: ${products.length} 個商品, 圖片 ${productsWithImages}/${products.length} (${imageSuccessRate}%)`);
            
            allProducts.push(...products);
            
            // 每5頁存入資料庫
            if (currentPage % 5 === 0 && allProducts.length > 0) {
                try {
                    console.log(`💾 存入資料庫 (${allProducts.length} 個商品)...`);
                    await compareAndUpdateProducts(allProducts);
                    await addUpdateLogToDB('info', `已處理前 ${currentPage} 頁，共 ${allProducts.length} 個商品`);
                } catch (dbError) {
                    console.error('資料庫存儲失敗:', dbError.message);
                }
            }
            
            if (products.length === 0) {
                hasMorePages = false;
            } else {
                currentPage++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // 最終存入資料庫
        if (allProducts.length > 0) {
            console.log(`💾 最終存入資料庫...`);
            const updateResult = await compareAndUpdateProducts(allProducts);
            
            const totalWithImages = allProducts.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const overallSuccessRate = allProducts.length > 0 ? ((totalWithImages / allProducts.length) * 100).toFixed(1) : 0;
            
            await addUpdateLogToDB('success', `順序抓取完成：共 ${allProducts.length} 個商品 | 圖片：${totalWithImages}/${allProducts.length} (${overallSuccessRate}%)`, {
                updateResult,
                imageStats: {
                    total: allProducts.length,
                    withImages: totalWithImages,
                    withoutImages: allProducts.length - totalWithImages,
                    successRate: `${overallSuccessRate}%`
                }
            });
            
            console.log(`🎉 資料庫更新完成: 新增 ${updateResult.newCount}, 修改 ${updateResult.modifiedCount}, 下架 ${updateResult.removedCount}`);
            
            // 顯示資料庫統計
            const stats = await getProductStats();
            console.log(`📊 資料庫統計: 總計 ${stats.total} 個商品, 圖片成功率 ${stats.imageSuccessRate}`);
        }
        
        return allProducts;

    } catch (error) {
        console.error('❌ 抓取失敗:', error.message);
        await addUpdateLogToDB('error', `抓取失敗: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { fetchYahooAuctionProductsWithDB };
