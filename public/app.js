// 全域變數
let allProducts = [];
let filteredProducts = [];
let autoRefreshInterval = null;
let updateLogsInterval = null;
let isAuthenticated = false;
let currentStore = 'yuanzhengshan'; // 預設為源正山
const dataVersions = {};
const PLACEHOLDER_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#f1f3f5"/>
        <text x="200" y="205" text-anchor="middle" fill="#868e96" font-family="sans-serif" font-size="28">無圖片</text>
    </svg>
`)}`;

// DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeSearch();
    initializeStoreSelector();
    setupEventListeners();
    checkAuthStatus();
});

// 檢查登入狀態
async function checkAuthStatus() {
    try {
        const response = await axios.get('/api/auth-status');
        if (response.data.success && response.data.authenticated) {
            isAuthenticated = true;
            showMainContent();
            loadProducts();
            setupAutoRefresh();
            startUpdateLogsPolling();
        } else {
            showLoginForm();
        }
    } catch (error) {
        console.error('檢查登入狀態失敗:', error);
        showLoginForm();
    }
}

// 顯示登入表單
function showLoginForm() {
    document.getElementById('loginContainer').style.display = 'block';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
}

// 顯示主要內容
function showMainContent() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'block';
    document.getElementById('userInfo').style.display = 'inline';
    document.getElementById('logoutBtn').style.display = 'inline-block';
    document.getElementById('username').textContent = '2518995';
}

// 處理登入
async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const loginBtn = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');
    
    // 清除之前的錯誤訊息
    loginError.style.display = 'none';
    
    // 顯示載入狀態
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> 登入中...';
    
    try {
        const response = await axios.post('/api/login', {
            username: username,
            password: password
        });
        
        if (response.data.success) {
            isAuthenticated = true;
            showMainContent();
            loadProducts();
            setupAutoRefresh();
            startUpdateLogsPolling();
        }
    } catch (error) {
        console.error('登入失敗:', error);
        
        let errorMessage = '登入失敗，請稍後再試';
        if (error.response && error.response.data && error.response.data.error) {
            errorMessage = error.response.data.error;
        }
        
        loginError.textContent = errorMessage;
        loginError.style.display = 'block';
    } finally {
        // 恢復按鈕狀態
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> 登入';
    }
}

// 登出
async function logout() {
    try {
        await axios.post('/api/logout');
        isAuthenticated = false;
        
        // 清除定時器
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        if (updateLogsInterval) {
            clearInterval(updateLogsInterval);
            updateLogsInterval = null;
        }
        
        // 清除資料
        allProducts = [];
        filteredProducts = [];
        
        // 重置表單
        document.getElementById('loginForm').reset();
        
        // 顯示登入表單
        showLoginForm();
        
    } catch (error) {
        console.error('登出失敗:', error);
        alert('登出失敗，請稍後再試');
    }
}

// 設定事件監聽器
function setupEventListeners() {
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('exportBtn')?.addEventListener('click', exportExcel);
    document.getElementById('smartRefreshBtn')?.addEventListener('click', event => refreshProducts(event, false));
    document.getElementById('fullRefreshBtn')?.addEventListener('click', event => refreshProducts(event, true));
    document.getElementById('clearLogsBtn')?.addEventListener('click', clearUpdateLogs);

    // 自動更新開關
    const autoRefreshToggle = document.getElementById('autoRefresh');
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', function(e) {
            if (e.target.checked) {
                setupAutoRefresh();
            } else {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
            }
        });
    }
}

// 設定自動更新
function setupAutoRefresh() {
    const autoRefreshToggle = document.getElementById('autoRefresh');
    if (autoRefreshToggle && autoRefreshToggle.checked) {
        // 清除舊的計時器
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }
        // 每5分鐘只查小型版本資訊；版本沒變就不下載完整商品清單。
        autoRefreshInterval = setInterval(() => {
            checkForProductUpdates();
        }, 5 * 60 * 1000);
    }
}

// 載入商品資料
async function loadProducts() {
    showLoading(true);
    hideError();
    
    try {
        const response = await axios.get(`/api/products?store=${currentStore}`);
        
        if (response.data.success) {
            allProducts = response.data.products;
            filteredProducts = allProducts;
            dataVersions[currentStore] = response.data.dataVersion;
            
            // 更新統計資訊
            updateStatistics(response.data);
            
            // 顯示商品列表
            displayProducts(filteredProducts);
            
            // 更新最後更新時間
            updateLastUpdateTime(response.data.lastUpdate);
        } else {
            showError('載入商品資料失敗');
        }
    } catch (error) {
        console.error('載入商品時發生錯誤:', error);
        
        // 檢查是否為認證錯誤
        if (error.response && error.response.status === 401) {
            isAuthenticated = false;
            showLoginForm();
            return;
        }
        
        showError('無法連接到伺服器，請稍後再試');
    } finally {
        showLoading(false);
    }
}

async function checkForProductUpdates() {
    if (!isAuthenticated || document.hidden) return;

    try {
        const response = await axios.get(`/api/sync-status?store=${currentStore}`);
        if (!response.data.success) return;

        const knownVersion = dataVersions[currentStore];
        if (!knownVersion || knownVersion !== response.data.dataVersion) {
            await loadProducts();
        }
    } catch (error) {
        console.error('檢查商品版本失敗:', error);
    }
}

// 智能更新商品資料（只在必要時執行爬蟲）
async function refreshProducts(event, force = false) {
    if (force && !confirm('完整更新會逐頁檢查目前賣場，確定要執行嗎？')) return;

    const refreshBtn = event.currentTarget || event.target;
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${force ? '完整更新中...' : '輕量檢查中...'}`;
    
    try {
        // 使用智能更新端點，傳送當前選擇的賣場
        const response = await axios.post('/api/refresh', {
            store: currentStore,
            force
        });
        
        if (response.data.success) {
            // 重新載入當前賣場的商品資料
            await loadProducts();
            
            // 根據智能更新的結果顯示相應訊息
            const storeName = getStoreDisplayName(currentStore);
            let message = response.data.message || `${storeName} 智能更新完成`;
            const updateStats = response.data.result?.[currentStore]?.result?.update;
            if (updateStats) {
                message += `（新增 ${updateStats.newCount}、修改 ${updateStats.modifiedCount}、價格變動 ${updateStats.priceChangedCount}、下架 ${updateStats.removedCount}）`;
            }
            showSuccess(message);
        } else {
            const storeName = getStoreDisplayName(currentStore);
            showError(`${storeName} 智能更新失敗: ${response.data.error || '未知錯誤'}`);
        }
    } catch (error) {
        console.error('智能更新時發生錯誤:', error);
        showError('無法執行智能更新，請稍後再試');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = force
            ? '<i class="bi bi-arrow-repeat"></i> 完整更新'
            : '<i class="bi bi-brain"></i> 輕量檢查';
    }
}

// 顯示商品列表
function displayProducts(products) {
    const tbody = document.getElementById('productsTableBody');
    const noDataMessage = document.getElementById('noDataMessage');
    const productsTable = document.getElementById('productsTable');
    
    if (!tbody) return;
    
    // 清空表格
    tbody.replaceChildren();
    
    if (products.length === 0) {
        productsTable.style.display = 'none';
        noDataMessage.style.display = 'block';
        return;
    }
    
    productsTable.style.display = 'table';
    noDataMessage.style.display = 'none';
    
    // 建立商品列
    products.forEach(product => {
        const row = document.createElement('tr');
        row.className = 'fade-in';

        const imageCell = document.createElement('td');
        const image = document.createElement('img');
        image.src = safeHttpUrl(product.imageUrl, PLACEHOLDER_IMAGE);
        image.alt = String(product.name || '商品圖片');
        image.className = 'product-img-mobile';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
            if (image.src !== PLACEHOLDER_IMAGE) image.src = PLACEHOLDER_IMAGE;
        }, { once: true });
        image.addEventListener('click', () => showProductDetail(product));
        imageCell.appendChild(image);

        const priceCell = document.createElement('td');
        priceCell.className = 'price-tag-mobile';
        priceCell.textContent = `NT$ ${Number(product.price || 0).toLocaleString('zh-TW')}`;

        const nameCell = document.createElement('td');
        const productName = document.createElement('div');
        productName.className = 'product-name-mobile';
        productName.title = String(product.name || '');
        productName.textContent = String(product.name || '');
        nameCell.appendChild(productName);

        const actionsCell = document.createElement('td');
        const detailButton = document.createElement('button');
        detailButton.type = 'button';
        detailButton.className = 'btn btn-sm btn-outline-primary me-1';
        detailButton.setAttribute('aria-label', '查看商品詳情');
        const detailIcon = document.createElement('i');
        detailIcon.className = 'bi bi-eye';
        detailButton.appendChild(detailIcon);
        detailButton.addEventListener('click', () => showProductDetail(product));
        actionsCell.appendChild(detailButton);

        const productUrl = safeHttpUrl(product.url, null);
        if (productUrl) {
            const productLink = document.createElement('a');
            productLink.href = productUrl;
            productLink.target = '_blank';
            productLink.rel = 'noopener noreferrer';
            productLink.className = 'btn btn-sm btn-outline-secondary';
            productLink.setAttribute('aria-label', '開啟原始商品頁面');
            const linkIcon = document.createElement('i');
            linkIcon.className = 'bi bi-box-arrow-up-right';
            productLink.appendChild(linkIcon);
            actionsCell.appendChild(productLink);
        }

        row.append(imageCell, priceCell, nameCell, actionsCell);
        
        tbody.appendChild(row);
    });
}

function safeHttpUrl(value, fallback = null) {
    if (!value || typeof value !== 'string') return fallback;
    try {
        const url = new URL(value, window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
    } catch {
        return fallback;
    }
}

// 篩選商品
// 執行搜尋 (結合品名和價格)
function performSearch() {
    searchProducts();
}

// 保留舊的 filterProducts 函數以確保相容性
function filterProducts(searchTerm) {
    // 清空搜尋欄位並執行新的搜尋
    if (document.getElementById('searchNameInput')) {
        document.getElementById('searchNameInput').value = searchTerm;
        document.getElementById('searchPriceInput').value = '';
        searchProducts();
    }
}

// 顯示商品詳情
function showProductDetail(product) {
    if (!product) return;
    
    // 更新 Modal 內容
    const modalImage = document.getElementById('modalImage');
    modalImage.src = safeHttpUrl(product.imageUrl, PLACEHOLDER_IMAGE);
    modalImage.onerror = () => {
        modalImage.onerror = null;
        modalImage.src = PLACEHOLDER_IMAGE;
    };
    document.getElementById('modalTitle').textContent = String(product.name || '');
    // 移除商品編號顯示
    const modalIdElement = document.getElementById('modalId');
    if (modalIdElement) {
        modalIdElement.parentElement.style.display = 'none';
    }
    document.getElementById('modalPrice').textContent = Number(product.price || 0).toLocaleString('zh-TW');
    const modalLink = document.getElementById('modalLink');
    const productUrl = safeHttpUrl(product.url, null);
    modalLink.href = productUrl || '#';
    modalLink.style.display = productUrl ? 'inline-block' : 'none';
    modalLink.rel = 'noopener noreferrer';
    
    // 顯示 Modal
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
}

// 更新統計資訊
function updateStatistics(data) {
    const totalProducts = document.getElementById('totalProducts');
    const updateTime = document.getElementById('updateTime');
    
    if (totalProducts) {
        totalProducts.textContent = data.total || 0;
    }
    
    if (updateTime && data.lastUpdate) {
        const date = new Date(data.lastUpdate);
        updateTime.textContent = date.toLocaleString('zh-TW');
    }
    
    // 更新圖片統計
    updateImageStatistics(data.products || []);
}

// 更新最後更新時間
function updateLastUpdateTime(lastUpdate) {
    const lastUpdateElement = document.getElementById('lastUpdate');
    
    if (lastUpdateElement && lastUpdate) {
        const date = new Date(lastUpdate);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000); // 秒數差
        
        let timeText = '';
        if (diff < 60) {
            timeText = '剛剛更新';
        } else if (diff < 3600) {
            timeText = `${Math.floor(diff / 60)} 分鐘前更新`;
        } else if (diff < 86400) {
            timeText = `${Math.floor(diff / 3600)} 小時前更新`;
        } else {
            timeText = date.toLocaleString('zh-TW');
        }
        
        lastUpdateElement.textContent = timeText;
    }
}

// 顯示載入中
function showLoading(show) {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const productsTable = document.getElementById('productsTable');
    const noDataMessage = document.getElementById('noDataMessage');
    
    if (loadingSpinner) {
        loadingSpinner.style.display = show ? 'block' : 'none';
    }
    
    if (show) {
        if (productsTable) productsTable.style.display = 'none';
        if (noDataMessage) noDataMessage.style.display = 'none';
    }
}

// 顯示錯誤訊息
function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        
        // 5秒後自動隱藏
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }
}

// 隱藏錯誤訊息
function hideError() {
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
        errorMessage.style.display = 'none';
    }
}

// 顯示成功訊息
function showSuccess(message) {
    // 建立成功訊息元素
    const successDiv = document.createElement('div');
    successDiv.className = 'alert alert-success alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    successDiv.style.zIndex = '9999';
    const icon = document.createElement('i');
    icon.className = 'bi bi-check-circle me-2';
    const messageNode = document.createTextNode(String(message));
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close';
    closeButton.setAttribute('data-bs-dismiss', 'alert');
    closeButton.setAttribute('aria-label', '關閉');
    successDiv.append(icon, messageNode, closeButton);
    
    document.body.appendChild(successDiv);
    
    // 3秒後自動移除
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// 更新圖片統計
function updateImageStatistics(products) {
    const imageStatsElement = document.getElementById('imageStats');
    if (!imageStatsElement) return;
    
    const totalProducts = products.length;
    const productsWithImages = products.filter(p => p.imageUrl && p.imageUrl.trim() !== '').length;
    const successRate = totalProducts > 0 ? ((productsWithImages / totalProducts) * 100).toFixed(1) : 0;
    
    // 根據成功率設定顏色
    let colorClass = 'text-success';
    if (successRate < 70) {
        colorClass = 'text-danger';
    } else if (successRate < 90) {
        colorClass = 'text-warning';
    }
    
    imageStatsElement.className = `fw-bold ${colorClass}`;
    imageStatsElement.textContent = `${productsWithImages}/${totalProducts} (${successRate}%)`;
}

// 載入更新日誌
async function loadUpdateLogs() {
    try {
        const response = await axios.get('/api/update-logs');
        if (response.data.success) {
            renderUpdateLogs(response.data.logs);
        }
    } catch (error) {
        console.error('載入更新日誌失敗:', error);
    }
}

// 渲染更新日誌
function renderUpdateLogs(logs) {
    const logsList = document.getElementById('updateLogsList');
    if (!logsList) return;
    
    if (!logs || logs.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'text-muted text-center';
        emptyMessage.textContent = '暫無更新日誌';
        logsList.replaceChildren(emptyMessage);
        return;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach(log => {
        const timestamp = new Date(log.timestamp).toLocaleString('zh-TW', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const entry = document.createElement('div');
        const safeType = ['info', 'success', 'warning', 'error', 'new', 'modified', 'removed'].includes(log.type)
            ? log.type
            : 'info';
        entry.className = `log-entry log-${safeType}`;

        const timestampElement = document.createElement('div');
        timestampElement.className = 'log-timestamp';
        timestampElement.textContent = timestamp;
        const messageElement = document.createElement('div');
        messageElement.className = 'log-message';
        messageElement.textContent = String(log.message || '');
        entry.append(timestampElement, messageElement);

        if (log.details && log.details.imageStats) {
            const stats = log.details.imageStats;
            const details = document.createElement('div');
            details.className = 'log-details';
            const imageStats = document.createElement('span');
            imageStats.className = 'image-stats-badge';
            imageStats.textContent = `圖片 ${stats.withImages}/${stats.total} (${stats.successRate})`;
            details.appendChild(imageStats);
            if (Number(stats.withoutImages) > 0) {
                const missingImages = document.createElement('span');
                missingImages.className = 'image-stats-badge text-warning';
                missingImages.textContent = `${stats.withoutImages} 無圖片`;
                details.appendChild(missingImages);
            }
            entry.appendChild(details);
        }

        fragment.appendChild(entry);
    });
    logsList.replaceChildren(fragment);
}

// 清除更新日誌
async function clearUpdateLogs() {
    if (!confirm('確定要清除所有更新日誌嗎？')) {
        return;
    }
    
    try {
        const response = await axios.post('/api/clear-logs');
        if (response.data.success) {
            renderUpdateLogs([]);
            showSuccess('更新日誌已清除');
        } else {
            showError('清除日誌失敗');
        }
    } catch (error) {
        console.error('清除日誌失敗:', error);
        showError('清除日誌時發生錯誤');
    }
}

// 定期載入更新日誌
function startUpdateLogsPolling() {
    // 初始載入
    loadUpdateLogs();
    
    // 日誌不是即時關鍵資料，降低為每2分鐘，頁面在背景時不請求。
    if (updateLogsInterval) clearInterval(updateLogsInterval);
    updateLogsInterval = setInterval(() => {
        if (!document.hidden) loadUpdateLogs();
    }, 120000);
}

// 搜尋功能
function searchProducts(searchTerm) {
    // 如果有傳入 searchTerm，代表是舊的呼叫方式
    if (typeof searchTerm === 'string') {
        // 轉換為新的搜尋方式
        if (document.getElementById('searchNameInput')) {
            document.getElementById('searchNameInput').value = searchTerm;
            document.getElementById('searchPriceInput').value = '';
        }
    }
    
    const nameSearchTerm = document.getElementById('searchNameInput')?.value.toLowerCase().trim() || '';
    const priceSearchTerm = document.getElementById('searchPriceInput')?.value.trim() || '';
    
    if (!nameSearchTerm && !priceSearchTerm) {
        // 如果都沒有輸入，顯示所有商品
        filteredProducts = allProducts;
    } else {
        
        filteredProducts = allProducts.filter(product => {
            // 品名搜尋
            const nameMatch = !nameSearchTerm || product.name.toLowerCase().includes(nameSearchTerm);
            
            // 價格搜尋
            let priceMatch = true;
            if (priceSearchTerm) {
                // 移除使用者輸入的逗號，只保留數字
                const cleanPriceInput = priceSearchTerm.replace(/,/g, '');
                const searchPrice = parseInt(cleanPriceInput);
                
                if (!isNaN(searchPrice)) {
                    // 精確匹配價格
                    priceMatch = product.price === searchPrice;
                } else {
                    priceMatch = false;
                }
            }
            
            // 必須同時符合品名和價格條件
            return nameMatch && priceMatch;
        });
    }
    
    // 重新顯示搜尋結果
    displayProducts(filteredProducts);
    
    // 更新搜尋結果提示
    const displayTerm = nameSearchTerm || priceSearchTerm || '';
    updateSearchResultsInfo(displayTerm, filteredProducts.length, allProducts.length);
}

// 更新搜尋結果資訊
function updateSearchResultsInfo(searchTerm, resultCount, totalCount) {
    let searchInfo = document.getElementById('searchResultsInfo');
    if (!searchInfo) {
        // 如果不存在，創建一個
        searchInfo = document.createElement('div');
        searchInfo.id = 'searchResultsInfo';
        searchInfo.className = 'alert alert-info py-2 px-3 mb-3';
        searchInfo.style.display = 'none';
        
        const searchContainer = document.querySelector('.row.mb-3');
        searchContainer.insertAdjacentElement('afterend', searchInfo);
    }
    
    if (searchTerm.trim()) {
        searchInfo.replaceChildren();
        const message = document.createElement('span');
        message.textContent = `搜尋「${searchTerm}」找到 ${resultCount} 個商品（共 ${totalCount} 個）`;
        searchInfo.appendChild(message);
        if (resultCount === 0) {
            const suggestion = document.createElement('span');
            suggestion.className = 'text-muted ms-2';
            suggestion.textContent = '試試其他關鍵字或價格範圍';
            searchInfo.appendChild(suggestion);
        }
        searchInfo.style.display = 'block';
    } else {
        searchInfo.style.display = 'none';
    }
}

// 初始化搜尋功能
function initializeSearch() {
    const searchNameInput = document.getElementById('searchNameInput');
    const searchPriceInput = document.getElementById('searchPriceInput');
    
    // 品名搜尋
    if (searchNameInput) {
        // 即時搜尋（輸入時立即搜尋）
        searchNameInput.addEventListener('input', function(e) {
            searchProducts();
        });
        
        // 按Enter鍵搜尋
        searchNameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchProducts();
            }
        });
    }
    
    // 價格搜尋
    if (searchPriceInput) {
        // 即時搜尋（輸入時立即搜尋）
        searchPriceInput.addEventListener('input', function(e) {
            searchProducts();
        });
        
        // 按Enter鍵搜尋
        searchPriceInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchProducts();
            }
        });
    }
}

// 初始化賣場選擇器
function initializeStoreSelector() {
    const storeRadios = document.querySelectorAll('input[name="storeSelector"]');
    storeRadios.forEach(radio => {
        radio.addEventListener('change', function(e) {
            if (e.target.checked) {
                switchStore(e.target.value);
            }
        });
    });
}

// 切換賣場
async function switchStore(storeType) {
    if (storeType === currentStore) return;
    
    const oldStore = currentStore;
    currentStore = storeType;
    
    // 更新界面顯示
    updateStoreInfo(storeType);
    
    // 清空當前商品資料
    allProducts = [];
    filteredProducts = [];
    displayProducts([]);
    
    // 清空搜尋框
    const searchNameInput = document.getElementById('searchNameInput');
    const searchPriceInput = document.getElementById('searchPriceInput');
    if (searchNameInput) {
        searchNameInput.value = '';
    }
    if (searchPriceInput) {
        searchPriceInput.value = '';
    }
    
    // 隱藏搜尋結果提示
    const searchInfo = document.getElementById('searchResultsInfo');
    if (searchInfo) {
        searchInfo.style.display = 'none';
    }
    
    // 顯示載入狀態
    showLoadingState();
    
    try {
        // 載入新賣場的商品資料
        await loadProductsForStore(storeType);
        showSuccess(`已切換至${getStoreDisplayName(storeType)}`);
    } catch (error) {
        console.error('切換賣場失敗:', error);
        showError(`切換至${getStoreDisplayName(storeType)}失敗，請稍後再試`);
        
        // 切換失敗，恢復原來的選擇
        currentStore = oldStore;
        const oldRadio = document.getElementById(`store-${oldStore}`);
        if (oldRadio) {
            oldRadio.checked = true;
        }
        updateStoreInfo(oldStore);
    }
}

// 更新賣場資訊顯示（已移除小卡片，此函數保留但不執行任何操作）
function updateStoreInfo(storeType) {
    // 小卡片已移除，不需要更新顯示
    console.log(`切換到賣場: ${getStoreDisplayName(storeType)}`);
}

// 獲取賣場資料
function getStoreData(storeType) {
    const stores = {
        'yuanzhengshan': {
            name: '源正山（外匯嚴選）',
            platform: 'Yahoo拍賣',
            icon: 'bi bi-building',
            url: 'https://tw.bid.yahoo.com/booth/Y1823944291'
        },
        'youmao': {
            name: '友茂工具',
            platform: '露天市集',
            icon: 'bi bi-tools',
            url: 'https://www.ruten.com.tw/store/u-mo0955900924/'
        }
    };
    return stores[storeType] || stores['yuanzhengshan'];
}

// 獲取賣場顯示名稱
function getStoreDisplayName(storeType) {
    return getStoreData(storeType).name;
}

// 為特定賣場載入商品資料
async function loadProductsForStore(storeType) {
    try {
        const response = await axios.get(`/api/products?store=${storeType}`);
        
        if (response.data.success) {
            allProducts = response.data.products;
            filteredProducts = allProducts;
            dataVersions[storeType] = response.data.dataVersion;
            
            // 更新統計資訊
            updateStatistics(response.data);
            
            // 顯示商品列表
            displayProducts(filteredProducts);
            
            // 更新最後更新時間
            updateLastUpdateTime(response.data.lastUpdate);
            
            hideLoadingState();
        } else {
            throw new Error(response.data.message || '載入商品資料失敗');
        }
    } catch (error) {
        console.error('載入商品資料時發生錯誤:', error);
        hideLoadingState();
        throw error;
    }
}

// 顯示載入狀態
function showLoadingState() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const productsTable = document.getElementById('productsTable');
    const noDataMessage = document.getElementById('noDataMessage');
    
    if (loadingSpinner) loadingSpinner.style.display = 'block';
    if (productsTable) productsTable.style.display = 'none';
    if (noDataMessage) noDataMessage.style.display = 'none';
    
    // 重置統計資訊
    updateStatistics({
        total: 0,
        lastUpdate: null,
        imageStats: { withImages: 0, withoutImages: 0, successRate: 0 }
    });
}

// 隱藏載入狀態
function hideLoadingState() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
}

// 匯出Excel
async function exportExcel(event) {
    const exportBtn = event.currentTarget;
    const originalText = exportBtn.innerHTML;
    
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>匯出中...';
    
    try {
        const storeData = getStoreData(currentStore);
        const response = await axios.get(`/api/export?store=${currentStore}`, {
            responseType: 'blob'
        });
        
        // 創建下載連結
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // 根據賣場設定檔案名稱
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        link.download = `${storeData.name}_商品清單_${timestamp}.xlsx`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        showSuccess(`${storeData.name} Excel檔案匯出成功！`);
    } catch (error) {
        console.error('匯出Excel失敗:', error);
        showError('匯出Excel失敗，請稍後再試');
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalText;
    }
}
