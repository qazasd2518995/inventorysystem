# 奇摩拍賣商品匯出系統

即時抓取奇摩拍賣商品資訊並匯出至Excel的網頁應用程式。

## 功能特色

- 🔄 即時抓取奇摩拍賣商品資料（2123筆商品）
- 📊 網頁介面顯示商品列表
- 📁 Excel匯出功能（包含超連結）
- 🖼️ 圖片網址超連結
- 🔗 商品頁面超連結
- ⚡ Serverless架構，適合Vercel部署

## 技術架構

- **後端**: Node.js + Express
- **爬蟲**: Puppeteer
- **Excel**: ExcelJS
- **部署**: Vercel Serverless Functions

## 本地開發

```bash
npm install
npm start
```

訪問 http://localhost:3000

## Vercel部署

1. 推送代碼到GitHub
2. 在Vercel中連接GitHub倉庫
3. 自動部署完成

## API端點

- `GET /api/products` - 獲取商品列表
- `GET /api/export` - 匯出Excel文件

## 注意事項

- Vercel Serverless函數有30秒執行時間限制
- 大量商品抓取可能需要多次請求
- 建議使用快取機制減少重複抓取