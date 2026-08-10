# 網拍商品庫存與價格同步系統

集中管理源正山 Yahoo 拍賣與友茂露天市集商品，提供商品查詢、Excel 匯出、差異同步與價格異動紀錄。

## 同步策略

- 伺服器啟動只連接資料庫，不會自動啟動爬蟲。
- 商品列表只讀 PostgreSQL，並支援 ETag / `304 Not Modified`。
- 前端每 5 分鐘只讀小型版本端點；版本有變化才重新下載商品清單。
- Yahoo 輕量檢查只下載約 60 KB 的賣場 HTML。總數不同或手動完整更新時，才使用 Chromium 完整校對。
- 露天使用賣場前端本身的批次 JSON API，同步過程不啟動 Chromium、不下載商品圖片，並能偵測商品數不變時的價格調整。
- PostgreSQL advisory lock 防止多個 Render 工作同時同步。
- API 失敗或抓取結果不完整時保留原資料，不會把失敗誤判成全數下架。

## 常用指令

```bash
npm install
npm test
npm start

# 先做智慧檢查；露天會執行低流量 API 差異同步
npm run sync:smart

# 完整校對指定賣場
npm run sync:full -- --store=youmao
npm run sync:full -- --store=yuanzhengshan

# 供獨立排程工作使用；預設每週日做完整校對
npm run sync:scheduled
```

## API

以下端點除健康檢查外皆需要登入：

- `GET /api/health`：健康檢查。
- `GET /api/products?store=youmao`：商品列表，支援 ETag。
- `GET /api/sync-status?store=youmao`：小型資料版本與同步狀態。
- `POST /api/refresh`：`{ "store": "youmao", "force": false }`。
- `GET /api/price-changes?store=youmao&limit=50`：真正的價格異動歷史。
- `GET /api/export`：匯出 Excel。

環境變數範例請見 `env.example`。正式資料庫密碼、登入密碼與 Render API Key 不得寫入儲存庫。
