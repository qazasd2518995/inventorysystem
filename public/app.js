// 全域變數
let allProducts = [];
let filteredProducts = [];
let autoRefreshInterval = null;
let isAuthenticated = false;
let currentStore = 'yuanzhengshan'; // 預設為源正山

// DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', function() {
    checkAuthStatus();
    initializeSearch();
    initializeStoreSelector();
});

// 檢查登入狀態
async function checkAuthStatus() {
    try {
        const response = await axios.get('/api/auth-status');
        if (response.data.success && response.data.authenticated) {
            isAuthenticated = true;
            showMainContent();
            loadProducts();
            setupEventListeners();
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
            setupEventListeners();
            setupAutoRefresh();
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
    // 搜尋功能
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            filterProducts(e.target.value);
        });
    }

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
        // 設定每5分鐘檢查更新一次（實際自動更新由服務器每24小時執行）
        autoRefreshInterval = setInterval(() => {
            loadProducts();
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

// 智能更新商品資料（只在必要時執行爬蟲）
async function refreshProducts() {
    const refreshBtn = event.target;
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>智能檢查中...';
    
    try {
        // 使用智能更新端點
        const response = await axios.post('/api/refresh');
        
        if (response.data.success) {
            // 重新載入當前賣場的商品資料
            await loadProducts();
            
            // 根據智能更新的結果顯示相應訊息
            const message = response.data.message || '智能更新完成';
            showSuccess(message);
        } else {
            showError(`智能更新失敗: ${response.data.error || '未知錯誤'}`);
        }
    } catch (error) {
        console.error('智能更新時發生錯誤:', error);
        showError('無法執行智能更新，請稍後再試');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="bi bi-brain"></i> 智能更新';
    }
}

// 顯示商品列表
function displayProducts(products) {
    const tbody = document.getElementById('productsTableBody');
    const noDataMessage = document.getElementById('noDataMessage');
    const productsTable = document.getElementById('productsTable');
    
    if (!tbody) return;
    
    // 清空表格
    tbody.innerHTML = '';
    
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
        
        row.innerHTML = `
            <td>
                <img src="${product.imageUrl || 'https://via.placeholder.com/100'}" 
                     alt="${product.name}" 
                     class="product-img-mobile"
                     onerror="this.src='https://via.placeholder.com/100'"
                     onclick='showProductDetail(${JSON.stringify(product).replace(/'/g, "&#39;")})'>
            </td>
            <td class="price-tag-mobile">NT$ ${product.price.toLocaleString()}</td>
            <td>
                <div class="product-name-mobile" title="${product.name}">
                    ${product.name}
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick='showProductDetail(${JSON.stringify(product).replace(/'/g, "&#39;")})'>  
                    <i class="bi bi-eye"></i>
                </button>
                <a href="${product.url}" target="_blank" class="btn btn-sm btn-outline-secondary">
                    <i class="bi bi-box-arrow-up-right"></i>
                </a>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// 篩選商品
function filterProducts(searchTerm) {
    searchTerm = searchTerm.toLowerCase().trim();
    
    if (!searchTerm) {
        filteredProducts = allProducts;
    } else {
        filteredProducts = allProducts.filter(product => 
            product.name.toLowerCase().includes(searchTerm)
        );
    }
    
    displayProducts(filteredProducts);
}

// 顯示商品詳情
function showProductDetail(product) {
    if (!product) return;
    
    // 更新 Modal 內容
    document.getElementById('modalImage').src = product.imageUrl || 'https://via.placeholder.com/400';
    document.getElementById('modalTitle').textContent = product.name;
    // 移除商品編號顯示
    const modalIdElement = document.getElementById('modalId');
    if (modalIdElement) {
        modalIdElement.parentElement.style.display = 'none';
    }
    document.getElementById('modalPrice').textContent = product.price.toLocaleString();
    document.getElementById('modalLink').href = product.url;
    
    // 顯示 Modal
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
}

// 匯出 Excel
async function exportExcel() {
    const exportBtn = event.target;
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>匯出中...';
    
    try {
        // 使用 axios 下載檔案
        const response = await axios.get('/api/export', {
            responseType: 'blob'
        });
        
        // 建立下載連結
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // 從 response headers 取得檔名，如果沒有就使用預設檔名
        const contentDisposition = response.headers['content-disposition'];
        let fileName = `商品列表_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        if (contentDisposition) {
            const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (fileNameMatch && fileNameMatch[1]) {
                fileName = fileNameMatch[1].replace(/['"]/g, '');
                // 解碼中文檔名
                try {
                    fileName = decodeURIComponent(fileName);
                } catch (e) {
                    // 如果解碼失敗，使用原始檔名
                }
            }
        }
        
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        
        showSuccess('Excel 檔案已成功匯出');
    } catch (error) {
        console.error('匯出 Excel 時發生錯誤:', error);
        
        // 檢查是否為認證錯誤
        if (error.response && error.response.status === 401) {
            isAuthenticated = false;
            showLoginForm();
            return;
        }
        
        showError('匯出失敗，請稍後再試');
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '<i class="bi bi-file-earmark-excel"></i> 匯出 Excel';
    }
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
    successDiv.innerHTML = `
        <i class="bi bi-check-circle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
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
        logsList.innerHTML = '<p class="text-muted text-center">暫無更新日誌</p>';
        return;
    }
    
    const logsHtml = logs.map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString('zh-TW', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let detailsHtml = '';
        if (log.details && log.details.imageStats) {
            const stats = log.details.imageStats;
            detailsHtml = `
                <div class="log-details">
                    <span class="image-stats-badge">
                        <i class="bi bi-image"></i> ${stats.withImages}/${stats.total} 
                        (${stats.successRate})
                    </span>
                    ${stats.withoutImages > 0 ? 
                        `<span class="image-stats-badge text-warning">
                            <i class="bi bi-exclamation-triangle"></i> ${stats.withoutImages} 無圖片
                        </span>` : ''}
                </div>
            `;
        }
        
        return `
            <div class="log-entry log-${log.type}">
                <div class="log-timestamp">${timestamp}</div>
                <div class="log-message">${log.message}</div>
                ${detailsHtml}
            </div>
        `;
    }).join('');
    
    logsList.innerHTML = logsHtml;
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
    
    // 每30秒更新一次
    setInterval(() => {
        loadUpdateLogs();
    }, 30000);
}

// 搜尋功能
function searchProducts(searchTerm) {
    if (!searchTerm.trim()) {
        // 如果搜尋框為空，顯示所有商品
        filteredProducts = allProducts;
    } else {
        const term = searchTerm.toLowerCase().trim();
        
        filteredProducts = allProducts.filter(product => {
            // 搜尋商品名稱
            const nameMatch = product.name.toLowerCase().includes(term);
            
            // 檢查是否為範圍搜索
            let isRangeSearch = false;
            let rangeMatch = false;
            
            // 搜尋價格範圍（例如：輸入 "1000-5000" 或 ">2000" 或 "<1000"）
            if (term.includes('-')) {
                isRangeSearch = true;
                const [min, max] = term.split('-').map(n => parseInt(n.replace(/[^\d]/g, '')));
                if (!isNaN(min) && !isNaN(max)) {
                    rangeMatch = product.price >= min && product.price <= max;
                }
            } else if (term.startsWith('>')) {
                isRangeSearch = true;
                const minPrice = parseInt(term.substring(1).replace(/[^\d]/g, ''));
                if (!isNaN(minPrice)) {
                    rangeMatch = product.price > minPrice;
                }
            } else if (term.startsWith('<')) {
                isRangeSearch = true;
                const maxPrice = parseInt(term.substring(1).replace(/[^\d]/g, ''));
                if (!isNaN(maxPrice)) {
                    rangeMatch = product.price < maxPrice;
                }
            }
            
            // 如果是範圍搜索，只檢查名稱匹配和範圍匹配
            if (isRangeSearch) {
                return nameMatch || rangeMatch;
            }
            
            // 普通價格搜尋（支援多種格式，自動處理逗號）
            const priceValue = product.price;
            const priceText = priceValue.toString(); // 純數字，如：4200
            const priceWithComma = priceValue.toLocaleString(); // 帶逗號，如：4,200
            const cleanTerm = term.replace(/,/g, ''); // 移除搜索詞中的逗號
            
            // 檢查各種匹配情況：
            // 1. 直接數字匹配：輸入4200 找到 4200
            // 2. 帶逗號匹配：輸入4,200 找到 4,200  
            // 3. 交叉匹配：輸入4200 找到 4,200 或 輸入4,200 找到 4200
            const priceMatch = priceText.includes(cleanTerm) || 
                              priceWithComma.includes(term) ||
                              priceText === cleanTerm ||
                              priceWithComma.replace(/,/g, '') === cleanTerm;
            
            return nameMatch || priceMatch;
        });
    }
    
    // 重新顯示搜尋結果
    displayProducts(filteredProducts);
    
    // 更新搜尋結果提示
    updateSearchResultsInfo(searchTerm, filteredProducts.length, allProducts.length);
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
        searchInfo.innerHTML = `
            <i class="bi bi-search"></i> 
            搜尋「<strong>${searchTerm}</strong>」找到 <strong>${resultCount}</strong> 個商品（共 ${totalCount} 個）
            ${resultCount === 0 ? '<span class="text-muted ms-2">試試其他關鍵字或價格範圍</span>' : ''}
        `;
        searchInfo.style.display = 'block';
    } else {
        searchInfo.style.display = 'none';
    }
}

// 初始化搜尋功能
function initializeSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        // 即時搜尋（輸入時立即搜尋）
        searchInput.addEventListener('input', function(e) {
            searchProducts(e.target.value);
        });
        
        // 按Enter鍵搜尋
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchProducts(e.target.value);
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
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
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
            name: '源正山鋼索五金行',
            platform: 'Yahoo拍賣',
            icon: 'bi bi-building',
            url: 'https://tw.bid.yahoo.com/booth/Y1823944291'
        },
        'youmao': {
            name: '友茂',
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
async function exportExcel() {
    const exportBtn = event.target;
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
