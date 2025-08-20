require('dotenv').config();
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

// 引入資料庫模組
const {
    initializeDatabase,
    upsertProducts,
    getActiveProducts,
    getProductStats,
    compareAndUpdateProducts,
    addUpdateLogToDB,
    getUpdateLogs,
    clearUpdateLogs,
    testConnection
} = require('./database');

// 引入資料庫爬蟲
const { fetchYahooAuctionProductsWithDB } = require('./database_scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// 登入系統配置
const LOGIN_CREDENTIALS = {
    username: process.env.LOGIN_USERNAME || '2518995',
    password: process.env.LOGIN_PASSWORD || '2518995'
};

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 會話管理設定
app.use(session({
    secret: process.env.SESSION_SECRET || 'yahoo-auction-secret-2518995',
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

// 添加更新日誌的函數（同時寫入記憶體和資料庫）
async function addUpdateLog(type, message, details = null) {
    const logEntry = {
        id: Date.now() + Math.random(), // 簡單的唯一ID
        timestamp: new Date().toISOString(),
        type, // 'info', 'success', 'warning', 'error', 'new', 'modified', 'removed'
        message,
        details
    };
    
    // 寫入記憶體（向後兼容）
    updateLogs.unshift(logEntry);
    if (updateLogs.length > MAX_LOGS) {
        updateLogs = updateLogs.slice(0, MAX_LOGS);
    }
    
    // 同時寫入資料庫
    try {
        await addUpdateLogToDB(type, message, details);
    } catch (error) {
        console.error('寫入資料庫日誌失敗:', error.message);
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// 計算圖片抓取統計
function calculateImageStats(products) {
    const totalProducts = products.length;
    const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
    const productsWithoutImages = totalProducts - productsWithImages;
    const imageSuccessRate = totalProducts > 0 ? ((productsWithImages / totalProducts) * 100).toFixed(1) : 0;
    
    return {
        total: totalProducts,
        withImages: productsWithImages,
        withoutImages: productsWithoutImages,
        successRate: imageSuccessRate
    };
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
        // 計算圖片統計
        const imageStats = calculateImageStats(newProducts);
        
        addUpdateLog('success', `商品更新完成：新增 ${newCount} 個，修改 ${modifiedCount} 個，下架 ${removedCount} 個 | 圖片：${imageStats.withImages}/${imageStats.total} (${imageStats.successRate}%)`, {
            summary: { 
                newCount, 
                modifiedCount, 
                removedCount, 
                totalProducts: newProducts.length,
                imageStats: {
                    total: imageStats.total,
                    withImages: imageStats.withImages,
                    withoutImages: imageStats.withoutImages,
                    successRate: `${imageStats.successRate}%`
                }
            }
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
    // 計算圖片統計
    const imageStats = calculateImageStats(productsWithTime);
    addUpdateLog('success', `部分更新完成：共 ${productsWithTime.length} 個商品 | 圖片：${imageStats.withImages}/${imageStats.total} (${imageStats.successRate}%)`, {
        imageStats: {
            total: imageStats.total,
            withImages: imageStats.withImages,
            withoutImages: imageStats.withoutImages,
            successRate: `${imageStats.successRate}%`
        }
    });
    
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
            const imageStats = calculateImageStats(productsWithTime);
            addUpdateLog('success', `輕量模式抓取完成：共 ${productsWithTime.length} 個商品 | 圖片：${imageStats.withImages}/${imageStats.total} (${imageStats.successRate}%)`, {
                imageStats: {
                    total: imageStats.total,
                    withImages: imageStats.withImages,
                    withoutImages: imageStats.withoutImages,
                    successRate: `${imageStats.successRate}%`
                }
            });
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

// 並行快速抓取函數 - 同時處理多個頁面
async function fetchYahooAuctionProductsFast() {
    let allProducts = [];
    let browser = null;
    const maxPages = 50;
    // 根據環境調整併發度
    const isRenderEnvironment = process.env.RENDER || process.env.NODE_ENV === 'production';
    const concurrency = isRenderEnvironment ? 2 : 3; // Render環境降低併發度，減少資源競爭
    const updateInterval = 10; // 每10頁更新一次快取（因為並行處理更快）

    try {
        console.log('開始並行快速抓取所有商品...');
        console.log(`環境檢測：${isRenderEnvironment ? 'Render生產環境' : '本地開發環境'}`);
        console.log(`併發設置：同時處理 ${concurrency} 個頁面`);
        
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
                '--memory-pressure-off',
                '--disable-plugins',
                // Render環境特殊優化
                ...(isRenderEnvironment ? [
                    '--max-old-space-size=1024', // 限制記憶體使用
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-ipc-flooding-protection',
                    '--single-process', // 單進程模式，減少記憶體佔用
                ] : [])
            ],
            timeout: 60000,
            defaultViewport: { width: 1024, height: 768 }
        });

        // 並行處理頁面
        for (let batch = 1; batch <= maxPages; batch += concurrency) {
            const batchPromises = [];
            const batchEnd = Math.min(batch + concurrency - 1, maxPages);
            
            console.log(`開始處理第 ${batch}-${batchEnd} 頁...`);
            
            for (let pageNum = batch; pageNum <= batchEnd; pageNum++) {
                batchPromises.push(scrapePage(browser, pageNum));
            }
            
            try {
                const batchResults = await Promise.allSettled(batchPromises);
                
                batchResults.forEach((result, index) => {
                    const pageNum = batch + index;
                    if (result.status === 'fulfilled') {
                        allProducts = allProducts.concat(result.value);
                        console.log(`第 ${pageNum} 頁成功：${result.value.length} 個商品`);
                    } else {
                        console.error(`第 ${pageNum} 頁失敗:`, result.reason?.message || result.reason);
                    }
                });
                
                // 定期更新快取
                if (batch % updateInterval === 1) {
                    const productsWithTime = allProducts.map(product => ({
                        ...product,
                        lastUpdated: new Date().toISOString()
                    }));
                    
                    productsCache = productsWithTime;
                    lastUpdateTime = new Date();
                    console.log(`[INFO] 並行更新：已抓取 ${allProducts.length} 個商品（第 ${batch}-${batchEnd} 頁）`);
                    console.log('已更新快取：', productsCache.length, '個商品');
                }
                
                // 檢查是否還有更多頁面
                if (batchResults.every(result => result.status === 'fulfilled' && result.value.length === 0)) {
                    console.log('所有頁面都沒有商品，停止抓取');
                    break;
                }
                
                // 批次間等待，根據環境調整
                const batchDelay = isRenderEnvironment ? 1500 : 500; // Render環境更長等待
                await new Promise(resolve => setTimeout(resolve, batchDelay));
                
            } catch (batchError) {
                console.error(`批次 ${batch}-${batchEnd} 處理失敗:`, batchError.message);
            }
        }

    } catch (error) {
        console.error('並行抓取失敗:', error);
        addUpdateLog('error', `並行抓取失敗: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    console.log(`並行抓取完成！總共成功抓取 ${allProducts.length} 個商品`);
    
    // 確保最後一批商品也更新到快取
    if (allProducts.length > 0) {
        const productsWithTime = allProducts.map(product => ({
            ...product,
            lastUpdated: new Date().toISOString()
        }));
        
        productsCache = productsWithTime;
        lastUpdateTime = new Date();
        console.log(`[FINAL] 最終更新快取：${allProducts.length} 個商品`);
        
        // 更新商品雜湊對照表
        productHashMap = new Map();
        allProducts.forEach(product => {
            const hash = crypto.createHash('md5').update(JSON.stringify({
                name: product.name,
                price: product.price
            })).digest('hex');
            productHashMap.set(product.id, hash);
        });
        
        lastFullScanTime = new Date();
        const imageStats = calculateImageStats(allProducts);
        addUpdateLog('success', `並行抓取完成：共 ${allProducts.length} 個商品 | 圖片：${imageStats.withImages}/${imageStats.total} (${imageStats.successRate}%)`, {
            imageStats: {
                total: imageStats.total,
                withImages: imageStats.withImages,
                withoutImages: imageStats.withoutImages,
                successRate: `${imageStats.successRate}%`
            }
        });
        console.log('已更新商品雜湊對照表，共', productHashMap.size, '個商品');
    }
    
    return allProducts;
}

// 單頁面抓取函數（用於並行處理）
async function scrapePage(browser, pageNum) {
    const page = await browser.newPage();
    
    try {
        // 禁用字體和樣式載入以加速，但保留圖片
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
            waitUntil: 'networkidle2', // 等待網絡請求完成，確保商品載入
            timeout: 30000 
        });

        // 更徹底的滾動觸發懶載入圖片
        await page.evaluate(() => {
            return new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 50; // 更小的步長，確保所有圖片都被觸發
                let scrollCount = 0;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    scrollCount++;

                    // 確保滾動到底部，並且多滾動幾次
                    if(totalHeight >= scrollHeight || scrollCount > 200){
                        // 滾動到頂部再滾動到底部，確保所有內容都被載入
                        window.scrollTo(0, 0);
                        setTimeout(() => {
                            window.scrollTo(0, document.body.scrollHeight);
                            clearInterval(timer);
                            resolve();
                        }, 500);
                    }
                }, 50); // 更快的滾動頻率
            });
        });

        // 針對Render環境的特殊優化
        const isRenderEnvironment = process.env.RENDER || process.env.NODE_ENV === 'production';
        
        if (isRenderEnvironment) {
            // Render環境：更長等待時間 + 額外的圖片載入檢查
            console.log(`第 ${pageNum} 頁：Render環境，使用加強載入模式...`);
            
            // 第一次等待：讓基本內容載入
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 檢查並等待圖片載入
            await page.evaluate(() => {
                return new Promise((resolve) => {
                    // 強制觸發所有懶載入圖片
                    const images = document.querySelectorAll('img[data-src], img[data-lazy-src], img[loading="lazy"]');
                    images.forEach(img => {
                        // 觸發懶載入
                        img.scrollIntoView({ behavior: 'instant', block: 'center' });
                        
                        // 手動設置src如果有data-src
                        const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
                        if (dataSrc && !img.src) {
                            img.src = dataSrc;
                        }
                    });
                    
                    // 等待圖片載入完成
                    setTimeout(resolve, 2000);
                });
            });
            
            // 第二次等待：確保所有圖片都載入完成
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            // 本地環境：標準等待時間
            await new Promise(resolve => setTimeout(resolve, 4000));
        }

        // 快速提取商品資料
        const products = await page.evaluate((envFlag) => {
            const items = [];
            const itemLinks = document.querySelectorAll('a[href*="item/"]');
            
            itemLinks.forEach((linkElement) => {
                try {
                    const href = linkElement.getAttribute('href');
                    const match = href.match(/item\/([^?]+)/);
                    if (!match) return;
                    
                    const id = match[1];
                    let name = linkElement.textContent.trim();
                    
                    if (!name) {
                        name = linkElement.getAttribute('title') || '';
                    }
                    
                    if (!name.trim()) return;
                    
                    // 快速價格提取
                    let price = 0;
                    const priceMatch = name.match(/\$\s?([\d,]+)|NT\$\s?([\d,]+)|([\d,]+)\s?元/);
                    if (priceMatch) {
                        price = parseInt((priceMatch[1] || priceMatch[2] || priceMatch[3] || '0').replace(/,/g, ''));
                    }
                    
                    // 圖片提取 - 更全面的搜索
                    let imageUrl = '';
                    const parentElement = linkElement.closest('div, li, tr, td, article') || linkElement.parentElement;
                    
                    if (parentElement) {
                        // 嘗試多種圖片選擇器 - 更全面的搜索
                        const imgSelectors = [
                            'img[src*="yahoo"]',
                            'img[src*="yimg"]', 
                            'img[src*="img.yec.tw"]',
                            'img[data-src*="yahoo"]',
                            'img[data-src*="yimg"]',
                            'img[data-src*="img.yec.tw"]',
                            'img[data-lazy-src*="yahoo"]',
                            'img[data-lazy-src*="yimg"]',
                            'img[data-lazy-src*="img.yec.tw"]',
                            'img[src*="s.yimg.com"]',
                            'img[data-src*="s.yimg.com"]',
                            'img[data-original*="yahoo"]',
                            'img[data-original*="yimg"]',
                            'img[data-original*="img.yec.tw"]',
                            'img[src]:not([src*="loading"]):not([src*="placeholder"]):not([src*="item-no-image"])',
                            'img[data-src]:not([data-src*="loading"]):not([data-src*="placeholder"])',
                            'img'
                        ];
                        
                        for (const selector of imgSelectors) {
                            const imgElement = parentElement.querySelector(selector);
                            if (imgElement) {
                                // 優先使用 data-src（懶載入圖片）
                                let src = imgElement.getAttribute('data-src') || 
                                         imgElement.getAttribute('data-lazy-src') ||
                                         imgElement.getAttribute('data-original') ||
                                         imgElement.getAttribute('data-img') ||
                                         imgElement.getAttribute('data-lazy') ||
                                         imgElement.getAttribute('data-image') ||
                                         imgElement.getAttribute('src');
                                
                                if (src && 
                                    !src.includes('item-no-image.svg') && 
                                    !src.includes('loading') &&
                                    !src.includes('placeholder') &&
                                    src.length > 10) {
                                    
                                    // 確保是完整URL
                                    if (src.startsWith('//')) {
                                        src = 'https:' + src;
                                    } else if (src.startsWith('/')) {
                                        src = 'https://tw.bid.yahoo.com' + src;
                                    }
                                    
                                    imageUrl = src;
                                    break;
                                }
                            }
                        }
                        
                        // 如果還是沒找到，嘗試在更大範圍內搜索
                        if (!imageUrl) {
                            // 擴大搜索範圍到更上層的父元素
                            const expandedParent = parentElement.closest('div, li, tr, td, article, section') || 
                                                 parentElement.parentElement?.parentElement || 
                                                 parentElement;
                                                 
                            const allImages = expandedParent.querySelectorAll('img');
                            for (const img of allImages) {
                                let src = img.getAttribute('data-src') || 
                                         img.getAttribute('data-lazy-src') ||
                                         img.getAttribute('src') ||
                                         img.getAttribute('data-original');
                                         
                                if (src && 
                                    (src.includes('yahoo') || src.includes('yimg') || src.includes('s.yimg.com') || src.includes('img.yec.tw')) && 
                                    !src.includes('loading') &&
                                    !src.includes('placeholder') &&
                                    !src.includes('item-no-image') &&
                                    src.length > 20) { // 確保URL足夠長
                                    
                                    if (src.startsWith('//')) {
                                        src = 'https:' + src;
                                    } else if (src.startsWith('/')) {
                                        src = 'https://tw.bid.yahoo.com' + src;
                                    }
                                    imageUrl = src;
                                    break;
                                }
                            }
                        }
                        
                        // 最後嘗試：檢查是否有base64圖片或其他格式
                        if (!imageUrl) {
                            const anyImages = parentElement.querySelectorAll('img');
                            for (const img of anyImages) {
                                let src = img.getAttribute('data-src') || img.getAttribute('src');
                                if (src && 
                                    src.length > 30 && 
                                    !src.includes('loading') && 
                                    !src.includes('placeholder') &&
                                    !src.includes('item-no-image') &&
                                    (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:'))) {
                                    
                                    if (src.startsWith('//')) {
                                        src = 'https:' + src;
                                    }
                                    imageUrl = src;
                                    break;
                                }
                            }
                        }
                    }
                    
                    const productUrl = href.startsWith('http') ? href : `https://tw.bid.yahoo.com${href}`;
                    
                    items.push({
                        id: id,
                        name: name,
                        price: price,
                        imageUrl: imageUrl,
                        url: productUrl,
                        scrapedAt: new Date().toISOString()
                    });
                    
                    // 調試：記錄前幾個商品的圖片情況
                    if (items.length <= 5) {
                        console.log(`[ENV: ${envFlag ? 'RENDER' : 'LOCAL'}] 商品 ${items.length} (ID: ${id}):`, 
                                  imageUrl ? '✅ 有圖片' : '❌ 無圖片', 
                                  imageUrl ? imageUrl.substring(0, 60) + '...' : '',
                                  `名稱: ${name.substring(0, 30)}...`);
                    }
                    
                } catch (error) {
                    // 忽略個別商品錯誤，繼續處理
                }
            });
            
            return items;
        }, isRenderEnvironment);

        return products;

    } catch (error) {
        console.error(`第 ${pageNum} 頁抓取錯誤:`, error.message);
        return [];
    } finally {
        await page.close();
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
            console.log(`正在載入第 ${currentPage} 頁...`);
            
            const pageUrl = currentPage === 1 
                ? 'https://tw.bid.yahoo.com/booth/Y1823944291'
                : `https://tw.bid.yahoo.com/booth/Y1823944291?userID=Y1823944291&catID=&catIDselect=&clf=&u=&s=&o=&pg=${currentPage}&mode=list`;
            
            console.log(`載入URL: ${pageUrl}`);
            
            try {
                console.log(`開始導航到: ${pageUrl}`);
                
                await page.goto(pageUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 90000 
                });
                
                console.log(`頁面導航成功: ${pageUrl}`);

                // 等待頁面載入
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // 檢查是否有載入指示器或需要更多等待時間
                const hasLoading = await page.evaluate(() => {
                    const loadingElements = document.querySelectorAll('.loading, .spinner, [class*="load"]');
                    const hasLoadingClass = loadingElements.length > 0;
                    const bodyText = document.body.textContent || '';
                    const hasLoadingText = bodyText.includes('載入中') || bodyText.includes('loading') || bodyText.includes('請稍候');
                    
                    console.log('載入指示器數量:', loadingElements.length);
                    console.log('是否包含載入文字:', hasLoadingText);
                    console.log('頁面內容長度:', bodyText.length);
                    
                    return hasLoadingClass || hasLoadingText;
                });
                
                if (hasLoading) {
                    console.log('檢測到載入指示器，額外等待5秒...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
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
                const currentUrl = await page.url();
                console.log(`頁面載入完成 - 標題: ${pageTitle}, URL: ${currentUrl}`);
                
                console.log(`正在抓取第 ${currentPage} 頁商品資料...`);

                // 先在 Node.js 端獲取頁面基本資訊
                const pageInfo = await page.evaluate(() => {
                    return {
                        title: document.title,
                        url: window.location.href,
                        htmlLength: document.documentElement.outerHTML.length,
                        bodyText: document.body.textContent || '',
                        bodyClassName: document.body.className,
                        bodyId: document.body.id
                    };
                });
                
                console.log('=== 頁面基本資訊 ===');
                console.log('標題:', pageInfo.title);
                console.log('URL:', pageInfo.url);
                console.log('HTML長度:', pageInfo.htmlLength);
                console.log('內容長度:', pageInfo.bodyText.length);
                console.log('Body類名:', pageInfo.bodyClassName);
                console.log('Body ID:', pageInfo.bodyId);
                
                // 檢查容器和連結
                const structureInfo = await page.evaluate(() => {
                    const containers = {};
                    const possibleContainers = [
                        'main', '#main', '.main-content', '.content',
                        '.product-list', '.item-list', '.auction-list',
                        '.results', '.search-results', '.booth-items'
                    ];
                    
                    possibleContainers.forEach(selector => {
                        const container = document.querySelector(selector);
                        if (container) {
                            containers[selector] = container.children.length;
                        }
                    });
                    
                    // 檢查所有包含商品ID的連結
                    const itemLinks = document.querySelectorAll('a[href*="item/"], a[href*="auction/"]');
                    const linkSamples = [];
                    for (let i = 0; i < Math.min(3, itemLinks.length); i++) {
                        linkSamples.push({
                            href: itemLinks[i].href,
                            text: itemLinks[i].textContent.trim().substring(0, 50)
                        });
                    }
                    
                    // 檢查錯誤元素
                    const errorElements = document.querySelectorAll('.error, .alert, .warning, [class*="error"]');
                    const errors = [];
                    errorElements.forEach(el => {
                        errors.push(el.textContent.trim());
                    });
                    
                    // 檢查登入元素
                    const loginElements = document.querySelectorAll('input[type="password"], .login, .signin, [class*="login"]');
                    
                    return {
                        containers,
                        itemLinksCount: itemLinks.length,
                        linkSamples,
                        errors,
                        needsLogin: loginElements.length > 0
                    };
                });
                
                console.log('=== 頁面結構分析 ===');
                console.log('找到的容器:', structureInfo.containers);
                console.log('商品連結數量:', structureInfo.itemLinksCount);
                if (structureInfo.linkSamples.length > 0) {
                    console.log('商品連結範例:');
                    structureInfo.linkSamples.forEach((link, i) => {
                        console.log(`  ${i + 1}. ${link.href}`);
                        console.log(`     文字: ${link.text}`);
                    });
                }
                if (structureInfo.errors.length > 0) {
                    console.log('發現錯誤訊息:', structureInfo.errors);
                }
                if (structureInfo.needsLogin) {
                    console.log('⚠️  可能需要登入');
                }

                const products = await page.evaluate(() => {
                    const items = [];
                    
                    // 調試：查看頁面結構
                    console.log('頁面標題:', document.title);
                    console.log('頁面URL:', window.location.href);
                    console.log('頁面HTML長度:', document.documentElement.outerHTML.length);
                    
                    // 檢查是否有常見的商品容器
                    const possibleContainers = [
                        'main', '#main', '.main-content', '.content',
                        '.product-list', '.item-list', '.auction-list',
                        '.results', '.search-results', '.booth-items'
                    ];
                    
                    possibleContainers.forEach(selector => {
                        const container = document.querySelector(selector);
                        if (container) {
                            console.log(`找到容器 ${selector}:`, container.children.length, '個子元素');
                        }
                    });
                    
                    // 檢查所有包含商品ID的連結
                    const allItemLinks = document.querySelectorAll('a[href*="item/"], a[href*="auction/"]');
                    console.log('所有商品相關連結數量:', allItemLinks.length);
                    
                    if (allItemLinks.length > 0) {
                        console.log('前3個商品連結:');
                        for (let i = 0; i < Math.min(3, allItemLinks.length); i++) {
                            console.log(`  ${i + 1}. ${allItemLinks[i].href}`);
                            console.log(`     文字: ${allItemLinks[i].textContent.trim().substring(0, 50)}`);
                        }
                    }
                    
                    // 直接使用商品連結進行解析（最可靠的方法）
                    const itemLinks = document.querySelectorAll('a[href*="item/"]');
                    console.log('找到商品連結數量:', itemLinks.length);
                    
                    if (itemLinks.length > 0) {
                        console.log('使用直接連結解析方法...');
                        
                        itemLinks.forEach((linkElement, index) => {
                            try {
                                const href = linkElement.getAttribute('href');
                                const match = href.match(/item\/([^?]+)/);
                                if (!match) return;
                                
                                const id = match[1];
                                let name = linkElement.textContent.trim();
                                
                                if (!name) {
                                    name = linkElement.getAttribute('title') || '';
                                }
                                
                                if (!name.trim()) return;
                                
                                // 價格提取
                                let price = 0;
                                const pricePatterns = [
                                    /\$\s?([\d,]+)/,
                                    /NT\$\s?([\d,]+)/,
                                    /([\d,]+)\s?元/
                                ];
                                
                                for (const pattern of pricePatterns) {
                                    const priceMatch = name.match(pattern);
                                    if (priceMatch) {
                                        price = parseInt(priceMatch[1].replace(/,/g, ''));
                                        if (price > 0) break;
                                    }
                                }
                                
                                // 圖片提取
                                let imageUrl = '';
                                const parentElement = linkElement.closest('div, li, tr, td') || linkElement.parentElement;
                                if (parentElement) {
                                    const imgElement = parentElement.querySelector('img');
                                    if (imgElement && imgElement.src && 
                                        !imgElement.src.includes('item-no-image.svg') && 
                                        !imgElement.src.includes('loading')) {
                                        imageUrl = imgElement.src;
                                    }
                                }
                                
                                const productUrl = href.startsWith('http') ? href : `https://tw.bid.yahoo.com${href}`;
                                
                                const product = {
                                    id: id,
                                    name: name,
                                    price: price,
                                    imageUrl: imageUrl,
                                    url: productUrl,
                                    scrapedAt: new Date().toISOString()
                                };
                                
                                items.push(product);
                                
                                if (index < 3) {
                                    console.log(`直接解析商品 ${index + 1}:`, {
                                        id: product.id,
                                        name: product.name.substring(0, 30) + '...',
                                        price: product.price,
                                        hasImage: !!product.imageUrl
                                    });
                                }
                                
                            } catch (error) {
                                console.log(`直接解析第 ${index + 1} 個商品錯誤:`, error.message);
                            }
                        });
                        
                        console.log(`直接解析成功 ${items.length} 個商品`);
                        return items;
                    }
                    
                    // 備用方法：嘗試多種選擇器（如果沒有找到連結）
                    let productElements = document.querySelectorAll('.item, [data-item-id], .product-item, .auction-item, .list-item');
                    console.log('備用方法：找到商品元素:', productElements.length);
                    
                    // 如果仍然找不到商品，輸出頁面的基本結構用於調試
                    if (productElements.length === 0) {
                        console.log('=== 頁面結構調試 ===');
                        console.log('Body 類名:', document.body.className);
                        console.log('Body ID:', document.body.id);
                        
                        // 檢查是否有錯誤訊息
                        const errorElements = document.querySelectorAll('.error, .alert, .warning, [class*="error"]');
                        if (errorElements.length > 0) {
                            console.log('發現錯誤元素:', errorElements.length);
                            errorElements.forEach((el, i) => {
                                console.log(`錯誤 ${i + 1}:`, el.textContent.trim());
                            });
                        }
                        
                        // 輸出頁面的主要結構
                        const mainElements = document.querySelectorAll('main, #main, .main, .content, #content');
                        mainElements.forEach((el, i) => {
                            console.log(`主要內容區 ${i + 1}:`, el.tagName, el.className, '子元素數:', el.children.length);
                        });
                        
                        // 檢查是否需要登入
                        const loginElements = document.querySelectorAll('input[type="password"], .login, .signin, [class*="login"]');
                        if (loginElements.length > 0) {
                            console.log('可能需要登入，找到登入相關元素:', loginElements.length);
                        }
                    }
                    
                    console.log(`備用方法找到 ${productElements.length} 個商品元素`);
                    
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
                
                // 如果沒有找到商品，截圖用於調試
                if (products.length === 0 && currentPage === 1) {
                    try {
                        console.log('未找到商品，正在截圖用於調試...');
                        const screenshot = await page.screenshot({ 
                            fullPage: true,
                            type: 'png'
                        });
                        console.log('截圖完成，大小:', screenshot.length, 'bytes');
                        
                        // 也獲取頁面HTML用於分析
                        const htmlContent = await page.content();
                        console.log('頁面HTML內容長度:', htmlContent.length);
                        
                        // 檢查HTML中是否包含商品相關關鍵字
                        const hasProductKeywords = htmlContent.includes('item/') || 
                                                 htmlContent.includes('auction') ||
                                                 htmlContent.includes('product') ||
                                                 htmlContent.includes('商品');
                        console.log('HTML中包含商品關鍵字:', hasProductKeywords);
                        
                    } catch (screenshotError) {
                        console.error('截圖失敗:', screenshotError.message);
                    }
                }
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
            const imageStats = calculateImageStats(productsWithTime);
            addUpdateLog('success', `漸進式抓取完成：共 ${productsWithTime.length} 個商品 | 圖片：${imageStats.withImages}/${imageStats.total} (${imageStats.successRate}%)`, {
                imageStats: {
                    total: imageStats.total,
                    withImages: imageStats.withImages,
                    withoutImages: imageStats.withoutImages,
                    successRate: `${imageStats.successRate}%`
                }
            });
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
    // 使用原始順序抓取（100%圖片成功率）+ 資料庫存儲
    console.log('🔄 切換至資料庫整合版本...');
    return await fetchYahooAuctionProductsWithDB();
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
        productsCount: 'checking database...',
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

// API路由 - 取得商品列表（從資料庫讀取）
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const storeType = req.query.store || 'yuanzhengshan'; // 預設為源正山
        console.log(`📊 從資料庫獲取${storeType}商品列表...`);
        
        // 根據賣場類型獲取商品
        let products, stats;
        
        if (storeType === 'youmao') {
            // 友茂賣場（露天市集）
            products = await getActiveProducts(storeType);
            stats = await getProductStats(storeType);
            
            console.log(`✅ 從資料庫讀取到 ${products.length} 個友茂商品`);
            
            // 如果友茂資料庫沒有資料，觸發初始化抓取
            if (products.length === 0) {
                console.log('⚠️ 友茂資料庫無資料，觸發初始化抓取...');
                try {
                    const { fetchRutenProducts } = require('./ruten_scraper_stable');
                    await fetchRutenProducts();
                    
                    // 重新從資料庫讀取
                    const newProducts = await getActiveProducts(storeType);
                    const newStats = await getProductStats(storeType);
                    
                    res.json({
                        success: true,
                        products: newProducts,
                        lastUpdate: newStats.lastUpdate,
                        total: newStats.total,
                        imageStats: {
                            withImages: newStats.withImages,
                            withoutImages: newStats.withoutImages,
                            successRate: newStats.imageSuccessRate
                        }
                    });
                    return;
                } catch (error) {
                    console.error('友茂初始化抓取失敗:', error.message);
                    // 返回空資料作為備用
                    res.json({
                        success: true,
                        products: [],
                        lastUpdate: null,
                        total: 0,
                        imageStats: {
                            withImages: 0,
                            withoutImages: 0,
                            successRate: '0.0%'
                        },
                        message: '友茂商品抓取中，請稍候再試...'
                    });
                    return;
                }
            }
        } else {
            // 源正山賣場（Yahoo拍賣）
            products = await getActiveProducts(storeType);
            stats = await getProductStats(storeType);
            
            console.log(`✅ 從資料庫讀取到 ${products.length} 個${storeType}商品`);
            
            // 如果源正山資料庫沒有資料，觸發初始化抓取
            if (products.length === 0) {
                console.log('⚠️ 源正山資料庫無資料，觸發初始化抓取...');
                try {
                    await fetchYahooAuctionProducts();
                    // 重新從資料庫讀取
                    const newProducts = await getActiveProducts(storeType);
                    const newStats = await getProductStats(storeType);
                
                res.json({
                    success: true,
                    products: newProducts,
                    lastUpdate: newStats.lastUpdate,
                    total: newStats.total,
                    imageStats: {
                        withImages: newStats.withImages,
                        withoutImages: newStats.withoutImages,
                        successRate: newStats.imageSuccessRate
                    }
                });
                return;
            } catch (error) {
                console.error('初始化抓取失敗:', error.message);
                // 使用測試資料作為備用
                const testData = generateTestData();
                res.json({
                    success: true,
                    products: testData,
                    lastUpdate: new Date(),
                    total: testData.length,
                    imageStats: {
                        withImages: testData.length,
                        withoutImages: 0,
                        successRate: '100.0%'
                    }
                });
                return;
            }
        }
        
        }        // 智慧更新邏輯（暫時停用，直接返回資料庫資料）
        /*
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
        */
        
        // 返回資料庫數據
        res.json({
            success: true,
            products: products,
            lastUpdate: stats.lastUpdate,
            total: stats.total,
            imageStats: {
                withImages: stats.withImages,
                withoutImages: stats.withoutImages,
                successRate: stats.imageSuccessRate
            }
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
                
                // 從資料庫讀取最新資料
                const products = await getActiveProducts();
                const stats = await getProductStats();
                
                res.json({
                    success: true,
                    message: `部分更新完成：新增 ${detectionResult.newProductsCount} 個，修改 ${detectionResult.modifiedProductsCount} 個，移除 ${detectionResult.removedProductsCount} 個商品`,
                    products: products,
                    lastUpdate: stats.lastUpdate,
                    total: stats.total,
                    imageStats: {
                        withImages: stats.withImages,
                        withoutImages: stats.withoutImages,
                        successRate: stats.imageSuccessRate
                    },
                    updateStats: {
                        newProducts: detectionResult.newProductsCount,
                        modifiedProducts: detectionResult.modifiedProductsCount,
                        removedProducts: detectionResult.removedProductsCount,
                        totalProducts: detectionResult.totalProducts,
                        totalPages: detectionResult.totalPages
                    }
                });
            } else {
                // 從資料庫讀取最新資料
                const products = await getActiveProducts();
                const stats = await getProductStats();
                
                res.json({
                    success: true,
                    message: '未發現商品變更，無需更新',
                    products: products,
                    lastUpdate: stats.lastUpdate,
                    total: stats.total,
                    imageStats: {
                        withImages: stats.withImages,
                        withoutImages: stats.withoutImages,
                        successRate: stats.imageSuccessRate
                    }
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
            
            // 從資料庫讀取最新統計
            const stats = await getProductStats();
            
            res.json({
                success: true,
                message: `完整更新完成，共 ${stats.total} 個商品`,
                total: stats.total,
                lastUpdate: stats.lastUpdate,
                imageStats: {
                    withImages: stats.withImages,
                    withoutImages: stats.withoutImages,
                    successRate: stats.imageSuccessRate
                }
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

// API路由 - 清除更新日誌 (DELETE方法)
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

// API路由 - 清除更新日誌 (POST方法，兼容前端調用)
app.post('/api/clear-logs', requireAuth, async (req, res) => {
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
        await fetchYahooAuctionProducts();
        
        // 從資料庫讀取最新資料
        const products = await getActiveProducts();
        const stats = await getProductStats();
        
        console.log(`✅ 更新完成，從資料庫讀取到 ${products.length} 個商品`);
        
        res.json({
            success: true,
            products: products,
            lastUpdate: stats.lastUpdate,
            total: stats.total,
            imageStats: {
                withImages: stats.withImages,
                withoutImages: stats.withoutImages,
                successRate: stats.imageSuccessRate
            }
        });
    } catch (error) {
        console.error('強制更新錯誤:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 手動觸發友茂爬蟲
app.post('/api/refresh-youmao', requireAuth, async (req, res) => {
    try {
        console.log('手動觸發友茂商品抓取...');
        addUpdateLog('info', '手動觸發友茂商品抓取...');
        
        const { fetchRutenProducts } = require('./ruten_scraper_stable');
        await fetchRutenProducts();
        
        // 從資料庫讀取最新友茂資料
        const youmaoProducts = await getActiveProducts('youmao');
        const youmaoStats = await getProductStats('youmao');
        
        console.log(`✅ 友茂商品抓取完成，共 ${youmaoProducts.length} 個商品`);
        addUpdateLog('success', `友茂商品抓取完成，共 ${youmaoProducts.length} 個商品`);
        
        res.json({
            success: true,
            message: `友茂商品抓取完成，共 ${youmaoProducts.length} 個商品`,
            products: youmaoProducts,
            total: youmaoStats.total,
            lastUpdate: youmaoStats.lastUpdate,
            imageStats: {
                withImages: youmaoStats.withImages,
                withoutImages: youmaoStats.withoutImages,
                successRate: youmaoStats.imageSuccessRate
            }
        });
    } catch (error) {
        console.error('友茂商品抓取失敗:', error);
        addUpdateLog('error', `友茂商品抓取失敗: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API路由 - 匯出Excel（從資料庫讀取）
// 新的整合Excel匯出函數
app.get('/api/export', requireAuth, async (req, res) => {
    try {
        console.log('📊 整合匯出：同時從資料庫讀取兩個賣場商品...');
        
        // 同時獲取兩個賣場的商品資料
        const yuanzhengProducts = await getActiveProducts('yuanzhengshan');
        const youmaoProducts = await getActiveProducts('youmao');
        const yuanzhengStats = await getProductStats('yuanzhengshan');
        const youmaoStats = await getProductStats('youmao');
        
        console.log(`✅ 源正山: ${yuanzhengProducts.length} 個商品`);
        console.log(`✅ 友茂: ${youmaoProducts.length} 個商品`);
        
        // 如果兩個賣場都沒有資料
        if (yuanzhengProducts.length === 0 && youmaoProducts.length === 0) {
            return res.status(400).json({
                success: false,
                error: '兩個賣場都沒有商品資料，請先執行商品抓取'
            });
        }
        
        // 建立新的工作簿
        const workbook = new ExcelJS.Workbook();
        workbook.creator = '商品管理系統';
        workbook.lastModifiedBy = '自動匯出';
        workbook.created = new Date();
        workbook.modified = new Date();
        
        // 創建工作表的通用函數
        const createWorksheet = (workbook, storeName) => {
            const worksheet = workbook.addWorksheet(storeName);
            
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
            worksheet.getRow(1).height = 30;
            
            return worksheet;
        };
        
        // 填充商品資料的通用函數
        const fillWorksheetData = (worksheet, products) => {
            console.log(`開始處理 ${products.length} 個商品的Excel匯出...`);
            
            products.forEach((product, index) => {
                const rowIndex = index + 2; // 從第2列開始（第1列是標題）
                
                // 加入基本資料
                worksheet.addRow({
                    id: product.id,
                    name: product.name,
                    price: `NT$ ${product.price.toLocaleString()}`,
                    image: '點擊查看圖片',
                    link: '點擊查看商品',
                    updateTime: new Date(product.updatedAt || new Date()).toLocaleString('zh-TW')
                });
                
                // 為圖片網址建立超連結
                const imageCell = worksheet.getCell(rowIndex, 4);
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
                    imageCell.value = '❌ 無圖片';
                    imageCell.font = { color: { argb: 'FF999999' } };
                }
                
                // 為商品連結建立超連結
                const linkCell = worksheet.getCell(rowIndex, 5);
                if (product.url) {
                    linkCell.value = {
                        text: '🔗 點擊查看商品',
                        hyperlink: product.url
                    };
                    linkCell.font = { 
                        color: { argb: 'FF0066CC' }, 
                        underline: true 
                    };
                } else {
                    linkCell.value = '❌ 無連結';
                    linkCell.font = { color: { argb: 'FF999999' } };
                }
                
                worksheet.getRow(rowIndex).height = 20;
            });
            
            // 自動調整欄寬
            [1, 2, 6].forEach(colIndex => {
                const column = worksheet.getColumn(colIndex);
                let maxLength = 0;
                column.eachCell({ includeEmpty: true }, (cell) => {
                    const cellValue = cell.value ? cell.value.toString() : '';
                    if (cellValue.length > maxLength) {
                        maxLength = cellValue.length;
                    }
                });
                column.width = Math.min(Math.max(maxLength + 2, 10), 50);
            });
        };

        // 創建並填充源正山工作表
        if (yuanzhengProducts.length > 0) {
            const yuanzhengWorksheet = createWorksheet(workbook, '源正山鋼索五金行');
            fillWorksheetData(yuanzhengWorksheet, yuanzhengProducts);
            console.log(`✅ 源正山工作表完成: ${yuanzhengProducts.length} 個商品`);
        }

        // 創建並填充友茂工作表
        if (youmaoProducts.length > 0) {
            const youmaoWorksheet = createWorksheet(workbook, '友茂');
            fillWorksheetData(youmaoWorksheet, youmaoProducts);
            console.log(`✅ 友茂工作表完成: ${youmaoProducts.length} 個商品`);
        }

        // 創建統計摘要工作表
        const summaryWorksheet = workbook.addWorksheet('統計摘要');
        summaryWorksheet.columns = [
            { header: '賣場', key: 'store', width: 25 },
            { header: '商品總數', key: 'total', width: 15 },
            { header: '有圖片', key: 'withImages', width: 15 },
            { header: '無圖片', key: 'withoutImages', width: 15 },
            { header: '圖片成功率', key: 'successRate', width: 15 },
            { header: '最後更新', key: 'lastUpdate', width: 25 }
        ];
        
        // 設定統計摘要標題樣式
        summaryWorksheet.getRow(1).font = { bold: true };
        summaryWorksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFCCCCFF' }
        };
        
        // 添加統計資料
        if (yuanzhengProducts.length > 0) {
            summaryWorksheet.addRow({
                store: '源正山鋼索五金行 (Yahoo拍賣)',
                total: yuanzhengStats.total,
                withImages: yuanzhengStats.withImages,
                withoutImages: yuanzhengStats.withoutImages,
                successRate: yuanzhengStats.imageSuccessRate,
                lastUpdate: yuanzhengStats.lastUpdate ? new Date(yuanzhengStats.lastUpdate).toLocaleString('zh-TW') : '-'
            });
        }
        
        if (youmaoProducts.length > 0) {
            summaryWorksheet.addRow({
                store: '友茂 (露天市集)',
                total: youmaoStats.total,
                withImages: youmaoStats.withImages,
                withoutImages: youmaoStats.withoutImages,
                successRate: youmaoStats.imageSuccessRate,
                lastUpdate: youmaoStats.lastUpdate ? new Date(youmaoStats.lastUpdate).toLocaleString('zh-TW') : '-'
            });
        }
        
        // 添加總計行
        const totalProducts = yuanzhengProducts.length + youmaoProducts.length;
        const totalWithImages = yuanzhengStats.withImages + youmaoStats.withImages;
        const totalWithoutImages = yuanzhengStats.withoutImages + youmaoStats.withoutImages;
        const overallSuccessRate = totalProducts > 0 ? ((totalWithImages / totalProducts) * 100).toFixed(1) + '%' : '0%';
        
        summaryWorksheet.addRow({
            store: '總計',
            total: totalProducts,
            withImages: totalWithImages,
            withoutImages: totalWithoutImages,
            successRate: overallSuccessRate,
            lastUpdate: new Date().toLocaleString('zh-TW')
        });
        
        // 設定總計行樣式
        const totalRowIndex = summaryWorksheet.lastRow.number;
        summaryWorksheet.getRow(totalRowIndex).font = { bold: true };
        summaryWorksheet.getRow(totalRowIndex).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFCC00' }
        };

        // 設定響應頭
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="products_${timestamp}.xlsx"`);

        // 將工作簿寫入響應
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`✅ 整合Excel匯出完成: 源正山${yuanzhengProducts.length}個 + 友茂${youmaoProducts.length}個 = 總計${totalProducts}個商品`);

    } catch (error) {
        console.error('Excel匯出失敗:', error);
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
            // 檢查源正山商品變更
            const detectionResult = await fullChangeDetection();
            if (detectionResult.changesDetected) {
                console.log('檢測到源正山商品變更，執行部分更新...');
                await partialUpdateProducts(detectionResult);
            } else {
                console.log('未檢測到源正山商品變更');
            }
            
            // 檢查友茂商品是否需要初始化（避免重複）
            try {
                const youmaoProducts = await getActiveProducts('youmao');
                if (youmaoProducts.length === 0) {
                    console.log('⚠️ 定時檢查發現友茂資料庫無資料，開始初始化抓取...');
                    addUpdateLog('info', '定時檢查發現友茂資料庫無資料，開始初始化抓取...');
                    const { fetchRutenProducts } = require('./ruten_scraper_stable');
                    await fetchRutenProducts();
                    addUpdateLog('success', '友茂商品定時初始化完成');
                    console.log('[SUCCESS] 友茂商品定時初始化完成');
                }
            } catch (youmaoError) {
                console.error('[ERROR] 友茂定時檢查失敗:', youmaoError.message);
                addUpdateLog('error', `友茂定時檢查失敗: ${youmaoError.message}`);
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
            
            // 立即執行源正山完整抓取
            await fetchYahooAuctionProducts();
            addUpdateLog('success', '源正山商品抓取完成');
            console.log('[SUCCESS] 源正山商品抓取完成');
            
            // 檢查友茂商品是否需要初始化
            try {
                const youmaoProducts = await getActiveProducts('youmao');
                if (youmaoProducts.length === 0) {
                    console.log('⚠️ 友茂資料庫無資料，開始初始化抓取...');
                    addUpdateLog('info', '友茂資料庫無資料，開始初始化抓取...');
                    const { fetchRutenProducts } = require('./ruten_scraper_stable');
                    await fetchRutenProducts();
                    addUpdateLog('success', '友茂商品抓取完成');
                    console.log('[SUCCESS] 友茂商品抓取完成');
                } else {
                    console.log(`✅ 友茂商品已存在：${youmaoProducts.length} 個`);
                    addUpdateLog('info', `友茂商品已存在：${youmaoProducts.length} 個`);
                }
            } catch (youmaoError) {
                console.error('[ERROR] 友茂初始化失敗:', youmaoError.message);
                addUpdateLog('error', `友茂初始化失敗: ${youmaoError.message}`);
            }
            
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

