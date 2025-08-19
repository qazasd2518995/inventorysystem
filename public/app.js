// 全域變數
let allProducts = [];
let filteredProducts = [];
let autoRefreshInterval = null;
let isAuthenticated = false;

// DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', function() {
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
        // 設定每5分鐘更新一次
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
        const response = await axios.get('/api/products');
        
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

// 重新整理商品資料
async function refreshProducts() {
    const refreshBtn = event.target;
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>更新中...';
    
    try {
        const response = await axios.post('/api/refresh');
        
        if (response.data.success) {
            allProducts = response.data.products;
            filteredProducts = allProducts;
            
            // 更新統計資訊
            updateStatistics(response.data);
            
            // 顯示商品列表
            displayProducts(filteredProducts);
            
            // 更新最後更新時間
            updateLastUpdateTime(response.data.lastUpdate);
            
            // 顯示成功訊息
            showSuccess('商品資料已更新');
        } else {
            showError('更新商品資料失敗');
        }
    } catch (error) {
        console.error('更新商品時發生錯誤:', error);
        showError('無法更新商品資料，請稍後再試');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> 立即更新';
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
                     onclick="showProductDetail('${product.id}')">
            </td>
            <td class="price-tag-mobile">NT$ ${product.price.toLocaleString()}</td>
            <td>
                <div class="product-name-mobile" title="${product.name}">
                    ${product.name}
                </div>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="showProductDetail('${product.id}')">
                    <i class="bi bi-eye"></i>
                </button>
                <a href="${product.url}" target="_blank" class="btn btn-sm btn-outline-secondary">
                    <i class="bi bi-box-arrow-up-right"></i>
                </a>
            </td>
            <td class="d-none">${product.id}</td>
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
            product.name.toLowerCase().includes(searchTerm) ||
            product.id.toLowerCase().includes(searchTerm)
        );
    }
    
    displayProducts(filteredProducts);
}

// 顯示商品詳情
function showProductDetail(productId) {
    const product = allProducts.find(p => p.id === productId);
    
    if (!product) return;
    
    // 更新 Modal 內容
    document.getElementById('modalImage').src = product.imageUrl || 'https://via.placeholder.com/400';
    document.getElementById('modalTitle').textContent = product.name;
    document.getElementById('modalId').textContent = product.id;
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
