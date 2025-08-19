const puppeteer = require('puppeteer');

// 測試特定商品 101570675266 的抓取情況
async function testSingleProduct() {
    const targetProductId = '101570675266';
    let browser = null;
    
    try {
        console.log(`🚀 開始測試商品 ${targetProductId} 的抓取情況...`);
        console.log(`🔗 商品頁面: https://tw.bid.yahoo.com/item/${targetProductId}`);
        
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--memory-pressure-off'
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

        console.log('\n📄 步驟 1: 搜索商品列表頁面...');
        
        // 搜索前幾頁來找到這個商品
        let foundProduct = null;
        for (let pageNum = 1; pageNum <= 10; pageNum++) {
            console.log(`🔍 檢查第 ${pageNum} 頁...`);
            
            const pageUrl = pageNum === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${pageNum}&mode=list`;
            
            try {
                await page.goto(pageUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 30000 
                });

                // 使用我們最新的滾動邏輯
                console.log('📜 執行徹底滾動載入...');
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 50;
                        let scrollCount = 0;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            scrollCount++;

                            if(totalHeight >= scrollHeight || scrollCount > 200){
                                window.scrollTo(0, 0);
                                setTimeout(() => {
                                    window.scrollTo(0, document.body.scrollHeight);
                                    clearInterval(timer);
                                    resolve();
                                }, 500);
                            }
                        }, 50);
                    });
                });

                await new Promise(resolve => setTimeout(resolve, 4000));

                // 檢查是否找到目標商品
                const productInfo = await page.evaluate((targetId, currentPageNum) => {
                    const itemLinks = document.querySelectorAll('a[href*="item/"]');
                    
                    for (const linkElement of itemLinks) {
                        const href = linkElement.getAttribute('href');
                        if (href.includes(targetId)) {
                            const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                            
                            let name = linkElement.textContent.trim();
                            if (!name) {
                                name = linkElement.getAttribute('title') || '';
                            }
                            
                            // 使用最新的圖片抓取邏輯
                            let imageUrl = '';
                            let debugInfo = [];
                            
                            if (parentElement) {
                                const imgSelectors = [
                                    'img[src*="yahoo"]',
                                    'img[src*="yimg"]', 
                                    'img[src*="img.yec.tw"]',
                                    'img[data-src*="yahoo"]',
                                    'img[data-src*="yimg"]',
                                    'img[data-src*="img.yec.tw"]',
                                    'img[data-lazy-src*="yahoo"]',
                                    'img[data-lazy-src*="yimg"]',
                                    'img[data-lazy-src*="img.yec.tw"]',
                                    'img[src*="s.yimg.com"]',
                                    'img[data-src*="s.yimg.com"]',
                                    'img[data-original*="yahoo"]',
                                    'img[data-original*="yimg"]',
                                    'img[data-original*="img.yec.tw"]',
                                    'img[src]:not([src*="loading"]):not([src*="placeholder"]):not([src*="item-no-image"])',
                                    'img[data-src]:not([data-src*="loading"]):not([data-src*="placeholder"])',
                                    'img'
                                ];
                                
                                for (const selector of imgSelectors) {
                                    const imgElement = parentElement.querySelector(selector);
                                    if (imgElement) {
                                        let src = imgElement.getAttribute('data-src') || 
                                                 imgElement.getAttribute('data-lazy-src') ||
                                                 imgElement.getAttribute('data-original') ||
                                                 imgElement.getAttribute('data-img') ||
                                                 imgElement.getAttribute('data-lazy') ||
                                                 imgElement.getAttribute('data-image') ||
                                                 imgElement.getAttribute('src');
                                        
                                        debugInfo.push({
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
                                    debugInfo.push({ expandedSearch: true, totalImages: allImages.length });
                                    
                                    for (const img of allImages) {
                                        let src = img.getAttribute('data-src') || 
                                                 img.getAttribute('data-lazy-src') ||
                                                 img.getAttribute('src') ||
                                                 img.getAttribute('data-original');
                                                 
                                        if (src && 
                                            (src.includes('yahoo') || src.includes('yimg') || src.includes('s.yimg.com') || src.includes('img.yec.tw')) && 
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
                                            debugInfo.push({ expandedSuccess: true, finalUrl: imageUrl });
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            return {
                                found: true,
                                pageNumber: currentPageNum,
                                id: targetId,
                                name: name,
                                imageUrl: imageUrl,
                                debugInfo: debugInfo,
                                parentInfo: {
                                    tagName: parentElement?.tagName,
                                    className: parentElement?.className,
                                    childrenCount: parentElement?.children.length
                                }
                            };
                        }
                    }
                    
                    return { found: false };
                }, targetProductId, pageNum);

                if (productInfo.found) {
                    foundProduct = productInfo;
                    console.log(`✅ 在第 ${pageNum} 頁找到目標商品！`);
                    break;
                }
                
            } catch (pageError) {
                console.error(`❌ 第 ${pageNum} 頁載入失敗:`, pageError.message);
                continue;
            }
        }

        if (foundProduct) {
            console.log('\n🎉 商品抓取測試結果:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📦 商品ID: ${foundProduct.id}`);
            console.log(`📄 找到頁面: 第 ${foundProduct.pageNumber} 頁`);
            console.log(`🏷️  商品名稱: ${foundProduct.name}`);
            console.log(`🖼️  圖片狀態: ${foundProduct.imageUrl ? '✅ 有圖片' : '❌ 無圖片'}`);
            
            if (foundProduct.imageUrl) {
                console.log(`🔗 圖片URL: ${foundProduct.imageUrl}`);
                
                // 測試圖片URL是否可訪問
                try {
                    const imgResponse = await page.goto(foundProduct.imageUrl, { timeout: 10000 });
                    console.log(`✅ 圖片可訪問: HTTP ${imgResponse.status()}`);
                } catch (imgError) {
                    console.log(`❌ 圖片無法訪問: ${imgError.message}`);
                }
            }
            
            console.log('\n🔧 調試資訊:');
            console.log(`📍 父元素: ${foundProduct.parentInfo.tagName}.${foundProduct.parentInfo.className}`);
            console.log(`👶 子元素數: ${foundProduct.parentInfo.childrenCount}`);
            
            if (foundProduct.debugInfo.length > 0) {
                console.log('\n🔍 圖片搜索過程:');
                foundProduct.debugInfo.forEach((debug, i) => {
                    if (debug.selector) {
                        console.log(`  ${i + 1}. ${debug.selector}`);
                        console.log(`     → ${debug.src ? debug.src.substring(0, 60) + '...' : '無'}`);
                        if (debug.className) console.log(`     → 類名: ${debug.className}`);
                    } else if (debug.expandedSearch) {
                        console.log(`  擴大搜索: 找到 ${debug.totalImages} 個圖片`);
                    } else if (debug.expandedSuccess) {
                        console.log(`  ✅ 擴大搜索成功: ${debug.finalUrl.substring(0, 60)}...`);
                    }
                });
            }
            
        } else {
            console.log('\n❌ 商品抓取測試結果:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📦 商品ID: ${targetProductId}`);
            console.log(`🔍 搜索範圍: 前10頁`);
            console.log(`❌ 結果: 未找到該商品`);
            console.log('\n可能原因:');
            console.log('1. 商品可能在第6頁之後');
            console.log('2. 商品可能已下架');
            console.log('3. 網絡連接問題');
        }

    } catch (error) {
        console.error('❌ 測試過程發生錯誤:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 執行測試
testSingleProduct();
