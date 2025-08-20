const puppeteer = require('puppeteer-core');
require('dotenv').config();

async function debugRutenPagination() {
    console.log('🔍 調試露天分頁邏輯...');
    
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
        
        for (let pageNum = 1; pageNum <= 5; pageNum++) {
            console.log(`\n📄 測試第 ${pageNum} 頁...`);
            
            const pageUrl = pageNum === 1 ? baseUrl : `${baseUrl}?p=${pageNum}`;
            console.log(`   URL: ${pageUrl}`);
            
            try {
                await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const pageInfo = await page.evaluate(() => {
                    const info = {
                        products: 0,
                        pagination: '',
                        hasNext: false,
                        currentPage: '',
                        totalPages: ''
                    };
                    
                    // 計算商品數量
                    info.products = document.querySelectorAll('a[href*="/item/show?"]').length;
                    
                    // 檢查分頁資訊
                    const paginationElement = document.querySelector('.rt-pagination');
                    if (paginationElement) {
                        info.pagination = paginationElement.textContent.trim();
                        
                        // 檢查分頁文字模式
                        const pageMatch = info.pagination.match(/第\s*(\d+)\s*\/\s*(\d+)\s*頁/);
                        if (pageMatch) {
                            info.currentPage = pageMatch[1];
                            info.totalPages = pageMatch[2];
                        }
                    }
                    
                    // 檢查下一頁按鈕
                    const nextButtons = document.querySelectorAll('a[title="下一頁"], .rt-pagination a');
                    nextButtons.forEach(button => {
                        if (button.textContent.includes('下一頁') || button.classList.contains('next')) {
                            if (!button.classList.contains('disabled')) {
                                info.hasNext = true;
                            }
                        }
                    });
                    
                    return info;
                });
                
                console.log(`   📦 商品數量: ${pageInfo.products}`);
                console.log(`   📄 分頁資訊: ${pageInfo.pagination || '無'}`);
                console.log(`   📊 當前頁: ${pageInfo.currentPage || '未知'}`);
                console.log(`   📊 總頁數: ${pageInfo.totalPages || '未知'}`);
                console.log(`   ➡️ 有下一頁: ${pageInfo.hasNext ? '是' : '否'}`);
                
                // 如果商品數量為0，嘗試等待更長時間
                if (pageInfo.products === 0 && pageNum === 1) {
                    console.log('   ⏰ 商品為0，等待更長時間...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    const retryInfo = await page.evaluate(() => {
                        return {
                            products: document.querySelectorAll('a[href*="/item/show?"]').length,
                            allLinks: Array.from(document.querySelectorAll('a')).map(a => a.href).filter(href => href.includes('item')).slice(0, 5)
                        };
                    });
                    
                    console.log(`   🔄 重試後商品數量: ${retryInfo.products}`);
                    if (retryInfo.allLinks.length > 0) {
                        console.log('   🔗 找到的商品連結:');
                        retryInfo.allLinks.forEach(link => console.log(`      ${link}`));
                    }
                }
                
                // 如果沒有商品且沒有下一頁，停止
                if (pageInfo.products === 0 && !pageInfo.hasNext) {
                    console.log('   🛑 沒有商品且沒有下一頁，停止測試');
                    break;
                }
                
            } catch (error) {
                console.log(`   ❌ 第 ${pageNum} 頁載入失敗: ${error.message}`);
            }
        }
        
    } catch (error) {
        console.error('❌ 調試過程中發生錯誤:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

debugRutenPagination();
