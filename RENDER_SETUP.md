# Render 部署

Web Service 使用 Docker 部署，啟動命令為 `npm start`，健康檢查路徑為 `/api/health`。

必要環境變數：

- `NODE_ENV=production`
- `DATABASE_URL` 或完整的 `DB_HOST`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`DB_PORT`
- `DB_SSL=true`
- `LOGIN_USERNAME`
- `LOGIN_PASSWORD`
- `SESSION_SECRET`
- `COUNT_CHECK_TIMEOUT_MS=15000`
- `RUTEN_SELLER_ID=1994160`
- `RUTEN_API_TIMEOUT_MS=20000`
- `RUTEN_REQUEST_DELAY_MS=100`

Web Service 不在啟動時同步，避免免費實例每次休眠喚醒都重抓資料。若需要自動同步，請另外建立 Render Cron Job，命令使用：

```bash
npm run sync:scheduled
```

這個命令平日執行智慧同步，每週指定日做完整校對。Render Cron Job 會產生額外費用，建立前應先確認帳務方案。
