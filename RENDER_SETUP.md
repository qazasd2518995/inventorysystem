# Render 部署環境變數設定

## 🔧 必要的環境變數

在 Render Dashboard 中，請設定以下環境變數：

### 資料庫設定
```
DATABASE_URL=postgresql://inventory_etrp_user:WDJMfBCcsdDia908CWWeWLD4nswfhIgl@dpg-d2i2gp3uibrs73dqr3vg-a.singapore-postgres.render.com/inventory_etrp
DB_HOST=dpg-d2i2gp3uibrs73dqr3vg-a.singapore-postgres.render.com
DB_NAME=inventory_etrp
DB_USER=inventory_etrp_user
DB_PASSWORD=WDJMfBCcsdDia908CWWeWLD4nswfhIgl
DB_PORT=5432
```

### 應用程式設定
```
NODE_ENV=production
PORT=10000
```

### 登入系統設定
```
LOGIN_USERNAME=2518995
LOGIN_PASSWORD=2518995
SESSION_SECRET=yahoo-auction-secret-key-2025-render
```

### 爬蟲設定
```
MAX_PAGES=50
SCRAPE_DELAY=1000
PAGE_LOAD_WAIT=5000
```

## 📝 設定步驟

1. 登入 Render Dashboard
2. 選擇你的 Web Service
3. 點選 "Environment" 標籤
4. 逐一添加上述環境變數
5. 點選 "Save Changes"
6. 服務會自動重新部署

## ✅ 優勢

- 🔒 **安全性**: 敏感資訊不會出現在代碼中
- 🔄 **靈活性**: 可以在不修改代碼的情況下更改設定
- 🌍 **環境分離**: 開發/測試/生產環境可使用不同設定
- 📊 **可維護性**: 集中管理所有配置

## 🚀 本地開發

如需在本地開發，請創建 `.env` 文件：
```bash
cp env.example .env
# 然後編輯 .env 文件，填入實際的值
```

注意：`.env` 文件已被 `.gitignore` 忽略，不會被提交到 Git。
