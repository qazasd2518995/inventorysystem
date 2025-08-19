const puppeteer = require('puppeteer');

// 分析特定商品的圖片抓取差異
async function analyzeSpecificProducts() {
    const testProducts = [
        // 無法抓到圖片的商品
        { id: '101680278116', name: '象印手搖吊車', expected: false },
        { id: '101677371509', name: 'makita 6501 電鑽', expected: false },
        // 可以抓到圖片的商品
        { id: '101583740164', name: 'makita 5834BA 圓鋸機', expected: true },
        { id: '101583738318', name: 'BOSCH DMF10 探測器', expected: true }
    ];
    
    let browser = null;
    
    try {
        console.log('🔍 開始分析特定商品圖片抓取差異...\n');
        
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        // 搜索每個商品並分析其圖片情況
        for (const product of testProducts) {
            console.log(`\n🔍 分析商品 ${product.id} (${product.name})...`);
            console.log(`預期結果: ${product.expected ? '✅ 應該有圖片' : '❌ 預期無圖片'}`);
            
            const result = await findAndAnalyzeProduct(browser, product.id);
            
            if (result.found) {
                console.log(`✅ 找到商品 - 頁面: ${result.pageNumber}`);
                console.log(`🖼️  圖片狀態: ${result.hasImage ? '✅ 有圖片' : '❌ 無圖片'}`);
                
                if (result.hasImage) {
                    console.log(`🔗 圖片URL: ${result.imageUrl.substring(0, 80)}...`);
                    console.log(`🏷️  圖片域名: ${new URL(result.imageUrl).hostname}`);
                }
                
                console.log(`📄 HTML結構分析:`);
                console.log(`   • 父元素標籤: ${result.analysis.parentTag}`);
                console.log(`   • 父元素類名: ${result.analysis.parentClass}`);
                console.log(`   • 找到的圖片元素數: ${result.analysis.totalImages}`);
                console.log(`   • 有效圖片URL數: ${result.analysis.validImages}`);
                
                if (result.analysis.imageDetails.length > 0) {
                    console.log(`🔍 圖片詳細資訊:`);
                    result.analysis.imageDetails.forEach((img, i) => {
                        console.log(`   ${i + 1}. 標籤: ${img.tagInfo}`);
                        console.log(`      屬性: ${img.attributes}`);
                        console.log(`      URL: ${img.url ? img.url.substring(0, 60) + '...' : '無'}`);
                        console.log(`      有效: ${img.isValid ? '✅' : '❌'}`);
                    });
                }
                
                // 比較預期與實際結果
                const matches = (result.hasImage === product.expected);
                console.log(`\n📊 結果分析: ${matches ? '✅ 符合預期' : '❌ 不符預期'}`);
                
                if (!matches) {
                    console.log(`⚠️  預期: ${product.expected ? '有圖片' : '無圖片'}，實際: ${result.hasImage ? '有圖片' : '無圖片'}`);
                }
                
            } else {
                console.log(`❌ 未找到商品 ${product.id}`);
            }
            
            console.log('━'.repeat(80));
        }
        
        console.log('\n🎯 總結分析');
        console.log('━'.repeat(80));
        
        // 進行對比分析
        const successfulProducts = testProducts.filter(p => p.expected);
        const failedProducts = testProducts.filter(p => !p.expected);
        
        console.log(`✅ 成功商品特徵 (${successfulProducts.length}個):`);
        console.log(`   • 商品ID範圍: ${Math.min(...successfulProducts.map(p => parseInt(p.id)))} - ${Math.max(...successfulProducts.map(p => parseInt(p.id)))}`);
        
        console.log(`❌ 失敗商品特徵 (${failedProducts.length}個):`);
        console.log(`   • 商品ID範圍: ${Math.min(...failedProducts.map(p => parseInt(p.id)))} - ${Math.max(...failedProducts.map(p => parseInt(p.id)))}`);
        
        console.log('\n💡 可能的原因分析:');
        console.log('1. 商品ID較新的商品可能使用不同的HTML結構');
        console.log('2. 不同時期上架的商品可能使用不同的圖片載入方式');
        console.log('3. 商品所在頁面位置可能影響懶載入觸發');
        console.log('4. 不同類型商品可能有不同的圖片屬性命名');

    } catch (error) {
        console.error('❌ 分析過程發生錯誤:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function findAndAnalyzeProduct(browser, targetProductId) {
    // 搜索前10頁來找到目標商品
    for (let pageNum = 1; pageNum <= 10; pageNum++) {
        const page = await browser.newPage();
        
        try {
            // 禁用字體和樣式但保留圖片
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (resourceType === 'font' || resourceType === 'stylesheet') {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            const pageUrl = pageNum === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${pageNum}&mode=list`;

            await page.goto(pageUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // 執行滾動載入
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

            // 尋找並分析目標商品
            const productAnalysis = await page.evaluate((targetId) => {
                const itemLinks = document.querySelectorAll('a[href*="item/"]');
                
                for (const linkElement of itemLinks) {
                    const href = linkElement.getAttribute('href');
                    if (href.includes(targetId)) {
                        // 找到目標商品，進行詳細分析
                        const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                        
                        let productName = linkElement.textContent.trim();
                        let imageUrl = '';
                        let hasImage = false;
                        
                        const analysis = {
                            parentTag: parentElement?.tagName || 'unknown',
                            parentClass: parentElement?.className || '',
                            totalImages: 0,
                            validImages: 0,
                            imageDetails: []
                        };
                        
                        if (parentElement) {
                            // 收集所有圖片元素進行分析
                            const allImages = parentElement.querySelectorAll('img');
                            analysis.totalImages = allImages.length;
                            
                            allImages.forEach((img, index) => {
                                const imgDetail = {
                                    tagInfo: `img[${index}]`,
                                    attributes: Array.from(img.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' '),
                                    url: null,
                                    isValid: false
                                };
                                
                                // 檢查所有可能的圖片URL屬性
                                const possibleSrcs = [
                                    img.getAttribute('data-src'),
                                    img.getAttribute('data-lazy-src'),
                                    img.getAttribute('data-original'),
                                    img.getAttribute('data-img'),
                                    img.getAttribute('data-lazy'),
                                    img.getAttribute('data-image'),
                                    img.getAttribute('src')
                                ].filter(Boolean);
                                
                                for (const src of possibleSrcs) {
                                    if (src && 
                                        !src.includes('item-no-image.svg') && 
                                        !src.includes('loading') &&
                                        !src.includes('placeholder') &&
                                        src.length > 10) {
                                        
                                        let fullUrl = src;
                                        if (src.startsWith('//')) {
                                            fullUrl = 'https:' + src;
                                        } else if (src.startsWith('/')) {
                                            fullUrl = 'https://tw.bid.yahoo.com' + src;
                                        }
                                        
                                        imgDetail.url = fullUrl;
                                        imgDetail.isValid = true;
                                        analysis.validImages++;
                                        
                                        if (!hasImage) {
                                            imageUrl = fullUrl;
                                            hasImage = true;
                                        }
                                        break;
                                    }
                                }
                                
                                analysis.imageDetails.push(imgDetail);
                            });
                            
                            // 如果在直接父元素中沒找到，嘗試更大範圍
                            if (!hasImage) {
                                const expandedParent = parentElement.closest('div, li, tr, td, article, section') || 
                                                     parentElement.parentElement?.parentElement;
                                
                                if (expandedParent && expandedParent !== parentElement) {
                                    const expandedImages = expandedParent.querySelectorAll('img');
                                    for (const img of expandedImages) {
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
                                            hasImage = true;
                                            
                                            analysis.imageDetails.push({
                                                tagInfo: 'expanded_search',
                                                attributes: Array.from(img.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' '),
                                                url: src,
                                                isValid: true
                                            });
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        return {
                            found: true,
                            pageNumber: pageNum,
                            productName: productName,
                            hasImage: hasImage,
                            imageUrl: imageUrl,
                            analysis: analysis
                        };
                    }
                }
                
                return { found: false };
            }, targetProductId);

            await page.close();

            if (productAnalysis.found) {
                return productAnalysis;
            }
            
        } catch (pageError) {
            console.error(`第 ${pageNum} 頁載入失敗:`, pageError.message);
            await page.close();
            continue;
        }
    }
    
    return { found: false };
}

// 執行分析
analyzeSpecificProducts();
