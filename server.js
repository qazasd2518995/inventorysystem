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
const session = require('express-session');
const bcrypt = require('bcryptjs');
// const sharp = require('sharp'); // 移除sharp依賴以適合Vercel部署

const app = express();
const PORT = process.env.PORT || 3000;

// 登入系統配置
const LOGIN_CREDENTIALS = {
    username: '2518995',
    password: '2518995'
};

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 會話管理設定
app.use(session({
    secret: 'yahoo-auction-secret-2518995',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // 在生產環境中應設為 true (需要 HTTPS)
        maxAge: 24 * 60 * 60 * 1000 // 24小時
    }
}));

// 儲存商品資料的變數
let productsCache = [];
let lastUpdateTime = null;
let isUpdating = false; // 防止重複更新的旗標
let lastFullScanTime = null; // 上次完整掃描時間
let productHashMap = new Map(); // 商品雜湊對照表，用於快速檢測變更
let updateLogs = []; // 更新日誌陣列
const MAX_LOGS = 100; // 最多保留100條日誌

// 移除圖片下載和壓縮功能以適合Vercel部署

// 驗證登入中間件
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    } else {
        return res.status(401).json({
            success: false,
            error: '需要登入才能存取此功能',
            requireLogin: true
        });
    }
}

// 產生商品雜湊值的函數
function generateProductHash(product) {
    const hashString = `${product.id}-${product.name}-${product.price}-${product.imageUrl}`;
    return crypto.createHash('md5').update(hashString).digest('hex');
}

// 添加更新日誌的函數
function addUpdateLog(type, message, details = null) {
    const logEntry = {
        id: Date.now() + Math.random(), // 簡單的唯一ID
        timestamp: new Date().toISOString(),
        type, // 'info', 'success', 'warning', 'error', 'new', 'modified', 'removed'
        message,
        details
    };
    
    updateLogs.unshift(logEntry); // 新日誌在前
    
    // 保持日誌數量在限制內
    if (updateLogs.length > MAX_LOGS) {
        updateLogs = updateLogs.slice(0, MAX_LOGS);
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// 比較商品差異並記錄變更
function compareAndLogChanges(oldProducts, newProducts) {
    const oldProductsMap = new Map(oldProducts.map(p => [p.id, p]));
    const newProductsMap = new Map(newProducts.map(p => [p.id, p]));
    
    let newCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;
    
    // 檢查新增和修改的商品
    for (const [id, newProduct] of newProductsMap) {
        const oldProduct = oldProductsMap.get(id);
        
        if (!oldProduct) {
            // 新商品
            newCount++;
            addUpdateLog('new', `新增商品：${newProduct.name}`, {
                productId: id,
                name: newProduct.name,
                price: newProduct.price,
                link: newProduct.link
            });
        } else {
            // 檢查是否有修改
            const oldHash = generateProductHash(oldProduct);
            const newHash = generateProductHash(newProduct);
            
            if (oldHash !== newHash) {
                modifiedCount++;
                const changes = [];
                
                if (oldProduct.name !== newProduct.name) {
                    changes.push(`名稱: "${oldProduct.name}" → "${newProduct.name}"`);
                }
                if (oldProduct.price !== newProduct.price) {
                    changes.push(`價格: $${oldProduct.price} → $${newProduct.price}`);
                }
                if (oldProduct.imageUrl !== newProduct.imageUrl) {
                    changes.push(`圖片已更新`);
                }
                
                addUpdateLog('modified', `商品已修改：${newProduct.name}`, {
                    productId: id,
                    name: newProduct.name,
                    changes,
                    link: newProduct.link
                });
            }
        }
    }
    
    // 檢查移除的商品
    for (const [id, oldProduct] of oldProductsMap) {
        if (!newProductsMap.has(id)) {
            removedCount++;
            addUpdateLog('removed', `商品已下架：${oldProduct.name}`, {
                productId: id,
                name: oldProduct.name,
                price: oldProduct.price,
                link: oldProduct.link
            });
        }
    }
    
    // 總結日誌
    if (newCount > 0 || modifiedCount > 0 || removedCount > 0) {
        addUpdateLog('success', `商品更新完成：新增 ${newCount} 個，修改 ${modifiedCount} 個，下架 ${removedCount} 個`, {
            summary: { newCount, modifiedCount, removedCount, totalProducts: newProducts.length }
        });
    } else {
        addUpdateLog('info', '商品檢查完成，未發現變更');
    }
    
    return { newCount, modifiedCount, removedCount };
}

// 快速檢測商品變更的函數
async function quickChangeDetection() {
    console.log('正在進行快速變更檢測...');
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            headless: 'new',
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
                '--single-process'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 60000
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
            
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 90000 });
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

// 全面檢測商品變更的函數（使用漸進式抓取）
async function fullChangeDetection() {
    console.log('正在進行全面商品變更檢測（漸進式）...');
    
    // 直接使用漸進式抓取，它會自動更新快取並記錄變更
    const result = await fetchYahooAuctionProductsProgressive();
    
    return {
        changesDetected: true, // 總是返回有變更，因為漸進式抓取會處理變更檢測
        newProductsCount: 0, // 這些數字會在漸進式抓取中處理
        modifiedProductsCount: 0,
        removedProductsCount: 0,
        totalProducts: result.length,
        totalPages: Math.ceil(result.length / 60), // 估算頁數
        currentProducts: result
    };
}

// 部分更新商品資料的函數
async function partialUpdateProducts(detectionResult) {
    if (!detectionResult.changesDetected) {
        addUpdateLog('info', '無需更新，商品資料已是最新');
        return productsCache;
    }

    const { currentProducts, newProductsCount, modifiedProductsCount, removedProductsCount } = detectionResult;
    
    addUpdateLog('info', `開始部分更新：新增 ${newProductsCount}，修改 ${modifiedProductsCount}，移除 ${removedProductsCount}`);

    // 為新的商品資料添加更新時間
    const productsWithTime = currentProducts.map(product => ({
        ...product,
        updateTime: new Date().toISOString()
    }));

    // 比較並記錄變更
    if (productsCache.length > 0) {
        compareAndLogChanges(productsCache, productsWithTime);
    }

    // 更新快取
    productsCache = productsWithTime;
    lastUpdateTime = new Date();
    
    // 更新商品雜湊對照表
    productHashMap.clear();
    productsWithTime.forEach(product => {
        const hash = generateProductHash(product);
        productHashMap.set(product.id, hash);
    });
    
    console.log(`部分更新完成，商品雜湊對照表已更新，共 ${productHashMap.size} 個商品`);
    addUpdateLog('success', `部分更新完成：共 ${productsWithTime.length} 個商品`);
    
    return productsWithTime;
}

// 輕量抓取函數 - 專為Render環境優化，限制頁面數量
async function fetchYahooAuctionProductsLight(maxPages = 5) {
    let allProducts = [];
    let browser = null;

    try {
        console.log(`正在啟動瀏覽器（輕量模式，最多 ${maxPages} 頁）...`);
        browser = await puppeteer.launch({
            headless: 'new',
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
                '--single-process',
                '--memory-pressure-off'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 60000
        });

        const page = await browser.newPage();
        
        // 設定更嚴格的資源限制
        await page.setViewport({ width: 1024, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 阻擋圖片和字體以節省資源
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'stylesheet') {
                req.abort();
            } else {
                req.continue();
            }
        });

        let currentPage = 1;

        while (currentPage <= maxPages) {
            console.log(`正在載入第 ${currentPage} 頁（輕量模式）...`);
            
            const pageUrl = currentPage === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?pg=${currentPage}`;
            
            // 載入頁面（縮短超時時間）
            await page.goto(pageUrl, { 
                waitUntil: 'domcontentloaded', // 改為更快的等待條件
                timeout: 30000 
            });

            // 縮短等待時間
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log(`正在抓取第 ${currentPage} 頁商品資料（輕量模式）...`);

            // 提取商品資料（簡化版）
            const products = await page.evaluate(() => {
                const items = [];
                const productElements = document.querySelectorAll('.item');
                
                // 限制每頁最多處理50個商品
                const maxItems = Math.min(productElements.length, 50);
                
                for (let i = 0; i < maxItems; i++) {
                    const element = productElements[i];
                    try {
                        const linkElement = element.querySelector('a[href*="item/"]');
                        if (!linkElement) continue;
                        
                        const href = linkElement.getAttribute('href');
                        const match = href.match(/item\/([^?]+)/);
                        if (!match) continue;
                        
                        const id = match[1];
                        const nameElement = element.querySelector('.name a, .title a, [title]');
                        const name = nameElement ? (nameElement.textContent || nameElement.getAttribute('title') || '').trim() : '';
                        
                        if (name && id) {
                            // 簡化的價格提取
                            const priceText = name;
                            let price = 0;
                            const priceMatch = priceText.match(/\$?([\d,]+)/);
                            if (priceMatch) {
                                price = parseInt(priceMatch[1].replace(/,/g, ''));
                            }
                            
                            const link = `https://tw.bid.yahoo.com${href}`;
                            
                            items.push({ 
                                id, 
                                name, 
                                price, 
                                imageUrl: 'https://via.placeholder.com/150x150?text=圖片', // 使用佔位圖片
                                link 
                            });
                        }
                    } catch (error) {
                        console.error('解析商品時發生錯誤:', error);
                    }
                }
                
                return items;
            });

            console.log(`第 ${currentPage} 頁找到 ${products.length} 個商品`);
            allProducts = allProducts.concat(products);

            // 檢查是否繼續（簡化檢查）
            if (products.length < 30) {
                console.log(`第 ${currentPage} 頁商品數量少於30個，停止抓取`);
                break;
            }

            currentPage++;
            
            // 避免請求過快
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`輕量模式總共抓取 ${allProducts.length} 個商品，共 ${currentPage - 1} 頁`);
        
        // 為每個商品添加更新時間
        const productsWithTime = allProducts.map(product => ({
            ...product,
            updateTime: new Date().toISOString()
        }));

        // 比較商品變更並記錄日誌（如果不是第一次抓取）
        if (productsCache.length > 0) {
            addUpdateLog('info', '開始比較商品變更（輕量模式）...');
            compareAndLogChanges(productsCache, productsWithTime);
        } else {
            addUpdateLog('success', `輕量模式抓取完成：共 ${productsWithTime.length} 個商品`);
        }

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
        console.error('輕量模式抓取商品資料時發生錯誤:', error.message);
        addUpdateLog('error', `輕量模式抓取失敗: ${error.message}`);
        
        // 如果抓取失敗，保持現有資料
        if (productsCache.length === 0) {
            console.log('抓取失敗且無現有資料，使用測試資料');
            productsCache = generateTestData();
            lastUpdateTime = new Date();
        } else {
            console.log('抓取失敗但保持現有資料');
        }
        
        return productsCache;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 漸進式抓取函數 - 邊抓取邊更新，適合Render環境
async function fetchYahooAuctionProductsProgressive() {
    let allProducts = [];
    let browser = null;
    let currentPage = 1;
    const maxPages = 50; // 安全上限
    const updateInterval = 3; // 每3頁更新一次快取

    try {
        console.log('開始漸進式抓取所有商品...');
        browser = await puppeteer.launch({
            headless: 'new',
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
                '--single-process',
                '--memory-pressure-off'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 60000
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1024, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 設定額外的請求頭
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });
        
        while (currentPage <= maxPages) {
            let pageUrl = '';
            
            try {
                console.log(`正在載入第 ${currentPage} 頁...`);
                
                pageUrl = currentPage === 1 
                    ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                    : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${currentPage}&mode=list`;
                
                console.log(`載入URL: ${pageUrl}`);
                
                await page.goto(pageUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 90000 
                });

                // 等待頁面載入
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // 滾動頁面確保所有商品載入
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 200;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;

                            if (totalHeight >= scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // 調試：檢查頁面是否正確載入
                const pageTitle = await page.title();
                const pageUrl = await page.url();
                console.log(`頁面載入完成 - 標題: ${pageTitle}, URL: ${pageUrl}`);
                
                console.log(`正在抓取第 ${currentPage} 頁商品資料...`);

                const products = await page.evaluate(() => {
                    const items = [];
                    
                    // 調試：查看頁面結構
                    console.log('頁面標題:', document.title);
                    console.log('頁面URL:', window.location.href);
                    
                    // 嘗試多種選擇器
                    let productElements = document.querySelectorAll('.item');
                    console.log('嘗試 .item:', productElements.length);
                    
                    if (productElements.length === 0) {
                        productElements = document.querySelectorAll('[data-item-id]');
                        console.log('嘗試 [data-item-id]:', productElements.length);
                    }
                    if (productElements.length === 0) {
                        productElements = document.querySelectorAll('.product-item, .auction-item, .list-item');
                        console.log('嘗試 .product-item 等:', productElements.length);
                    }
                    if (productElements.length === 0) {
                        const linkElements = document.querySelectorAll('a[href*="/item/"]');
                        console.log('找到商品連結:', linkElements.length);
                        productElements = Array.from(linkElements).map(link => link.closest('div, li, tr') || link.parentElement).filter(Boolean);
                        console.log('轉換為商品元素:', productElements.length);
                    }
                    
                    // 如果還是找不到，嘗試更廣泛的搜索
                    if (productElements.length === 0) {
                        const allLinks = document.querySelectorAll('a[href*="item"]');
                        console.log('所有包含 item 的連結:', allLinks.length);
                        
                        // 輸出前幾個連結供調試
                        for (let i = 0; i < Math.min(5, allLinks.length); i++) {
                            console.log(`連結 ${i + 1}:`, allLinks[i].href);
                        }
                        
                        productElements = Array.from(allLinks).map(link => link.closest('div, li, tr, td') || link.parentElement).filter(Boolean);
                        console.log('廣泛搜索找到商品元素:', productElements.length);
                    }
                    
                    console.log(`最終找到 ${productElements.length} 個商品元素`);
                    
                    productElements.forEach((element, index) => {
                        try {
                            // 尋找商品連結
                            let linkElement = element.querySelector('a[href*="item/"]');
                            if (!linkElement && element.tagName === 'A' && element.href.includes('item/')) {
                                linkElement = element;
                            }
                            
                            if (!linkElement) return;
                            
                            const href = linkElement.getAttribute('href');
                            const match = href.match(/item\/([^?]+)/);
                            if (!match) return;
                            
                            const id = match[1];
                            
                            // 嘗試多種方式獲取商品名稱
                            let name = '';
                            const nameSelectors = [
                                '.name a', '.title a', '[title]',
                                '.product-title', '.auction-title',
                                'h3 a', 'h4 a', '.item-title',
                                linkElement.getAttribute('title'),
                                linkElement.textContent
                            ];
                            
                            for (const selector of nameSelectors) {
                                if (typeof selector === 'string') {
                                    const nameElement = element.querySelector(selector);
                                    if (nameElement) {
                                        name = nameElement.textContent || nameElement.getAttribute('title') || '';
                                        if (name.trim()) break;
                                    }
                                } else if (selector) {
                                    name = selector;
                                    if (name.trim()) break;
                                }
                            }
                            
                            name = name.trim();
                            
                            if (name && id) {
                                // 價格提取 - 從名稱中提取
                                let price = 0;
                                const pricePatterns = [
                                    /\$\s?([\d,]+)/,
                                    /NT\$\s?([\d,]+)/,
                                    /價格[：:]\s?([\d,]+)/,
                                    /售價[：:]\s?([\d,]+)/,
                                    /([\d,]+)\s?元/,
                                    /^([\d,]+)$/
                                ];
                                
                                for (const pattern of pricePatterns) {
                                    const priceMatch = name.match(pattern);
                                    if (priceMatch) {
                                        price = parseInt(priceMatch[1].replace(/,/g, ''));
                                        if (price > 0) break;
                                    }
                                }
                                
                                // 如果名稱中沒有價格，嘗試從其他元素獲取
                                if (price === 0) {
                                    const priceElement = element.querySelector('.price, .cost, .amount, [class*="price"]');
                                    if (priceElement) {
                                        const priceText = priceElement.textContent || '';
                                        const priceMatch = priceText.match(/([\d,]+)/);
                                        if (priceMatch) {
                                            price = parseInt(priceMatch[1].replace(/,/g, ''));
                                        }
                                    }
                                }
                                
                                // 圖片提取
                                let imageUrl = '';
                                const imgElement = element.querySelector('img');
                                if (imgElement && imgElement.src && !imgElement.src.includes('item-no-image.svg')) {
                                    imageUrl = imgElement.src;
                                } else {
                                    // 尋找其他可能的圖片
                                    const allImgs = element.querySelectorAll('img');
                                    for (let img of allImgs) {
                                        if (img.src && !img.src.includes('item-no-image.svg') && !img.src.includes('loading')) {
                                            imageUrl = img.src;
                                            break;
                                        }
                                    }
                                }
                                
                                if (!imageUrl) {
                                    imageUrl = 'https://via.placeholder.com/150x150?text=無圖片';
                                }
                                
                                const link = href.startsWith('http') ? href : `https://tw.bid.yahoo.com${href}`;
                                
                                items.push({ id, name, price, imageUrl, link });
                                
                                if (index < 5) {
                                    console.log(`商品 ${index + 1}: ${name} - $${price}`);
                                }
                            }
                        } catch (error) {
                            console.error('解析商品時發生錯誤:', error);
                        }
                    });
                    
                    console.log(`成功解析 ${items.length} 個商品`);
                    return items;
                });

                console.log(`第 ${currentPage} 頁找到 ${products.length} 個商品`);
                allProducts = allProducts.concat(products);

                // 每隔幾頁更新一次快取，讓用戶看到即時進度
                if (currentPage % updateInterval === 0 || products.length === 0) {
                    const productsWithTime = allProducts.map(product => ({
                        ...product,
                        updateTime: new Date().toISOString()
                    }));
                    
                    // 更新快取
                    productsCache = productsWithTime;
                    lastUpdateTime = new Date();
                    
                    // 更新雜湊對照表
                    productHashMap.clear();
                    productsWithTime.forEach(product => {
                        const hash = generateProductHash(product);
                        productHashMap.set(product.id, hash);
                    });
                    
                    addUpdateLog('info', `漸進式更新：已抓取 ${allProducts.length} 個商品（第 ${currentPage} 頁）`);
                    console.log(`已更新快取：${allProducts.length} 個商品`);
                }

                // 檢查是否還有下一頁
                const hasNextPage = await page.evaluate(() => {
                    // 檢查分頁連結
                    const nextLinks = document.querySelectorAll('a');
                    for (let link of nextLinks) {
                        if (link.textContent.includes('下一頁') || link.textContent.includes('Next')) {
                            return true;
                        }
                    }
                    
                    // 檢查頁碼
                    const pageLinks = document.querySelectorAll('a[href*="&pg="], a[href*="?pg="]');
                    const currentPageNum = parseInt(window.location.search.match(/[?&]pg=(\d+)/)?.[1] || '1');
                    
                    for (let link of pageLinks) {
                        const pageMatch = link.href.match(/[?&]pg=(\d+)/);
                        if (pageMatch && parseInt(pageMatch[1]) > currentPageNum) {
                            return true;
                        }
                    }
                    
                    return false;
                });

                // 如果沒有商品或沒有下一頁，停止抓取
                if (products.length === 0 || !hasNextPage) {
                    console.log(`第 ${currentPage} 頁為最後一頁，停止抓取`);
                    break;
                }

                currentPage++;
                
                // 避免請求過快
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (pageError) {
                console.error(`抓取第 ${currentPage} 頁時發生錯誤 (URL: ${pageUrl}):`, pageError.message);
                addUpdateLog('error', `抓取第 ${currentPage} 頁失敗: ${pageError.message}`);
                
                // 如果是超時錯誤，嘗試繼續下一頁
                if (pageError.message.includes('timeout') || pageError.message.includes('Navigation')) {
                    console.log('頁面超時，嘗試繼續下一頁...');
                    currentPage++;
                    continue;
                } else {
                    console.log('嚴重錯誤，停止抓取');
                    break;
                }
            }
        }

        console.log(`漸進式抓取完成！總共成功抓取 ${allProducts.length} 個商品，共 ${currentPage - 1} 頁`);
        
        // 最終更新
        const productsWithTime = allProducts.map(product => ({
            ...product,
            updateTime: new Date().toISOString()
        }));

        // 比較商品變更並記錄日誌
        if (productsCache.length > 0) {
            addUpdateLog('info', '開始比較商品變更...');
            compareAndLogChanges(productsCache, productsWithTime);
        } else {
            addUpdateLog('success', `漸進式抓取完成：共 ${productsWithTime.length} 個商品`);
        }

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
        console.error('漸進式抓取商品資料時發生錯誤:', error.message);
        addUpdateLog('error', `漸進式抓取失敗: ${error.message}`);
        
        // 如果抓取失敗，保持現有資料
        if (productsCache.length === 0) {
            console.log('抓取失敗且無現有資料，使用測試資料');
            productsCache = generateTestData();
            lastUpdateTime = new Date();
        } else {
            console.log(`抓取失敗但保持現有資料：${productsCache.length} 個商品`);
        }
        
        return productsCache;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// 爬蟲函數 - 使用 Puppeteer 抓取奇摩拍賣商品資料（完整版）
async function fetchYahooAuctionProducts() {
    // 使用漸進式抓取，適合所有環境
    return await fetchYahooAuctionProductsProgressive();
    
    let allProducts = [];
    let browser = null;

    try {
        console.log('正在啟動瀏覽器（完整模式）...');
        browser = await puppeteer.launch({
            headless: 'new',
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
                '--single-process'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 60000
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
                timeout: 90000 
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

        // 比較商品變更並記錄日誌（如果不是第一次抓取）
        if (productsCache.length > 0) {
            addUpdateLog('info', '開始比較商品變更...');
            compareAndLogChanges(productsCache, productsWithTime);
        } else {
            addUpdateLog('success', `首次抓取完成：共 ${productsWithTime.length} 個商品`);
        }

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

// API路由 - 健康檢查（不需要認證）
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        isUpdating,
        productsCount: productsCache.length,
        lastUpdate: lastUpdateTime
    });
});

// API路由 - 登入
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: '請輸入帳號和密碼'
            });
        }
        
        // 驗證帳號密碼
        if (username === LOGIN_CREDENTIALS.username && password === LOGIN_CREDENTIALS.password) {
            req.session.authenticated = true;
            req.session.username = username;
            
            addUpdateLog('info', `用戶 ${username} 登入成功`);
            
            res.json({
                success: true,
                message: '登入成功',
                user: {
                    username: username,
                    loginTime: new Date().toISOString()
                }
            });
        } else {
            addUpdateLog('warning', `登入失敗：帳號 ${username} 密碼錯誤`);
            
            res.status(401).json({
                success: false,
                error: '帳號或密碼錯誤'
            });
        }
    } catch (error) {
        console.error('登入 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 登出
app.post('/api/logout', (req, res) => {
    try {
        const username = req.session.username;
        
        req.session.destroy((err) => {
            if (err) {
                console.error('登出錯誤:', err);
                return res.status(500).json({
                    success: false,
                    error: '登出失敗'
                });
            }
            
            addUpdateLog('info', `用戶 ${username || '未知'} 登出`);
            
            res.json({
                success: true,
                message: '登出成功'
            });
        });
    } catch (error) {
        console.error('登出 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 檢查登入狀態
app.get('/api/auth-status', (req, res) => {
    try {
        const isAuthenticated = req.session && req.session.authenticated;
        
        res.json({
            success: true,
            authenticated: isAuthenticated,
            user: isAuthenticated ? {
                username: req.session.username,
                loginTime: req.session.cookie.expires
            } : null
        });
    } catch (error) {
        console.error('檢查登入狀態 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 取得商品列表（智慧更新）
app.get('/api/products', requireAuth, async (req, res) => {
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
                // 進行全面商品變更檢測
                addUpdateLog('info', '開始全面商品變更檢測...');
                const detectionResult = await fullChangeDetection();
                
                if (detectionResult.changesDetected) {
                    const { newProductsCount, modifiedProductsCount, removedProductsCount } = detectionResult;
                    addUpdateLog('warning', `檢測到商品變更（新增 ${newProductsCount} 個，修改 ${modifiedProductsCount} 個，移除 ${removedProductsCount} 個），執行部分更新...`);
                    await partialUpdateProducts(detectionResult);
                } else {
                    addUpdateLog('info', '未檢測到商品變更，跳過更新');
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
            total: productsCache.length,
            recentLogs: updateLogs.slice(0, 5) // 回傳最新的5條日誌
        });
    } catch (error) {
        console.error('API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 手動全面檢測更新
app.get('/api/check-updates', requireAuth, async (req, res) => {
    try {
        if (isUpdating) {
            return res.json({
                success: false,
                message: '系統正在更新中，請稍後再試'
            });
        }

        addUpdateLog('info', '手動觸發全面商品變更檢測...');
        const detectionResult = await fullChangeDetection();
        
        res.json({
            success: true,
            ...detectionResult,
            message: detectionResult.changesDetected ? 
                `發現變更：新增 ${detectionResult.newProductsCount} 個，修改 ${detectionResult.modifiedProductsCount} 個，移除 ${detectionResult.removedProductsCount} 個商品` :
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

// API路由 - 手動觸發部分更新（檢測並更新變更）
app.get('/api/partial-update', requireAuth, async (req, res) => {
    try {
        if (isUpdating) {
            return res.json({
                success: false,
                message: '系統正在更新中，請稍後再試'
            });
        }

        isUpdating = true;
        addUpdateLog('info', '手動觸發部分更新...');
        
        try {
            // 先檢測變更
            const detectionResult = await fullChangeDetection();
            
            if (detectionResult.changesDetected) {
                // 執行部分更新
                await partialUpdateProducts(detectionResult);
                
                res.json({
                    success: true,
                    message: `部分更新完成：新增 ${detectionResult.newProductsCount} 個，修改 ${detectionResult.modifiedProductsCount} 個，移除 ${detectionResult.removedProductsCount} 個商品`,
                    products: productsCache,
                    lastUpdate: lastUpdateTime,
                    total: productsCache.length,
                    updateStats: {
                        newProducts: detectionResult.newProductsCount,
                        modifiedProducts: detectionResult.modifiedProductsCount,
                        removedProducts: detectionResult.removedProductsCount,
                        totalProducts: detectionResult.totalProducts,
                        totalPages: detectionResult.totalPages
                    }
                });
            } else {
                res.json({
                    success: true,
                    message: '未發現商品變更，無需更新',
                    products: productsCache,
                    lastUpdate: lastUpdateTime,
                    total: productsCache.length
                });
            }
        } finally {
            isUpdating = false;
        }
    } catch (error) {
        console.error('部分更新 API 錯誤:', error);
        addUpdateLog('error', `部分更新失敗: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 手動觸發完整更新
app.get('/api/force-update', requireAuth, async (req, res) => {
    try {
        if (isUpdating) {
            return res.json({
                success: false,
                message: '系統正在更新中，請稍後再試'
            });
        }

        isUpdating = true;
        addUpdateLog('info', '手動觸發完整更新...');
        
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

// API路由 - 獲取更新日誌
app.get('/api/update-logs', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const type = req.query.type; // 可選：篩選特定類型的日誌
        
        let filteredLogs = updateLogs;
        
        // 按類型篩選
        if (type) {
            filteredLogs = updateLogs.filter(log => log.type === type);
        }
        
        // 分頁
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            logs: paginatedLogs,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(filteredLogs.length / limit),
                totalLogs: filteredLogs.length,
                hasMore: endIndex < filteredLogs.length
            },
            summary: {
                totalLogs: updateLogs.length,
                lastUpdate: lastUpdateTime,
                lastFullScan: lastFullScanTime,
                isUpdating
            }
        });
    } catch (error) {
        console.error('獲取更新日誌 API 錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 清除更新日誌
app.delete('/api/update-logs', requireAuth, async (req, res) => {
    try {
        const oldCount = updateLogs.length;
        updateLogs = [];
        
        addUpdateLog('info', `手動清除了 ${oldCount} 條更新日誌`);
        
        res.json({
            success: true,
            message: `已清除 ${oldCount} 條更新日誌`,
            remainingLogs: updateLogs.length
        });
    } catch (error) {
        console.error('清除更新日誌 API 錯誤:', error);
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
app.get('/api/export', requireAuth, async (req, res) => {
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

// 設定定時更新 - 每10分鐘檢查一次更新
setInterval(async () => {
    if (!isUpdating) {
        console.log('執行定時檢查更新...');
        isUpdating = true;
        try {
            // 使用快速檢測模式檢查是否有變更
            const detectionResult = await fullChangeDetection();
            if (detectionResult.changesDetected) {
                console.log('檢測到變更，執行部分更新...');
                await partialUpdateProducts(detectionResult);
            } else {
                console.log('未檢測到變更');
            }
        } catch (error) {
            console.error('定時檢查更新失敗:', error);
            addUpdateLog('error', `定時檢查更新失敗: ${error.message}`);
        } finally {
            isUpdating = false;
        }
    }
}, 10 * 60 * 1000); // 10分鐘

// 啟動時立即執行完整抓取
setTimeout(async () => {
    if (!isUpdating) {
        console.log('啟動初始化，開始完整抓取商品資料...');
        isUpdating = true;
        try {
            // 先載入測試資料讓系統可用
            productsCache = generateTestData();
            lastUpdateTime = new Date();
            addUpdateLog('info', '系統啟動，載入測試資料，開始完整抓取...');
            
            // 立即執行完整抓取
            await fetchYahooAuctionProducts();
            
            addUpdateLog('success', '系統啟動完成，商品資料抓取完畢');
            console.log('系統初始化完成，商品資料已更新');
        } catch (error) {
            console.error('初始化抓取失敗:', error);
            addUpdateLog('error', `初始化抓取失敗: ${error.message}`);
            // 保持測試資料
        } finally {
            isUpdating = false;
        }
    }
}, 10000); // 延遲10秒啟動，讓系統穩定

// 啟動伺服器（僅在直接執行時啟動）
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`伺服器運行在 http://localhost:${PORT}`);
        console.log('正在初始化並抓取商品資料...');
    });
}

// 導出app以供Vercel使用
module.exports = app;

