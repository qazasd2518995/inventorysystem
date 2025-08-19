const puppeteer = require('puppeteer');

async function debugProduct(productId) {
    let browser = null;
    
    try {
        console.log(`正在檢查商品 ID: ${productId}`);
        
        browser = await puppeteer.launch({
            headless: false, // 顯示瀏覽器以便調試
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        
        // 直接訪問商品頁面
        const productUrl = `https://tw.bid.yahoo.com/item/${productId}`;
        console.log(`訪問商品頁面: ${productUrl}`);
        
        await page.goto(productUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // 等待頁面載入
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 檢查頁面中的所有圖片
        const imageInfo = await page.evaluate(() => {
            const images = document.querySelectorAll('img');
            const imageData = [];
            
            images.forEach((img, index) => {
                imageData.push({
                    index: index,
                    src: img.src,
                    dataSrc: img.getAttribute('data-src'),
                    dataOriginal: img.getAttribute('data-original'),
                    alt: img.alt,
                    className: img.className,
                    width: img.width,
                    height: img.height,
                    parentClass: img.parentElement?.className || ''
                });
            });
            
            return imageData;
        });

        console.log('找到的圖片資訊:');
        imageInfo.forEach((img, i) => {
            console.log(`圖片 ${i + 1}:`);
            console.log(`  src: ${img.src}`);
            console.log(`  data-src: ${img.dataSrc}`);
            console.log(`  alt: ${img.alt}`);
            console.log(`  class: ${img.className}`);
            console.log(`  size: ${img.width}x${img.height}`);
            console.log(`  parent class: ${img.parentClass}`);
            console.log('---');
        });

        // 也檢查商品列表頁面中這個商品的情況
        console.log('\n檢查商品列表頁面中的情況...');
        
        // 找到包含這個商品的頁面（假設在前幾頁）
        for (let pageNum = 1; pageNum <= 5; pageNum++) {
            const listUrl = pageNum === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${pageNum}&mode=list`;
            
            await page.goto(listUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // 滾動頁面觸發懶載入
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

            await new Promise(resolve => setTimeout(resolve, 2000));

            // 檢查是否找到目標商品
            const foundProduct = await page.evaluate((targetId) => {
                const itemLinks = document.querySelectorAll('a[href*="item/"]');
                
                for (const linkElement of itemLinks) {
                    const href = linkElement.getAttribute('href');
                    if (href.includes(targetId)) {
                        const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                        
                        // 檢查這個商品的圖片情況
                        const images = parentElement.querySelectorAll('img');
                        const imageData = [];
                        
                        images.forEach(img => {
                            imageData.push({
                                src: img.src,
                                dataSrc: img.getAttribute('data-src'),
                                alt: img.alt,
                                className: img.className
                            });
                        });
                        
                        return {
                            found: true,
                            productName: linkElement.textContent.trim(),
                            images: imageData,
                            parentHTML: parentElement.innerHTML.substring(0, 500) + '...'
                        };
                    }
                }
                
                return { found: false };
            }, productId);

            if (foundProduct.found) {
                console.log(`在第 ${pageNum} 頁找到商品:`);
                console.log(`商品名稱: ${foundProduct.productName}`);
                console.log(`圖片數量: ${foundProduct.images.length}`);
                foundProduct.images.forEach((img, i) => {
                    console.log(`  圖片 ${i + 1}: ${img.src || img.dataSrc || '無'}`);
                });
                console.log(`父元素HTML: ${foundProduct.parentHTML}`);
                break;
            }
        }

    } catch (error) {
        console.error('檢查失敗:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 執行檢查
debugProduct('101553871162');
