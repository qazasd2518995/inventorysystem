const puppeteer = require('puppeteer-core');
require('dotenv').config();

async function checkRutenLinks() {
    console.log('🔍 檢查露天商品連結格式...');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        const baseUrl = 'https://www.ruten.com.tw/store/u-mo0955900924/';
        
        console.log(`🌐 訪問: ${baseUrl}`);
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // 等待頁面完全載入
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 檢查所有可能的商品連結
        const linkInfo = await page.evaluate(() => {
            const info = {
                allLinks: [],
                productPatterns: [],
                imageElements: [],
                textContent: document.body.textContent.substring(0, 1000)
            };
            
            // 收集所有連結
            const allLinks = Array.from(document.querySelectorAll('a[href]'));
            
            allLinks.forEach(link => {
                const href = link.href;
                const text = link.textContent.trim();
                
                if (href.includes('ruten.com.tw') && 
                    (href.includes('item') || href.includes('product') || href.match(/\/\d+/))) {
                    info.allLinks.push({
                        href: href,
                        text: text.substring(0, 50),
                        className: link.className
                    });
                }
            });
            
            // 檢查常見的商品連結模式
            const patterns = [
                'a[href*="/item/show?"]',
                'a[href*="/item/"]',
                'a[href*="/product/"]',
                'a[href*="goods"]',
                'a[href*="bid"]',
                '[data-goods-no]',
                '[data-product-id]'
            ];
            
            patterns.forEach(pattern => {
                const elements = document.querySelectorAll(pattern);
                if (elements.length > 0) {
                    info.productPatterns.push(`${pattern}: ${elements.length} 個`);
                }
            });
            
            // 檢查圖片元素
            const images = Array.from(document.querySelectorAll('img'));
            images.slice(0, 10).forEach(img => {
                if (img.src && (img.src.includes('rimg') || img.src.includes('product') || img.src.includes('item'))) {
                    info.imageElements.push({
                        src: img.src,
                        alt: img.alt,
                        parent: img.parentElement ? img.parentElement.tagName + '.' + img.parentElement.className : 'unknown'
                    });
                }
            });
            
            return info;
        });
        
        console.log('\n📊 分析結果:');
        console.log(`找到的產品連結: ${linkInfo.allLinks.length} 個`);
        
        if (linkInfo.allLinks.length > 0) {
            console.log('\n🔗 前幾個產品連結:');
            linkInfo.allLinks.slice(0, 5).forEach((link, index) => {
                console.log(`   ${index + 1}. ${link.href}`);
                console.log(`      文字: ${link.text}`);
                console.log(`      類別: ${link.className}`);
            });
        }
        
        console.log('\n🎯 模式檢查結果:');
        if (linkInfo.productPatterns.length > 0) {
            linkInfo.productPatterns.forEach(pattern => {
                console.log(`   ${pattern}`);
            });
        } else {
            console.log('   ❌ 未找到任何已知的商品連結模式');
        }
        
        console.log('\n🖼️ 圖片元素:');
        if (linkInfo.imageElements.length > 0) {
            linkInfo.imageElements.slice(0, 3).forEach((img, index) => {
                console.log(`   ${index + 1}. ${img.src}`);
                console.log(`      父元素: ${img.parent}`);
            });
        }
        
        console.log('\n📝 頁面文字片段:');
        console.log(`   ${linkInfo.textContent}`);
        
    } catch (error) {
        console.error('❌ 檢查過程中發生錯誤:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

checkRutenLinks();
