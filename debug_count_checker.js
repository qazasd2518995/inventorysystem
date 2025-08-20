// 調試商品數量檢查器
const puppeteer = require('puppeteer');

// 調試源正山商品數量檢查
async function debugYuanzhengshan() {
    let browser = null;
    try {
        console.log('🔍 調試源正山商品數量檢查...');
        
        browser = await puppeteer.launch({
            headless: false, // 設為false以便觀察
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('📄 導航到源正山頁面...');
        await page.goto('https://tw.bid.yahoo.com/booth/Y1823944291', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // 等待頁面完全載入
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('🔍 查找商品數量元素...');

        const totalCount = await page.evaluate(() => {
            console.log('開始在頁面中查找商品數量...');
            
            // 多種選擇器嘗試
            const selectors = [
                '.sc-eEfxbP.bSHwST',
                '[class*="bSHwST"]',
                '[data-testid*="result"]',
                '.result-count',
                '.total-count',
                // 新增更多可能的選擇器
                '.sc-fqkvVR',
                '.sc-iBPRYJ',
                '[class*="result"]'
            ];
            
            for (const selector of selectors) {
                console.log(`嘗試選擇器: ${selector}`);
                const elements = document.querySelectorAll(selector);
                console.log(`找到 ${elements.length} 個元素`);
                
                for (let i = 0; i < elements.length; i++) {
                    const element = elements[i];
                    const text = element.textContent || '';
                    console.log(`元素 ${i}: "${text}"`);
                    
                    const match = text.match(/(\d+)筆結果/);
                    if (match) {
                        console.log(`✅ 找到商品數量: ${match[1]}`);
                        return parseInt(match[1]);
                    }
                }
            }
            
            // 嘗試從整個頁面搜索
            console.log('在整個頁面中搜索...');
            const bodyText = document.body.textContent || '';
            console.log(`頁面文字長度: ${bodyText.length}`);
            
            const matches = bodyText.match(/(\d+)\s*筆結果/g);
            if (matches) {
                console.log(`找到的所有匹配: ${matches}`);
                const firstMatch = bodyText.match(/(\d+)\s*筆結果/);
                if (firstMatch) {
                    console.log(`✅ 從頁面文字找到: ${firstMatch[1]}`);
                    return parseInt(firstMatch[1]);
                }
            }
            
            // 嘗試查找頁面標題或其他可能位置
            const title = document.title || '';
            console.log(`頁面標題: "${title}"`);
            const titleMatch = title.match(/(\d+)\s*筆結果/);
            if (titleMatch) {
                console.log(`✅ 從標題找到: ${titleMatch[1]}`);
                return parseInt(titleMatch[1]);
            }
            
            console.log('❌ 未找到商品數量');
            return null;
        });

        console.log(`🎯 檢查結果: ${totalCount}`);
        return totalCount;

    } catch (error) {
        console.error('❌ 調試失敗:', error.message);
        return null;
    } finally {
        if (browser) {
            // 延遲關閉以便觀察
            await new Promise(resolve => setTimeout(resolve, 10000));
            await browser.close();
        }
    }
}

// 調試友茂商品數量檢查
async function debugYoumao() {
    let browser = null;
    try {
        console.log('🔍 調試友茂商品數量檢查...');
        
        browser = await puppeteer.launch({
            headless: false, // 設為false以便觀察
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('📄 導航到友茂頁面...');
        await page.goto('https://www.ruten.com.tw/store/u-mo0955900924/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // 等待頁面完全載入
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('🔍 查找友茂商品數量...');

        const totalCount = await page.evaluate(() => {
            console.log('開始在友茂頁面中查找商品數量...');
            
            // 多種選擇器嘗試
            const selectors = [
                '.category-listing-item-link.category-current',
                '.category-current',
                '.category-listing-item-link',
                '[href*="/list"]',
                '.total-products',
                // 新增更多可能的選擇器
                'a[href*="list"]',
                '.category-item'
            ];
            
            for (const selector of selectors) {
                console.log(`嘗試選擇器: ${selector}`);
                const elements = document.querySelectorAll(selector);
                console.log(`找到 ${elements.length} 個元素`);
                
                for (let i = 0; i < elements.length; i++) {
                    const element = elements[i];
                    const text = element.textContent || '';
                    console.log(`元素 ${i}: "${text}"`);
                    
                    if (text.includes('全部商品')) {
                        const match = text.match(/全部商品\s*\((\d+)\)/);
                        if (match) {
                            console.log(`✅ 找到商品數量: ${match[1]}`);
                            return parseInt(match[1]);
                        }
                    }
                }
            }
            
            // 嘗試從整個頁面搜索
            console.log('在整個友茂頁面中搜索...');
            const bodyText = document.body.textContent || '';
            console.log(`頁面文字長度: ${bodyText.length}`);
            
            const matches = bodyText.match(/全部商品\s*\((\d+)\)/g);
            if (matches) {
                console.log(`找到的所有匹配: ${matches}`);
                const firstMatch = bodyText.match(/全部商品\s*\((\d+)\)/);
                if (firstMatch) {
                    console.log(`✅ 從頁面文字找到: ${firstMatch[1]}`);
                    return parseInt(firstMatch[1]);
                }
            }
            
            console.log('❌ 未找到友茂商品數量');
            return null;
        });

        console.log(`🎯 友茂檢查結果: ${totalCount}`);
        return totalCount;

    } catch (error) {
        console.error('❌ 友茂調試失敗:', error.message);
        return null;
    } finally {
        if (browser) {
            // 延遲關閉以便觀察
            await new Promise(resolve => setTimeout(resolve, 10000));
            await browser.close();
        }
    }
}

async function runDebug() {
    console.log('🧪 開始商品數量檢查器調試...\n');
    
    console.log('=== 源正山調試 ===');
    const yuanzhengResult = await debugYuanzhengshan();
    console.log(`源正山結果: ${yuanzhengResult}\n`);
    
    console.log('=== 友茂調試 ===');  
    const youmaoResult = await debugYoumao();
    console.log(`友茂結果: ${youmaoResult}\n`);
    
    console.log('🎉 調試完成！');
}

// 執行調試
if (require.main === module) {
    runDebug();
}

module.exports = { debugYuanzhengshan, debugYoumao };