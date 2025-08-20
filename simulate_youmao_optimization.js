// 友茂爬蟲優化模擬測試 - 仿照源正山方式
const puppeteer = require('puppeteer');

// 模擬源正山風格的友茂爬蟲
async function simulateOptimizedYoumao() {
    let allProducts = [];
    let browser = null;
    const maxPages = 5; // 限制測試頁數避免影響系統

    try {
        console.log('🧪 模擬測試：友茂使用源正山風格的爬蟲...');
        
        // 使用源正山類似的簡單設定
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

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= maxPages) {
            console.log(`📄 正在載入第 ${currentPage} 頁...`);
            
            const pageUrl = currentPage === 1 
                ? 'https://www.ruten.com.tw/store/u-mo0955900924/'
                : `https://www.ruten.com.tw/store/u-mo0955900924/?p=${currentPage}`;
            
            const startTime = Date.now();
            
            await page.goto(pageUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // 源正山風格的等待時間
            const waitTime = 2500; // 固定2.5秒，類似源正山
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

            // 測試多種數據獲取方式
            const products = await page.evaluate(() => {
                const productList = [];
                
                console.log('🔍 方法1: 尋找JSON數據...');
                
                // 方法1: 尋找類似源正山的JSON數據
                try {
                    // 檢查各種可能的script標籤
                    const scripts = document.querySelectorAll('script');
                    let jsonFound = false;
                    
                    for (let i = 0; i < scripts.length; i++) {
                        const script = scripts[i];
                        const content = script.textContent || script.innerHTML || '';
                        
                        // 檢查是否包含商品數據的JSON
                        if (content.includes('product') || content.includes('item') || content.includes('data')) {
                            console.log(`找到可能的JSON script ${i}, 長度: ${content.length}`);
                            
                            // 嘗試解析JSON
                            try {
                                // 尋找JSON物件模式
                                const jsonMatches = content.match(/\{[^{}]*"[^"]*"[^{}]*\}/g) || 
                                                   content.match(/\[[^\[\]]*\{[^{}]*\}[^\[\]]*\]/g);
                                
                                if (jsonMatches && jsonMatches.length > 0) {
                                    console.log(`找到 ${jsonMatches.length} 個可能的JSON片段`);
                                    
                                    for (const jsonMatch of jsonMatches) {
                                        try {
                                            const data = JSON.parse(jsonMatch);
                                            if (Array.isArray(data) && data.length > 0) {
                                                console.log('✅ 找到JSON陣列數據！');
                                                // 處理JSON數據
                                                data.forEach(item => {
                                                    if (item.id || item.productId || item.name || item.title) {
                                                        productList.push({
                                                            id: item.id || item.productId || Date.now() + Math.random(),
                                                            name: item.name || item.title || '未知商品',
                                                            price: parseInt(item.price) || 0,
                                                            imageUrl: item.image || item.imageUrl || '',
                                                            url: item.url || item.link || '',
                                                            source: 'JSON'
                                                        });
                                                    }
                                                });
                                                if (productList.length > 0) {
                                                    jsonFound = true;
                                                    break;
                                                }
                                            }
                                        } catch (e) {
                                            // JSON解析失敗，繼續嘗試
                                        }
                                    }
                                }
                            } catch (e) {
                                // 繼續檢查其他script
                            }
                        }
                    }
                    
                    if (jsonFound) {
                        console.log(`✅ JSON方法成功獲取 ${productList.length} 個商品`);
                        return productList;
                    }
                } catch (e) {
                    console.log('JSON解析失敗:', e.message);
                }
                
                console.log('🔍 方法2: 使用優化的DOM解析...');
                
                // 方法2: 優化的DOM解析（源正山風格）
                try {
                    const productLinks = document.querySelectorAll('a[href*="/item/show?"]');
                    console.log(`找到 ${productLinks.length} 個商品連結`);
                    
                    productLinks.forEach((linkElement, index) => {
                        try {
                            const href = linkElement.href;
                            const match = href.match(/[?&](\d+)/);
                            
                            if (match) {
                                const id = match[1];
                                
                                // 快速獲取商品名稱
                                let name = linkElement.textContent?.trim() || 
                                          linkElement.getAttribute('title') || 
                                          linkElement.querySelector('img')?.getAttribute('alt') || '';
                                
                                // 快速獲取價格（從周圍元素）
                                let price = 0;
                                const parentElement = linkElement.closest('[class*="product"], [class*="item"]') || linkElement.parentElement;
                                if (parentElement) {
                                    const priceText = parentElement.textContent || '';
                                    const priceMatch = priceText.match(/NT?\$?\s*([0-9,]+)/);
                                    if (priceMatch) {
                                        price = parseInt(priceMatch[1].replace(/,/g, ''));
                                    }
                                }
                                
                                // 快速獲取圖片
                                let imageUrl = '';
                                if (parentElement) {
                                    const imgElement = parentElement.querySelector('img');
                                    if (imgElement) {
                                        imageUrl = imgElement.src || imgElement.dataset.src || '';
                                    }
                                }
                                
                                if (name && name.length > 3) {
                                    productList.push({
                                        id: id,
                                        name: name,
                                        price: price,
                                        imageUrl: imageUrl,
                                        url: href,
                                        source: 'DOM_optimized'
                                    });
                                }
                            }
                        } catch (error) {
                            // 忽略單個商品錯誤
                        }
                    });
                    
                    console.log(`✅ 優化DOM方法獲取 ${productList.length} 個商品`);
                    
                } catch (e) {
                    console.log('優化DOM解析失敗:', e.message);
                }
                
                return productList;
            });

            const loadTime = Date.now() - startTime;
            const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
            const imageSuccessRate = products.length > 0 ? ((productsWithImages / products.length) * 100).toFixed(1) : 0;
            
            console.log(`✅ 第 ${currentPage} 頁: ${products.length} 個商品, 圖片 ${productsWithImages}/${products.length} (${imageSuccessRate}%), 載入時間: ${loadTime}ms`);
            
            if (products.length > 0) {
                console.log(`📊 數據來源: ${products[0]?.source || '未知'}`);
            }
            
            allProducts.push(...products);
            
            if (products.length === 0) {
                hasMorePages = false;
            } else {
                currentPage++;
                // 源正山風格的頁面間延遲
                const pageDelay = 500;
                await new Promise(resolve => setTimeout(resolve, pageDelay));
            }
        }
        
        return {
            success: true,
            totalProducts: allProducts.length,
            totalPages: currentPage - 1,
            products: allProducts,
            averageSpeed: allProducts.length > 0 ? (allProducts.length / (currentPage - 1)) : 0
        };

    } catch (error) {
        console.error('❌ 模擬測試失敗:', error.message);
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

// 對比測試函數
async function compareOptimizationResults() {
    console.log('🚀 開始友茂優化模擬測試...\n');
    
    const startTime = Date.now();
    const result = await simulateOptimizedYoumao();
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log('\n📊 測試結果分析:');
    console.log(`⏱️  總執行時間: ${totalTime.toFixed(2)}秒`);
    console.log(`📦 獲取商品數: ${result.totalProducts}個`);
    console.log(`📄 處理頁數: ${result.totalPages || 0}頁`);
    console.log(`⚡ 平均速度: ${result.averageSpeed?.toFixed(1) || 0}個商品/頁`);
    console.log(`💾 記憶體使用: 1個瀏覽器實例 + 1個頁面 (源正山風格)`);
    
    if (result.success) {
        console.log('\n🎯 優化可行性分析:');
        
        if (result.products && result.products.length > 0) {
            const dataSource = result.products[0]?.source;
            console.log(`📋 主要數據來源: ${dataSource}`);
            
            if (dataSource === 'JSON') {
                console.log('✅ 發現JSON數據！可以大幅優化');
                console.log('💡 建議: 使用JSON解析方式，速度可提升5-10倍');
            } else if (dataSource === 'DOM_optimized') {
                console.log('⚡ DOM優化可行！可以適度優化');
                console.log('💡 建議: 使用單頁面+優化DOM解析，速度可提升2-3倍');
            }
            
            // 樣本數據展示
            console.log('\n📝 樣本數據 (前3個商品):');
            result.products.slice(0, 3).forEach((product, index) => {
                console.log(`  ${index + 1}. ${product.name} - NT$${product.price} [${product.source}]`);
            });
        }
        
        console.log('\n🔄 vs 現有友茂爬蟲對比:');
        console.log('  現有方式: 雙階段處理 + 並行頁面 + 重試機制 ≈ 18分鐘');
        console.log(`  優化方式: 單階段處理 + 單頁面重用 ≈ ${(totalTime * 9).toFixed(0)}秒 (估計全部45頁)`);
        console.log(`  🚀 預期提升: ${(1080 / (totalTime * 9)).toFixed(1)}倍速度！`);
        
    } else {
        console.log('\n❌ 優化測試失敗:');
        console.log(`錯誤: ${result.error}`);
        console.log('💡 可能需要調整策略或網站結構不適合優化');
    }
}

// 執行測試
if (require.main === module) {
    compareOptimizationResults();
}

module.exports = { simulateOptimizedYoumao, compareOptimizationResults };