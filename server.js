const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const ExcelJS = require('exceljs');
// const cron = require('node-cron'); // Vercel不支援定時任務
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
// const sharp = require('sharp'); // 移除sharp依賴以適合Vercel部署

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 儲存商品資料的變數
let productsCache = [];
let lastUpdateTime = null;
let isUpdating = false; // 防止重複更新的旗標
let lastFullScanTime = null; // 上次完整掃描時間
let productHashMap = new Map(); // 商品雜湊對照表，用於快速檢測變更

// 移除圖片下載和壓縮功能以適合Vercel部署

// 產生商品雜湊值的函數
function generateProductHash(product) {
    const hashString = `${product.id}-${product.name}-${product.price}-${product.imageUrl}`;
    return crypto.createHash('md5').update(hashString).digest('hex');
}

// 快速檢測商品變更的函數
async function quickChangeDetection() {
    console.log('正在進行快速變更檢測...');
    let browser = null;
    
    try {
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
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 只檢查前3頁來快速偵測變更
        let changesDetected = false;
        let newProductsCount = 0;
        let modifiedProductsCount = 0;
        
        for (let currentPage = 1; currentPage <= 3; currentPage++) {
            const pageUrl = currentPage === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?pg=${currentPage}`;
            
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 簡化的滾動
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 快速抓取商品資料
            const products = await page.evaluate(() => {
                const productList = [];
                const selectors = ['a[href*="/item/"]', '[data-testid="item-card"]'];
                
                let productElements = [];
                for (const selector of selectors) {
                    productElements = document.querySelectorAll(selector);
                    if (productElements.length > 0) break;
                }
                
                productElements.forEach((element, index) => {
                    if (index >= 60) return; // 限制每頁最多60個
                    
                    const link = element.href || element.querySelector('a')?.href;
                    if (!link || !link.includes('/item/')) return;
                    
                    const id = link.match(/\/item\/(\d+)/)?.[1];
                    if (!id) return;
                    
                    const name = element.textContent?.trim() || '';
                    const priceMatch = name.match(/\$([0-9,]+)$/);
                    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
                    
                    const img = element.querySelector('img');
                    let imageUrl = '';
                    if (img) {
                        imageUrl = img.src || img.dataset.src || img.dataset.original || '';
                    }
                    
                    if (name && id) {
                        productList.push({
                            id,
                            name,
                            price,
                            imageUrl,
                            link
                        });
                    }
                });
                
                return productList;
            });
            
            // 檢查變更
            for (const product of products) {
                const newHash = generateProductHash(product);
                const oldHash = productHashMap.get(product.id);
                
                if (!oldHash) {
                    // 新商品
                    newProductsCount++;
                    changesDetected = true;
                } else if (oldHash !== newHash) {
                    // 商品已修改
                    modifiedProductsCount++;
                    changesDetected = true;
                }
            }
            
            if (changesDetected) break; // 發現變更就停止檢查
        }
        
        console.log(`快速檢測結果: 新商品 ${newProductsCount} 個, 修改商品 ${modifiedProductsCount} 個`);
        return { changesDetected, newProductsCount, modifiedProductsCount };
        
    } catch (error) {
        console.error('快速變更檢測失敗:', error);
        return { changesDetected: true, newProductsCount: 0, modifiedProductsCount: 0 }; // 發生錯誤時執行完整更新
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 爬蟲函數 - 使用 Puppeteer 抓取奇摩拍賣商品資料
async function fetchYahooAuctionProducts() {
    let allProducts = [];
    let browser = null;

    try {
        console.log('正在啟動瀏覽器...');
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
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        
        // 設定 User-Agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 設定視窗大小
        await page.setViewport({ width: 1920, height: 1080 });

        // 抓取多頁商品
        let currentPage = 1;
        let hasMorePages = true;
        const maxPages = 50; // 限制最多抓取50頁（確保能抓取完所有2123個商品）

        while (hasMorePages && currentPage <= maxPages) {
            console.log(`正在載入第 ${currentPage} 頁...`);
            
            const pageUrl = currentPage === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?pg=${currentPage}`;
            
            // 載入頁面
            await page.goto(pageUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // 等待更長時間確保圖片載入完成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // 滾動頁面觸發懶加載圖片
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

            console.log(`正在抓取第 ${currentPage} 頁商品資料...`);
        
        // 執行 JavaScript 來取得商品資料
        const products = await page.evaluate(() => {
            const productList = [];
            
            // 嘗試多種選擇器來找到商品元素
            const selectors = [
                '[data-testid="item-card"]',
                '.item-card',
                '.product-item',
                '.item',
                'a[href*="/item/"]',
                '[class*="item"]',
                '[class*="ItemCard"]',
                'div[class*="sc-"]'
            ];
            
            let productElements = [];
            
            for (const selector of selectors) {
                productElements = document.querySelectorAll(selector);
                if (productElements.length > 0) {
                    console.log(`找到 ${productElements.length} 個商品元素，使用選擇器: ${selector}`);
                    break;
                }
            }
            
            // 如果還是找不到，嘗試從 React 狀態中取得資料
            if (productElements.length === 0) {
                try {
                    // 查找 Redux 狀態
                    const scriptElement = document.getElementById('isoredux-data');
                    if (scriptElement) {
                        const jsonData = JSON.parse(scriptElement.textContent);
                        
                        // 調試：顯示 JSON 資料的主要結構
                        console.log('JSON 資料主要鍵值:', Object.keys(jsonData));
                        if (jsonData.booth) {
                            console.log('booth 資料鍵值:', Object.keys(jsonData.booth));
                        }
                        
                        // 檢查各種可能的資料結構
                        const possiblePaths = [
                            'items',
                            'booth.items',
                            'data.items',
                            'listings',
                            'booth.listings',
                            'data.listings',
                            'booth.hotSaleListings',
                            'booth.recommendListings'
                        ];
                        
                        for (const path of possiblePaths) {
                            const pathParts = path.split('.');
                            let currentData = jsonData;
                            
                            for (const part of pathParts) {
                                if (currentData && currentData[part]) {
                                    currentData = currentData[part];
                                } else {
                                    currentData = null;
                                    break;
                                }
                            }
                            
                            if (currentData && Array.isArray(currentData)) {
                                console.log(`從 JSON 資料中找到商品，路徑: ${path}, 數量: ${currentData.length}`);
                                
                                currentData.forEach(item => {
                                    if (item.id && item.title) {
                                        // 從標題中提取價格
                                        let price = parseInt(item.price) || 0;
                                        if (price === 0 && item.title) {
                                            // 清理標題，移除換行符和多餘空格
                                            const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
                                            
                                            // 優先尋找 $符號後的價格（最準確）
                                            const dollarPriceEnd = cleanTitle.match(/\$([0-9,]+)$/);
                                            if (dollarPriceEnd) {
                                                price = parseInt(dollarPriceEnd[1].replace(/,/g, '')) || 0;
                                            } else {
                                                // 尋找其他價格格式
                                                const pricePatterns = [
                                                    /\$([0-9,]+)/,                    // 任何位置的 $5,500  
                                                    /NT\$\s*([0-9,]+)/,              // NT$ 5500
                                                    /([0-9,]+)\s*元/,                 // 5500元
                                                    /價格[：:\s]*([0-9,]+)/,          // 價格：5500
                                                    /售價[：:\s]*([0-9,]+)/           // 售價：5500
                                                ];
                                                
                                                for (const pattern of pricePatterns) {
                                                    const match = cleanTitle.match(pattern);
                                                    if (match) {
                                                        const extractedPrice = parseInt(match[1].replace(/,/g, '')) || 0;
                                                        if (extractedPrice > 0) {
                                                            price = extractedPrice;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // 改善圖片處理邏輯
                                        let imageUrl = '';
                                        if (item.images && item.images.length > 0) {
                                            // 尋找第一個有效的圖片URL
                                            for (const image of item.images) {
                                                if (image.url && !image.url.includes('item-no-image.svg')) {
                                                    imageUrl = image.url;
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        // 放寬條件：只要有基本資訊就加入
                                        if (item.title && item.title.trim().length > 5) {
                                            productList.push({
                                                id: item.id,
                                                name: item.title,
                                                price: price,
                                                imageUrl: imageUrl,
                                                link: `https://tw.bid.yahoo.com/item/${item.id}`
                                            });
                                        }
                                    }
                                });
                                
                                if (productList.length > 0) {
                                    break;
                                }
                            }
                        }
                    }
                } catch (jsonError) {
                    console.error('解析 JSON 資料失敗:', jsonError);
                }
            } else {
                // 解析 DOM 元素
                productElements.forEach(element => {
                    try {
                        const linkElement = element.querySelector('a[href*="/item/"]') || element;
                        const imageElement = element.querySelector('img');
                        const titleElement = element.querySelector('[data-testid="item-title"], .item-title, .title, h3, h4') || element;
                        
                        // 更新價格選擇器，包含您提到的特定class
                        const priceElement = element.querySelector(
                            '.sc-eEfxbP.sc-gkYeAe.iOlJWd.gCloYg, ' +
                            '[data-testid="item-price"], ' +
                            '.price, ' +
                            '.item-price, ' +
                            '[class*="price"], ' +
                            'span[class*="sc-"]:not([class*="title"])'
                        );
                        
                        let productId = '';
                        let productLink = '';
                        
                        if (linkElement && linkElement.href) {
                            productLink = linkElement.href;
                            const idMatch = productLink.match(/item\/([a-zA-Z0-9]+)/);
                            if (idMatch) {
                                productId = idMatch[1];
                            }
                        }
                        
                        const productName = titleElement ? (
                            titleElement.textContent || 
                            titleElement.innerText || 
                            titleElement.getAttribute('title') ||
                            (imageElement && imageElement.alt)
                        ) : '';
                        
                        let price = 0;
                        
                        // 優先從商品名稱中提取價格（最可靠）
                        if (productName) {
                            // 優先尋找 $符號後的價格（通常在商品名稱末尾）
                            const dollarPrice = productName.match(/\$([0-9,]+)$/);
                            if (dollarPrice) {
                                price = parseInt(dollarPrice[1].replace(/,/g, '')) || 0;
                            } else {
                                // 如果沒有在末尾找到，尋找任何位置的 $價格
                                const anyDollarPrice = productName.match(/\$([0-9,]+)/);
                                if (anyDollarPrice) {
                                    price = parseInt(anyDollarPrice[1].replace(/,/g, '')) || 0;
                                }
                            }
                        }
                        
                        // 如果商品名稱中沒找到價格，才從DOM元素中提取
                        if (price === 0 && priceElement) {
                            const priceText = priceElement.textContent || priceElement.innerText || '';
                            // 尋找價格模式：$5,500 或純數字
                            const priceMatch = priceText.match(/\$?([0-9,]+)/);
                            if (priceMatch) {
                                price = parseInt(priceMatch[1].replace(/,/g, '')) || 0;
                            }
                        }
                        
                        // 改善圖片抓取邏輯
                        let imageUrl = '';
                        if (imageElement) {
                            // 嘗試多種圖片來源屬性
                            imageUrl = imageElement.src || 
                                      imageElement.getAttribute('data-src') ||
                                      imageElement.getAttribute('data-original') ||
                                      imageElement.getAttribute('data-lazy') ||
                                      imageElement.getAttribute('data-srcset') ||
                                      imageElement.getAttribute('srcset') ||
                                      '';
                            
                            // 如果是預設無圖片，嘗試尋找其他圖片元素
                            if (!imageUrl || imageUrl.includes('item-no-image.svg')) {
                                // 在同一個商品容器中尋找其他圖片
                                const container = imageElement.closest('a') || imageElement.parentElement;
                                if (container) {
                                    const otherImages = container.querySelectorAll('img');
                                    for (const img of otherImages) {
                                        const altSrc = img.src || 
                                                     img.getAttribute('data-src') ||
                                                     img.getAttribute('data-original') ||
                                                     img.getAttribute('data-lazy') ||
                                                     '';
                                        if (altSrc && !altSrc.includes('item-no-image.svg')) {
                                            imageUrl = altSrc;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // 放寬條件：只要有ID和名稱就加入
                        if (productId && productName && productName.trim().length > 5) {
                            productList.push({
                                id: productId,
                                name: productName.trim(),
                                price: price,
                                imageUrl: imageUrl || '',
                                link: productLink || `https://tw.bid.yahoo.com/item/${productId}`
                            });
                        }
                    } catch (elementError) {
                        console.error('解析商品元素失敗:', elementError);
                    }
                });
            }
            
            return productList;
        });

            console.log(`第 ${currentPage} 頁抓取到 ${products.length} 個商品`);
            
            // 將這一頁的商品加入總列表
            allProducts.push(...products);
            
            // 簡化分頁邏輯 - 直接基於頁數和商品數量
            const pageInfo = await page.evaluate((currentPageNum) => {
                const productCount = document.querySelectorAll('a[href*="/item/"]').length;
                console.log(`第${currentPageNum}頁商品數量: ${productCount}`);
                
                // 如果這頁沒有商品，停止抓取
                if (productCount === 0) {
                    return { hasNext: false, reason: `第${currentPageNum}頁沒有商品` };
                }
                
                // 如果還沒到第40頁，繼續抓取（確保能抓完2123個商品）
                if (currentPageNum < 40) {
                    return { hasNext: true, reason: `第${currentPageNum}頁有${productCount}個商品，繼續下一頁` };
                }
                
                // 第40頁以後，如果商品數量還很多，繼續抓取
                if (productCount >= 30) {
                    return { hasNext: true, reason: `第${currentPageNum}頁還有${productCount}個商品，繼續抓取` };
                }
                
                return { hasNext: false, reason: `第${currentPageNum}頁商品較少，停止抓取` };
            }, currentPage);
            
            console.log(`第 ${currentPage} 頁分頁檢測結果:`, pageInfo);
            const hasNextPage = pageInfo.hasNext;
            
            // 如果沒有商品或沒有下一頁，停止抓取
            if (products.length === 0 || !hasNextPage) {
                hasMorePages = false;
            } else {
                currentPage++;
                // 避免請求過快
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`總共成功抓取 ${allProducts.length} 個商品，共 ${currentPage - 1} 頁`);
        
        // 為每個商品添加更新時間
        const productsWithTime = allProducts.map(product => ({
            ...product,
            updateTime: new Date().toISOString()
        }));

        productsCache = productsWithTime;
        lastUpdateTime = new Date();
        lastFullScanTime = new Date();
        
        // 更新商品雜湊對照表
        productHashMap.clear();
        productsWithTime.forEach(product => {
            const hash = generateProductHash(product);
            productHashMap.set(product.id, hash);
        });
        
        console.log(`已更新商品雜湊對照表，共 ${productHashMap.size} 個商品`);
        
        return productsWithTime;

    } catch (error) {
        console.error('抓取商品資料時發生錯誤:', error.message);
        
        // 如果是第一次抓取失敗，返回空陣列
        if (productsCache.length === 0) {
            return [];
        }
        // 否則返回快取的資料
        return productsCache;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}



// 測試資料生成函數（模擬真實商品）
function generateTestData() {
    return [
        {
            id: '101680278116',
            name: '日本製 象印 Elephant 象牌 吊重能力 250KG 手搖吊車 手拉吊車 鍊條吊車 0.25T-1M',
            price: 5500,
            imageUrl: 'https://img.yec.tw/cl/api/res/1.2/MZ9FC8XDJkMRpOvIXH8WRw--/YXBwaWQ9eXR3YXVjdGlvbnNlcnZpY2U7Zmk9ZmlsbDtoPTIyMDtxPTg1O3JvdGF0ZT1hdXRvO3NyPTEuMjtzcz0xLjI7dz0yMjA-/https://img.yec.tw/ob/image/8e415ac5-e01e-4ca9-a977-6e84004df540.jpg',
            link: 'https://tw.bid.yahoo.com/item/101680278116',
            updateTime: new Date().toISOString()
        },
        {
            id: '101677371509',
            name: 'makita 牧田 6501 高轉速 2分 電鑽 4500轉 9成新 中古/二手/日本原裝',
            price: 2100,
            imageUrl: 'https://img.yec.tw/cl/api/res/1.2/Ahr3hMWSyhay2ZJgNvqM4A--/YXBwaWQ9eXR3YXVjdGlvbnNlcnZpY2U7Zmk9ZmlsbDtoPTIyMDtxPTg1O3JvdGF0ZT1hdXRvO3NyPTEuMjtzcz0xLjI7dz0yMjA-/https://img.yec.tw/ob/image/01003fec-d776-46bf-a65b-f886f11686f8.jpg',
            link: 'https://tw.bid.yahoo.com/item/101677371509',
            updateTime: new Date().toISOString()
        },
        {
            id: '101676821697',
            name: 'makita 牧田 3600HA 木工雕刻機 2HP 修邊機9成5新 12mm/中古/二手/日本原裝',
            price: 9000,
            imageUrl: 'https://img.yec.tw/cl/api/res/1.2/8uLsIKsZ5J.AWPgVdUC.Fw--/YXBwaWQ9eXR3YXVjdGlvbnNlcnZpY2U7Zmk9ZmlsbDtoPTIyMDtxPTg1O3JvdGF0ZT1hdXRvO3NyPTEuMjtzcz0xLjI7dz0yMjA-/https://img.yec.tw/ob/image/68f12df6-1716-47e7-aa1d-fda1009039c5.jpg',
            link: 'https://tw.bid.yahoo.com/item/101676821697',
            updateTime: new Date().toISOString()
        },
        {
            id: '101676547219',
            name: '德國 BOSCH 博世 GST 90 BE/N 專業級 線鋸機 曲線鋸/中古/二手',
            price: 4000,
            imageUrl: 'https://img.yec.tw/cl/api/res/1.2/oaYfaFPZb0zRIb5OaAONqQ--/YXBwaWQ9eXR3YXVjdGlvbnNlcnZpY2U7Zmk9ZmlsbDtoPTIyMDtxPTg1O3JvdGF0ZT1hdXRvO3NyPTEuMjtzcz0xLjI7dz0yMjA-/https://img.yec.tw/ob/image/bc930a47-e995-4df3-ac94-31ba98355c5e.jpg',
            link: 'https://tw.bid.yahoo.com/item/101676547219',
            updateTime: new Date().toISOString()
        },
        {
            id: '101675713080',
            name: 'Milwaukee 美沃奇 M18B2 18V 2.0AH 鋰電池 48-11-1820 原廠公司貨',
            price: 1250,
            imageUrl: 'https://img.yec.tw/cl/api/res/1.2/9rlBtprfrqTaGWTGHcrJWA--/YXBwaWQ9eXR3YXVjdGlvbnNlcnZpY2U7Zmk9ZmlsbDtoPTIyMDtxPTg1O3JvdGF0ZT1hdXRvO3NyPTEuMjtzcz0xLjI7dz0yMjA-/https://img.yec.tw/ob/image/d7a4c7e3-99aa-4c8d-8d1a-0a9085a025c4.jpg',
            link: 'https://tw.bid.yahoo.com/item/101675713080',
            updateTime: new Date().toISOString()
        }
    ];
}

// API路由 - 取得商品列表（智慧更新）
app.get('/api/products', async (req, res) => {
    try {
        const forceFullUpdate = req.query.full === 'true'; // 允許強制完整更新
        const now = new Date();
        
        // 首次載入或強制完整更新
        if (!isUpdating && (productsCache.length === 0 || forceFullUpdate)) {
            isUpdating = true;
            console.log('執行完整商品抓取...');
            try {
                await fetchYahooAuctionProducts();
                
                if (productsCache.length === 0) {
                    console.log('抓取失敗，使用測試資料');
                    productsCache = generateTestData();
                    lastUpdateTime = new Date();
                }
            } finally {
                isUpdating = false;
            }
        }
        // 智慧更新邏輯：超過5分鐘且距離上次完整掃描超過2小時，或超過30分鐘
        else if (!isUpdating && lastUpdateTime && 
                ((now - lastUpdateTime) > 5 * 60 * 1000 && 
                 (!lastFullScanTime || (now - lastFullScanTime) > 2 * 60 * 60 * 1000)) ||
                (now - lastUpdateTime) > 30 * 60 * 1000) {
            
            isUpdating = true;
            try {
                // 先進行快速變更檢測
                const { changesDetected } = await quickChangeDetection();
                
                if (changesDetected) {
                    console.log('檢測到商品變更，執行完整更新...');
                    await fetchYahooAuctionProducts();
                } else {
                    console.log('未檢測到商品變更，跳過完整更新');
                    lastUpdateTime = new Date(); // 更新檢查時間
                }
            } finally {
                isUpdating = false;
            }
        }
        
        res.json({
            success: true,
            products: productsCache,
            lastUpdate: lastUpdateTime,
            lastFullScan: lastFullScanTime,
            total: productsCache.length
        });
    } catch (error) {
        console.error('API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 手動快速檢測更新
app.get('/api/check-updates', async (req, res) => {
    try {
        if (isUpdating) {
            return res.json({
                success: false,
                message: '系統正在更新中，請稍後再試'
            });
        }

        const { changesDetected, newProductsCount, modifiedProductsCount } = await quickChangeDetection();
        
        res.json({
            success: true,
            changesDetected,
            newProductsCount,
            modifiedProductsCount,
            message: changesDetected ? 
                `發現變更：新增 ${newProductsCount} 個商品，修改 ${modifiedProductsCount} 個商品` :
                '未發現商品變更'
        });
    } catch (error) {
        console.error('快速檢測 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 手動觸發完整更新
app.get('/api/force-update', async (req, res) => {
    try {
        if (isUpdating) {
            return res.json({
                success: false,
                message: '系統正在更新中，請稍後再試'
            });
        }

        isUpdating = true;
        console.log('手動觸發完整更新...');
        
        try {
            await fetchYahooAuctionProducts();
            res.json({
                success: true,
                message: `完整更新完成，共 ${productsCache.length} 個商品`,
                total: productsCache.length,
                lastUpdate: lastUpdateTime
            });
        } finally {
            isUpdating = false;
        }
    } catch (error) {
        isUpdating = false;
        console.error('強制更新 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 強制更新商品資料
app.post('/api/refresh', async (req, res) => {
    try {
        console.log('強制更新商品資料...');
        const products = await fetchYahooAuctionProducts();
        
        // 如果抓取失敗，使用測試資料
        if (products.length === 0) {
            console.log('抓取失敗，使用測試資料');
            productsCache = generateTestData();
            lastUpdateTime = new Date();
        }
        
        res.json({
            success: true,
            products: productsCache,
            lastUpdate: lastUpdateTime,
            total: productsCache.length
        });
    } catch (error) {
        console.error('強制更新錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 匯出Excel
app.get('/api/export', async (req, res) => {
    try {
        // 確保有最新資料
        if (!isUpdating && productsCache.length === 0) {
            isUpdating = true;
            try {
                await fetchYahooAuctionProducts();
            } finally {
                isUpdating = false;
            }
        }

        // 建立新的工作簿
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('商品列表');

        // 設定欄位
        worksheet.columns = [
            { header: '商品編號', key: 'id', width: 15 },
            { header: '商品名稱', key: 'name', width: 40 },
            { header: '價格', key: 'price', width: 12 },
            { header: '圖片連結', key: 'image', width: 20 },
            { header: '商品連結', key: 'link', width: 20 },
            { header: '更新時間', key: 'updateTime', width: 18 }
        ];

        // 設定標題列樣式
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // 設定列高以容納圖片
        worksheet.getRow(1).height = 30; // 標題列
        
        console.log(`開始處理 ${productsCache.length} 個商品的Excel匯出...`);
        
        // 加入所有商品資料
        productsCache.forEach((product, index) => {
            const rowIndex = index + 2; // 從第2列開始（第1列是標題）
            
            // 加入基本資料
            worksheet.addRow({
                id: product.id,
                name: product.name,
                price: `NT$ ${product.price.toLocaleString()}`,
                image: '點擊查看圖片', // 圖片欄位顯示文字，但會是超連結
                link: '點擊查看商品', // 商品連結
                updateTime: new Date(product.updateTime || new Date()).toLocaleString('zh-TW')
            });
            
            // 為圖片網址建立超連結
            const imageCell = worksheet.getCell(rowIndex, 4); // 第4欄是圖片欄
            if (product.imageUrl && !product.imageUrl.includes('item-no-image.svg')) {
                imageCell.value = {
                    text: '🖼️ 點擊查看圖片',
                    hyperlink: product.imageUrl
                };
                imageCell.font = { 
                    color: { argb: 'FF009900' }, 
                    underline: true 
                };
            } else {
                imageCell.value = '📷 無圖片';
                imageCell.font = { 
                    color: { argb: 'FF999999' }
                };
            }
            imageCell.alignment = { vertical: 'middle', horizontal: 'center' };
            
            // 為商品連結建立超連結
            const linkCell = worksheet.getCell(rowIndex, 5); // 第5欄是連結欄
            linkCell.value = {
                text: '🔗 點擊查看商品',
                hyperlink: product.link
            };
            linkCell.font = { 
                color: { argb: 'FF0066CC' }, 
                underline: true 
            };
            linkCell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        
        console.log(`Excel資料處理完成！處理了 ${productsCache.length} 個商品`);

        // 設定邊框
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // 設定回應標頭
        const fileName = `商品列表_${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);

        // 輸出Excel檔案
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('匯出Excel時發生錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 設定定時更新 - 每30分鐘自動更新一次（適合Render持續運行）
setInterval(async () => {
    if (!isUpdating) {
        console.log('執行定時更新...');
        isUpdating = true;
        try {
            await fetchYahooAuctionProducts();
        } catch (error) {
            console.error('定時更新失敗:', error);
        } finally {
            isUpdating = false;
        }
    }
}, 30 * 60 * 1000); // 30分鐘

// 啟動時立即抓取一次資料
setTimeout(() => {
    if (!isUpdating) {
        console.log('啟動初始化抓取...');
        fetchYahooAuctionProducts().catch(console.error);
    }
}, 5000); // 延遲5秒啟動

// 啟動伺服器（僅在直接執行時啟動）
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`伺服器運行在 http://localhost:${PORT}`);
        console.log('正在初始化並抓取商品資料...');
    });
}

// 導出app以供Vercel使用
module.exports = app;
