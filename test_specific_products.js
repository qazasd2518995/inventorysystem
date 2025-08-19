const puppeteer = require('puppeteer');

// 測試特定商品的圖片抓取
async function testSpecificProducts() {
    const targetProducts = [
        '101570675266', '101570183453', '101569961969', '101569959822', 
        '101568226086', '101561613244', '101561608778', '101559618126',
        '101557905375', '101557904893', '101553871162'
    ];
    
    let browser = null;
    
    try {
        console.log('🚀 開始測試特定商品的圖片抓取...');
        console.log(`目標商品: ${targetProducts.join(', ')}`);
        
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        
        // 禁用字體和樣式載入以加速，但保留圖片
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'font' || resourceType === 'stylesheet') {
                req.abort();
            } else {
                req.continue();
            }
        });

        let foundProducts = [];
        
        // 搜索多個頁面來找到這些商品
        for (let pageNum = 1; pageNum <= 10; pageNum++) {
            console.log(`\n📄 搜索第 ${pageNum} 頁...`);
            
            const pageUrl = pageNum === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${pageNum}&mode=list`;
            
            try {
                await page.goto(pageUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 30000 
                });

                // 滾動頁面觸發懶載入圖片
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

                await new Promise(resolve => setTimeout(resolve, 3000));

                // 檢查這一頁的商品
                const pageProducts = await page.evaluate((targetIds) => {
                    const foundItems = [];
                    const itemLinks = document.querySelectorAll('a[href*="item/"]');
                    
                    itemLinks.forEach((linkElement, index) => {
                        try {
                            const href = linkElement.getAttribute('href');
                            const match = href.match(/item\/([^?]+)/);
                            if (!match) return;
                            
                            const id = match[1];
                            
                            // 只處理目標商品
                            if (!targetIds.includes(id)) return;
                            
                            let name = linkElement.textContent.trim();
                            if (!name) {
                                name = linkElement.getAttribute('title') || '';
                            }
                            if (!name.trim()) return;

                            // 使用完整的圖片抓取邏輯
                            let imageUrl = '';
                            let debugInfo = [];
                            const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                            
                            if (parentElement) {
                                // 記錄父元素資訊
                                debugInfo.push({
                                    step: 'parent-info',
                                    tagName: parentElement.tagName,
                                    className: parentElement.className,
                                    childrenCount: parentElement.children.length
                                });
                                
                                // 嘗試多種圖片選擇器
                                const imgSelectors = [
                                    'img[src*="yahoo"]',
                                    'img[src*="yimg"]', 
                                    'img[data-src*="yahoo"]',
                                    'img[data-src*="yimg"]',
                                    'img[data-lazy-src*="yahoo"]',
                                    'img[data-lazy-src*="yimg"]',
                                    'img[src*="s.yimg.com"]',
                                    'img[data-src*="s.yimg.com"]',
                                    'img[src]:not([src*="loading"]):not([src*="placeholder"]):not([src*="item-no-image"])',
                                    'img[data-src]:not([data-src*="loading"]):not([data-src*="placeholder"])',
                                    'img'
                                ];
                                
                                for (const selector of imgSelectors) {
                                    const imgElements = parentElement.querySelectorAll(selector);
                                    debugInfo.push({
                                        step: 'selector-test',
                                        selector: selector,
                                        count: imgElements.length
                                    });
                                    
                                    if (imgElements.length > 0) {
                                        const imgElement = imgElements[0];
                                        let src = imgElement.getAttribute('data-src') || 
                                                 imgElement.getAttribute('data-lazy-src') ||
                                                 imgElement.getAttribute('src') ||
                                                 imgElement.getAttribute('data-original') ||
                                                 imgElement.getAttribute('data-img');
                                        
                                        debugInfo.push({
                                            step: 'image-found',
                                            selector: selector,
                                            src: src,
                                            className: imgElement.className,
                                            alt: imgElement.alt
                                        });
                                        
                                        if (src && 
                                            !src.includes('item-no-image.svg') && 
                                            !src.includes('loading') &&
                                            !src.includes('placeholder') &&
                                            src.length > 10) {
                                            
                                            if (src.startsWith('//')) {
                                                src = 'https:' + src;
                                            } else if (src.startsWith('/')) {
                                                src = 'https://tw.bid.yahoo.com' + src;
                                            }
                                            
                                            imageUrl = src;
                                            debugInfo.push({
                                                step: 'success',
                                                finalUrl: imageUrl
                                            });
                                            break;
                                        }
                                    }
                                }
                                
                                // 如果還是沒找到，擴大搜索範圍
                                if (!imageUrl) {
                                    const expandedParent = parentElement.closest('div, li, tr, td, article, section') || 
                                                         parentElement.parentElement?.parentElement || 
                                                         parentElement;
                                    
                                    const allImages = expandedParent.querySelectorAll('img');
                                    debugInfo.push({
                                        step: 'expanded-search',
                                        totalImages: allImages.length
                                    });
                                    
                                    for (const img of allImages) {
                                        let src = img.getAttribute('data-src') || 
                                                 img.getAttribute('data-lazy-src') ||
                                                 img.getAttribute('src') ||
                                                 img.getAttribute('data-original');
                                        
                                        if (src && 
                                            (src.includes('yahoo') || src.includes('yimg') || src.includes('s.yimg.com')) && 
                                            !src.includes('loading') &&
                                            !src.includes('placeholder') &&
                                            !src.includes('item-no-image') &&
                                            src.length > 20) {
                                            
                                            if (src.startsWith('//')) {
                                                src = 'https:' + src;
                                            } else if (src.startsWith('/')) {
                                                src = 'https://tw.bid.yahoo.com' + src;
                                            }
                                            imageUrl = src;
                                            debugInfo.push({
                                                step: 'expanded-success',
                                                finalUrl: imageUrl
                                            });
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            foundItems.push({
                                id: id,
                                name: name.substring(0, 80),
                                imageUrl: imageUrl,
                                debugInfo: debugInfo
                            });
                            
                        } catch (error) {
                            // 忽略個別商品錯誤
                        }
                    });
                    
                    return foundItems;
                }, targetProducts);

                foundProducts = foundProducts.concat(pageProducts);
                
                if (pageProducts.length > 0) {
                    console.log(`✅ 第 ${pageNum} 頁找到 ${pageProducts.length} 個目標商品`);
                } else {
                    console.log(`❌ 第 ${pageNum} 頁未找到目標商品`);
                }
                
                // 如果已經找到所有目標商品，停止搜索
                const foundIds = foundProducts.map(p => p.id);
                const remainingIds = targetProducts.filter(id => !foundIds.includes(id));
                if (remainingIds.length === 0) {
                    console.log('🎉 所有目標商品都已找到！');
                    break;
                }
                
            } catch (pageError) {
                console.error(`第 ${pageNum} 頁載入失敗:`, pageError.message);
            }
        }

        console.log('\n📊 詳細測試結果:');
        console.log(`總共找到 ${foundProducts.length} 個目標商品`);
        
        let withImages = 0;
        let withoutImages = 0;
        
        foundProducts.forEach((product, index) => {
            const hasImage = !!product.imageUrl;
            if (hasImage) withImages++;
            else withoutImages++;
            
            console.log(`\n🔸 商品 ${index + 1} (ID: ${product.id}):`);
            console.log(`   名稱: ${product.name}...`);
            console.log(`   圖片: ${hasImage ? '✅ 有' : '❌ 無'}`);
            if (hasImage) {
                console.log(`   URL: ${product.imageUrl.substring(0, 80)}...`);
            }
            
            // 顯示調試資訊
            console.log(`   調試資訊:`);
            product.debugInfo.forEach((debug, i) => {
                if (debug.step === 'parent-info') {
                    console.log(`     父元素: ${debug.tagName}.${debug.className} (${debug.childrenCount}個子元素)`);
                } else if (debug.step === 'selector-test' && debug.count > 0) {
                    console.log(`     選擇器 ${debug.selector}: 找到${debug.count}個圖片`);
                } else if (debug.step === 'image-found') {
                    console.log(`     圖片詳情: ${debug.src?.substring(0, 50)}... (${debug.className})`);
                } else if (debug.step === 'success') {
                    console.log(`     ✅ 成功: ${debug.finalUrl?.substring(0, 50)}...`);
                } else if (debug.step === 'expanded-search') {
                    console.log(`     擴大搜索: 總共${debug.totalImages}個圖片`);
                }
            });
        });
        
        console.log(`\n📈 統計結果:`);
        console.log(`✅ 有圖片: ${withImages} 個商品 (${Math.round(withImages/foundProducts.length*100)}%)`);
        console.log(`❌ 無圖片: ${withoutImages} 個商品 (${Math.round(withoutImages/foundProducts.length*100)}%)`);
        
        // 列出未找到的商品
        const foundIds = foundProducts.map(p => p.id);
        const notFound = targetProducts.filter(id => !foundIds.includes(id));
        if (notFound.length > 0) {
            console.log(`\n⚠️  未找到的商品: ${notFound.join(', ')}`);
        }

    } catch (error) {
        console.error('❌ 測試失敗:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 執行測試
testSpecificProducts();
