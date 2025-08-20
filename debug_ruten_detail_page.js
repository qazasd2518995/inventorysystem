// 調試友茂商品詳細頁面的價格
const puppeteer = require('puppeteer');

async function debugRutenDetailPage() {
    let browser = null;
    
    try {
        console.log('🔍 調試友茂商品詳細頁面價格...');
        
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
        
        // 訪問一個具體的商品詳細頁面
        const productUrl = 'https://www.ruten.com.tw/item/show?21628089049784';
        console.log(`📍 訪問商品詳細頁面: ${productUrl}`);
        
        await page.goto(productUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 8000)); // 等待更長時間

        console.log('🔍 分析商品詳細頁面價格結構...');
        
        const priceAnalysis = await page.evaluate(() => {
            const analysis = {
                title: document.title,
                url: window.location.href,
                priceElements: [],
                bodyText: document.body.textContent.slice(0, 1000)
            };
            
            // 搜索所有可能包含價格的選擇器
            const priceSelectors = [
                '.rt-text-xx-large.rt-text-important',
                'strong.rt-text-xx-large.rt-text-important',
                '.rt-text-important',
                '.rt-text-xx-large',
                '.price',
                '[class*="price"]',
                '.money',
                '.cost',
                '.amount',
                'strong',
                'span',
                'div'
            ];
            
            priceSelectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => {
                        const text = el.textContent.trim();
                        // 搜索包含 $ 或 元 或 純數字 的元素
                        if (text && (text.includes('$') || text.includes('元') || text.match(/^\d{1,6}$/))) {
                            analysis.priceElements.push({
                                selector: selector,
                                text: text,
                                innerHTML: el.innerHTML.slice(0, 200),
                                className: el.className,
                                tagName: el.tagName,
                                outerHTML: el.outerHTML.slice(0, 300)
                            });
                        }
                    });
                } catch (e) {
                    // 忽略錯誤
                }
            });
            
            // 搜索頁面中所有包含價格格式的文字
            const priceMatches = document.body.textContent.match(/\$[\d,]+|[\d,]+元|NT\$[\d,]+/g) || [];
            analysis.foundPriceTexts = priceMatches.slice(0, 10);
            
            return analysis;
        });

        console.log('\n📋 商品詳細頁面分析:');
        console.log(`標題: ${priceAnalysis.title}`);
        console.log(`URL: ${priceAnalysis.url}`);
        console.log(`找到的價格元素: ${priceAnalysis.priceElements.length} 個`);
        
        if (priceAnalysis.priceElements.length > 0) {
            console.log('\n💰 價格元素詳情:');
            priceAnalysis.priceElements.forEach((el, index) => {
                console.log(`${index + 1}. "${el.text}"`);
                console.log(`   選擇器: ${el.selector}`);
                console.log(`   標籤: ${el.tagName}`);
                console.log(`   類名: ${el.className}`);
                console.log(`   HTML: ${el.outerHTML}`);
                console.log('');
            });
        } else {
            console.log('❌ 沒有找到價格元素');
        }
        
        console.log('\n🔍 頁面中的價格文字:');
        priceAnalysis.foundPriceTexts.forEach((text, index) => {
            console.log(`${index + 1}. "${text}"`);
        });
        
        console.log('\n📄 頁面內容預覽:');
        console.log(priceAnalysis.bodyText);
        
        // 保持瀏覽器開啟20秒以便觀察
        console.log('\n⏰ 保持瀏覽器開啟20秒以便觀察...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
    } catch (error) {
        console.error('調試過程中發生錯誤:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🏁 友茂商品詳細頁面調試完成');
    }
}

// 執行調試
debugRutenDetailPage();
