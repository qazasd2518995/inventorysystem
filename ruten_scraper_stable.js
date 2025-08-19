// 友茂（露天市集）商品爬蟲 - 穩定版本
const puppeteer = require('puppeteer');
const { upsertProducts, compareAndUpdateProducts } = require('./database');

async function fetchRutenProducts() {
    let browser = null;
    let scrapedProducts = [];
    
    try {
        console.log('🔄 開始抓取露天市集商品（穩定版）...');
        
        const storeUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 目標賣場: ${storeUrl}`);

        // 啟動瀏覽器 - 使用更保守的設定
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-images', // 不載入圖片以節省資源
                '--disable-javascript', // 禁用JavaScript以提高穩定性
                '--max-old-space-size=2048'
            ]
        });

        let currentPage = 1;
        const maxPages = parseInt(process.env.MAX_PAGES) || 45; // 預設45頁以抓取全部1306個商品
        let allProductLinks = [];

        // 第一階段：收集所有商品連結（保持不變）
        console.log('📋 第一階段：收集所有商品連結...');
        
        const listPage = await browser.newPage();
        await listPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        while (currentPage <= maxPages) {
            try {
                const pageUrl = currentPage === 1 ? storeUrl : `${storeUrl}?p=${currentPage}`;
                console.log(`📄 正在載入第 ${currentPage} 頁...`);
                
                await listPage.goto(pageUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });

                await new Promise(resolve => setTimeout(resolve, 3000));

                const pageProducts = await listPage.evaluate(() => {
                    const productLinks = [];
                    const processedIds = new Set();
                    
                    const linkElements = document.querySelectorAll('a[href*="/item/show?"]');
                    
                    linkElements.forEach(linkElement => {
                        const href = linkElement.href;
                        if (href && href.includes('/item/show?')) {
                            const match = href.match(/[?&](\d+)/);
                            if (match) {
                                const productId = match[1];
                                
                                if (processedIds.has(productId)) {
                                    return;
                                }
                                processedIds.add(productId);
                                
                                let imageUrl = '';
                                const productCard = linkElement.closest('.rt-product-card, [class*="product"], [class*="item"]') || linkElement.parentElement;
                                if (productCard) {
                                    const imgElement = productCard.querySelector('img');
                                    if (imgElement) {
                                        imageUrl = imgElement.src || imgElement.dataset.src || imgElement.dataset.original || '';
                                        if (imageUrl && imageUrl.startsWith('/')) {
                                            imageUrl = 'https://www.ruten.com.tw' + imageUrl;
                                        }
                                    }
                                }

                                if (productId) {
                                    productLinks.push({
                                        id: productId,
                                        url: href,
                                        imageUrl: imageUrl
                                    });
                                }
                            }
                        }
                    });
                    
                    return productLinks;
                });

                console.log(`✅ 第 ${currentPage} 頁: 收集到 ${pageProducts.length} 個商品連結`);
                allProductLinks = allProductLinks.concat(pageProducts);

                const hasNextPage = await listPage.evaluate(() => {
                    const nextButtons = document.querySelectorAll('a[title="下一頁"], .rt-pagination a');
                    let hasNext = false;
                    
                    nextButtons.forEach(button => {
                        if (button.textContent.includes('下一頁') || button.classList.contains('next')) {
                            if (!button.classList.contains('disabled')) {
                                hasNext = true;
                            }
                        }
                    });
                    
                    if (hasNext) return true;
                    
                    const paginationText = document.querySelector('.rt-pagination')?.textContent || '';
                    const pageMatch = paginationText.match(/第\s*(\d+)\s*\/\s*(\d+)\s*頁/);
                    if (pageMatch) {
                        const current = parseInt(pageMatch[1]);
                        const total = parseInt(pageMatch[2]);
                        return current < total;
                    }
                    
                    return false;
                });

                if (!hasNextPage || pageProducts.length === 0) {
                    console.log(`📄 第 ${currentPage} 頁為最後一頁，停止收集連結`);
                    break;
                }

                currentPage++;
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`第 ${currentPage} 頁收集連結時發生錯誤:`, error.message);
                break;
            }
        }

        await listPage.close();

        // 去重複
        const uniqueProductLinks = allProductLinks.reduce((unique, product) => {
            if (!unique.find(p => p.id === product.id)) {
                unique.push(product);
            }
            return unique;
        }, []);

        console.log(`📊 第一階段完成：總共收集到 ${uniqueProductLinks.length} 個獨特商品連結`);

        // 第二階段：批量處理商品詳細信息（新策略）
        console.log('💰 第二階段：批量獲取商品詳細信息...');
        
        const batchSize = 10; // 每批處理10個商品（為全量抓取優化）
        let processedCount = 0;
        const totalProducts = uniqueProductLinks.length;
        
        for (let i = 0; i < uniqueProductLinks.length; i += batchSize) {
            const batch = uniqueProductLinks.slice(i, i + batchSize);
            console.log(`\n🔄 處理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueProductLinks.length / batchSize)} (${batch.length} 個商品)`);
            
            // 為每個批次創建新的瀏覽器頁面
            const detailPage = await browser.newPage();
            await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            for (const productLink of batch) {
                try {
                    console.log(`🔍 處理商品 ${processedCount + 1}/${totalProducts}: ${productLink.id}`);
                    
                    // 訪問商品詳細頁面
                    await detailPage.goto(productLink.url, { 
                        waitUntil: 'domcontentloaded',
                        timeout: 20000 
                    });

                    // 較短的等待時間
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // 獲取商品詳細信息
                    const productDetails = await detailPage.evaluate(() => {
                        const details = { price: 0, name: '' };
                        
                        // 獲取商品名稱
                        const nameSelectors = [
                            '.item-title .rt-font-weight-semi-bold',
                            'h1.item-title',
                            '.item-title span',
                            'h1'
                        ];
                        
                        for (const selector of nameSelectors) {
                            const nameElement = document.querySelector(selector);
                            if (nameElement && nameElement.textContent && nameElement.textContent.trim()) {
                                details.name = nameElement.textContent.trim();
                                break;
                            }
                        }
                        
                        // 如果沒有找到名稱，使用頁面標題
                        if (!details.name) {
                            const title = document.title || '';
                            if (title && title.includes('|')) {
                                details.name = title.split('|')[0].trim();
                            }
                        }
                        
                        // 獲取價格
                        const priceSelectors = [
                            'strong.rt-text-xx-large.rt-text-important',
                            '.rt-text-xx-large.rt-text-important',
                            '.item-purchase-stack strong'
                        ];
                        
                        for (const selector of priceSelectors) {
                            const priceElement = document.querySelector(selector);
                            if (priceElement) {
                                const priceText = priceElement.textContent || '';
                                const priceMatch = priceText.match(/[\d,]+/);
                                if (priceMatch) {
                                    const parsedPrice = parseInt(priceMatch[0].replace(/,/g, ''));
                                    if (parsedPrice > 0) {
                                        details.price = parsedPrice;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        return details;
                    });

                    // 建立商品物件
                    const product = {
                        id: productLink.id,
                        name: productDetails.name || `商品 ${productLink.id}`,
                        price: productDetails.price,
                        imageUrl: productLink.imageUrl,
                        url: productLink.url,
                        store_type: 'youmao'
                    };

                    scrapedProducts.push(product);
                    
                    const priceDisplay = product.price > 0 ? `NT$ ${product.price.toLocaleString()}` : '無價格';
                    const nameDisplay = product.name && !product.name.startsWith('商品 ') ? '✅' : '❌';
                    console.log(`${nameDisplay} ${product.name.slice(0, 40)}... | ${priceDisplay}`);

                    processedCount++;

                } catch (error) {
                    console.error(`處理商品 ${productLink.id} 失敗:`, error.message);
                    
                    // 保存基本信息
                    const product = {
                        id: productLink.id,
                        name: `商品 ${productLink.id}`,
                        price: 0,
                        imageUrl: productLink.imageUrl,
                        url: productLink.url,
                        store_type: 'youmao'
                    };
                    scrapedProducts.push(product);
                    processedCount++;
                }
                
                // 商品間延遲
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 關閉批次頁面
            await detailPage.close();
            
            // 批次間延遲
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 顯示批次進度
            const withPrice = scrapedProducts.filter(p => p.price > 0).length;
            const withName = scrapedProducts.filter(p => p.name && !p.name.startsWith('商品 ')).length;
            const priceRate = ((withPrice / processedCount) * 100).toFixed(1);
            const nameRate = ((withName / processedCount) * 100).toFixed(1);
            console.log(`📊 批次完成 | 進度：${processedCount}/${totalProducts} | 價格成功率：${priceRate}% | 名稱成功率：${nameRate}%`);
            
            // 每100個商品進行一次中間保存
            if (processedCount > 0 && processedCount % 100 === 0) {
                console.log(`💾 中間保存：已處理 ${processedCount} 個商品，保存到資料庫...`);
                try {
                    await upsertProducts(scrapedProducts.slice(-100), 'youmao'); // 只保存最近100個
                    console.log(`✅ 中間保存成功`);
                } catch (error) {
                    console.error(`❌ 中間保存失敗:`, error.message);
                }
            }
        }

        // 最終統計
        const withPrice = scrapedProducts.filter(p => p.price > 0).length;
        const withoutPrice = scrapedProducts.filter(p => p.price === 0).length;
        const withName = scrapedProducts.filter(p => p.name && !p.name.startsWith('商品 ')).length;
        const withoutName = scrapedProducts.filter(p => !p.name || p.name.startsWith('商品 ')).length;
        
        const priceRate = scrapedProducts.length > 0 ? ((withPrice / scrapedProducts.length) * 100).toFixed(1) : 0;
        const nameRate = scrapedProducts.length > 0 ? ((withName / scrapedProducts.length) * 100).toFixed(1) : 0;
        
        console.log(`\n📊 最終統計：`);
        console.log(`   總商品數：${scrapedProducts.length}`);
        console.log(`   有價格：${withPrice} 個 (${priceRate}%)`);
        console.log(`   無價格：${withoutPrice} 個`);
        console.log(`   有名稱：${withName} 個 (${nameRate}%)`);
        console.log(`   無名稱：${withoutName} 個`);

        // 存入資料庫
        if (scrapedProducts.length > 0) {
            console.log('💾 存入資料庫...');
            await compareAndUpdateProducts(scrapedProducts, 'youmao');
        }

        return {
            success: true,
            totalProducts: scrapedProducts.length,
            withPrice: withPrice,
            withoutPrice: withoutPrice,
            priceSuccessRate: `${priceRate}%`,
            withName: withName,
            withoutName: withoutName,
            nameSuccessRate: `${nameRate}%`
        };

    } catch (error) {
        console.error('友茂商品抓取失敗:', error);
        return {
            success: false,
            error: error.message,
            totalProducts: scrapedProducts.length
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
