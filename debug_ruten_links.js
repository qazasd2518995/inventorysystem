// 調試友茂商品連結收集
const puppeteer = require('puppeteer');

async function debugRutenLinks() {
    let browser = null;
    
    try {
        console.log('🔍 調試友茂商品連結收集...');
        
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
        
        const url = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        console.log(`📍 訪問: ${url}`);
        
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('🔍 分析商品連結...');
        
        const linkAnalysis = await page.evaluate(() => {
            const analysis = {
                allLinks: [],
                itemLinks: [],
                showLinks: [],
                productData: []
            };
            
            // 所有連結
            const allLinks = document.querySelectorAll('a');
            analysis.allLinks = Array.from(allLinks).slice(0, 10).map(link => ({
                href: link.href,
                text: link.textContent.trim().slice(0, 50),
                className: link.className
            }));
            
            // 包含 /item/ 的連結
            const itemLinks = document.querySelectorAll('a[href*="/item/"]');
            analysis.itemLinks = Array.from(itemLinks).slice(0, 10).map(link => ({
                href: link.href,
                text: link.textContent.trim().slice(0, 50),
                className: link.className
            }));
            
            // 包含 show? 的連結
            const showLinks = document.querySelectorAll('a[href*="show?"]');
            analysis.showLinks = Array.from(showLinks).slice(0, 10).map(link => ({
                href: link.href,
                text: link.textContent.trim().slice(0, 50),
                className: link.className
            }));
            
            // 嘗試不同的商品選擇器
            const selectors = [
                'a[href*="/item/show?"]',
                'a[href*="item/show"]',
                '.rt-product-card a',
                '[class*="product"] a',
                '[class*="item"] a'
            ];
            
            selectors.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        analysis.productData.push({
                            selector: selector,
                            count: elements.length,
                            samples: Array.from(elements).slice(0, 3).map(el => ({
                                href: el.href,
                                text: el.textContent.trim().slice(0, 50)
                            }))
                        });
                    }
                } catch (e) {
                    // 忽略錯誤
                }
            });
            
            return analysis;
        });

        console.log('\n📋 連結分析結果:');
        
        console.log(`\n🔗 所有連結 (前10個):`);
        linkAnalysis.allLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.href} | ${link.text}`);
        });
        
        console.log(`\n📦 包含 /item/ 的連結 (${linkAnalysis.itemLinks.length} 個):`);
        linkAnalysis.itemLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.href} | ${link.text}`);
        });
        
        console.log(`\n🎯 包含 show? 的連結 (${linkAnalysis.showLinks.length} 個):`);
        linkAnalysis.showLinks.forEach((link, index) => {
            console.log(`${index + 1}. ${link.href} | ${link.text}`);
        });
        
        console.log(`\n🔍 不同選擇器的結果:`);
        linkAnalysis.productData.forEach(data => {
            console.log(`選擇器: ${data.selector} - 找到 ${data.count} 個`);
            data.samples.forEach((sample, index) => {
                console.log(`  ${index + 1}. ${sample.href} | ${sample.text}`);
            });
            console.log('');
        });
        
        // 保持瀏覽器開啟15秒以便觀察
        console.log('\n⏰ 保持瀏覽器開啟15秒以便觀察...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
    } catch (error) {
        console.error('調試過程中發生錯誤:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('🏁 友茂商品連結調試完成');
    }
}

// 執行調試
debugRutenLinks();
