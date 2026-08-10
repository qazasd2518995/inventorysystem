require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const {
    pool,
    initializeDatabase,
    getActiveProducts,
    getProductStats,
    addUpdateLogToDB,
    getUpdateLogs,
    clearUpdateLogs,
    getSyncState,
    getPriceChanges,
    checkDatabaseHealth
} = require('./database');
const { smartUpdate } = require('./smart_scraper');
const { streamProductWorkbook } = require('./excel_export');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const VALID_STORES = new Set(['yuanzhengshan', 'youmao']);
const VALID_LOG_TYPES = new Set(['info', 'success', 'warning', 'error', 'new', 'modified', 'removed']);

const LOGIN_USERNAME = process.env.LOGIN_USERNAME;
const LOGIN_PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH;
const LEGACY_LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!LOGIN_USERNAME || (!LOGIN_PASSWORD_HASH && !LEGACY_LOGIN_PASSWORD)) {
    throw new Error('缺少 LOGIN_USERNAME，以及 LOGIN_PASSWORD_HASH 或 LOGIN_PASSWORD 環境變數');
}
if (!SESSION_SECRET) {
    throw new Error('缺少 SESSION_SECRET 環境變數');
}

// 舊環境可無痛啟動；正式環境部署時會改成 LOGIN_PASSWORD_HASH 並移除明文變數。
const legacyPasswordHashPromise = LOGIN_PASSWORD_HASH
    ? null
    : bcrypt.hash(LEGACY_LOGIN_PASSWORD, 12);

if (IS_PRODUCTION) {
    app.set('trust proxy', 1);
}
app.disable('x-powered-by');

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: IS_PRODUCTION ? [] : null
        }
    }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

app.use(session({
    name: 'inventory.sid',
    store: new PgSession({
        pool,
        tableName: 'user_sessions',
        createTableIfMissing: true,
        pruneSessionInterval: 15 * 60
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: IS_PRODUCTION,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        priority: 'high'
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { success: false, error: '登入嘗試次數過多，請稍後再試' }
});

let isUpdating = false;

function requireAuth(req, res, next) {
    if (req.session?.authenticated) return next();
    return res.status(401).json({
        success: false,
        error: '需要登入才能存取此功能',
        requireLogin: true
    });
}

function parseStore(value, fallback = 'yuanzhengshan') {
    const store = value || fallback;
    return VALID_STORES.has(store) ? store : null;
}

function buildDataVersion(storeType, stats) {
    const changedAt = stats.dataChangedAt || stats.lastUpdate;
    const timestamp = changedAt ? new Date(changedAt).getTime() : 0;
    return `${storeType}:${stats.total || 0}:${timestamp}`;
}

function parsePositiveInteger(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

async function addUpdateLog(type, message, details = null) {
    await addUpdateLogToDB(type, message, details);
    console.log(`[${type.toUpperCase()}] ${message}`);
}

async function verifyPassword(password) {
    const hash = LOGIN_PASSWORD_HASH || await legacyPasswordHashPromise;
    return bcrypt.compare(password, hash);
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(error => error ? reject(error) : resolve());
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save(error => error ? reject(error) : resolve());
    });
}

function sendServerError(res, error, context) {
    console.error(`${context}:`, error);
    return res.status(500).json({
        success: false,
        error: IS_PRODUCTION ? '伺服器處理失敗，請稍後再試' : error.message
    });
}

app.get('/api/health', async (req, res) => {
    try {
        await checkDatabaseHealth();
        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            isUpdating
        });
    } catch (error) {
        console.error('健康檢查資料庫連線失敗:', error.message);
        return res.status(503).json({
            success: false,
            status: 'unhealthy',
            database: 'disconnected',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!username || !password || username.length > 100 || password.length > 200) {
            return res.status(400).json({ success: false, error: '請輸入有效的帳號和密碼' });
        }

        const passwordMatches = username === LOGIN_USERNAME && await verifyPassword(password);
        if (!passwordMatches) {
            await addUpdateLog('warning', `登入失敗：帳號 ${username.slice(0, 100)}`);
            return res.status(401).json({ success: false, error: '帳號或密碼錯誤' });
        }

        await regenerateSession(req);
        req.session.authenticated = true;
        req.session.username = LOGIN_USERNAME;
        req.session.loginTime = new Date().toISOString();
        await saveSession(req);
        await addUpdateLog('info', `用戶 ${LOGIN_USERNAME} 登入成功`);

        return res.json({
            success: true,
            message: '登入成功',
            user: { username: LOGIN_USERNAME, loginTime: req.session.loginTime }
        });
    } catch (error) {
        return sendServerError(res, error, '登入 API 錯誤');
    }
});

app.post('/api/logout', (req, res) => {
    const username = req.session?.username || '未知';
    req.session.destroy(async error => {
        if (error) return sendServerError(res, error, '登出 API 錯誤');
        res.clearCookie('inventory.sid');
        await addUpdateLog('info', `用戶 ${username} 登出`);
        return res.json({ success: true, message: '登出成功' });
    });
});

app.get('/api/auth-status', (req, res) => {
    const authenticated = Boolean(req.session?.authenticated);
    res.set('Cache-Control', 'private, no-store');
    return res.json({
        success: true,
        authenticated,
        user: authenticated ? {
            username: req.session.username,
            loginTime: req.session.loginTime
        } : null
    });
});

app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const storeType = parseStore(req.query.store);
        if (!storeType) return res.status(400).json({ success: false, error: '無效的賣場類型' });

        const [products, stats] = await Promise.all([
            getActiveProducts(storeType),
            getProductStats(storeType)
        ]);
        const dataVersion = buildDataVersion(storeType, stats);
        const etag = `W/"${Buffer.from(dataVersion).toString('base64url')}"`;

        res.set('Cache-Control', 'private, no-cache');
        res.set('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();

        return res.json({
            success: true,
            products,
            lastUpdate: stats.lastUpdate,
            total: stats.total,
            dataVersion,
            imageStats: {
                withImages: stats.withImages,
                withoutImages: stats.withoutImages,
                successRate: stats.imageSuccessRate
            }
        });
    } catch (error) {
        return sendServerError(res, error, '商品列表 API 錯誤');
    }
});

app.get('/api/sync-status', requireAuth, async (req, res) => {
    try {
        const storeType = parseStore(req.query.store);
        if (!storeType) return res.status(400).json({ success: false, error: '無效的賣場類型' });

        const [stats, syncState] = await Promise.all([
            getProductStats(storeType),
            getSyncState(storeType)
        ]);
        res.set('Cache-Control', 'private, no-store');
        return res.json({
            success: true,
            store: storeType,
            dataVersion: buildDataVersion(storeType, stats),
            total: stats.total,
            lastUpdate: stats.lastUpdate,
            sync: syncState
        });
    } catch (error) {
        return sendServerError(res, error, '同步狀態 API 錯誤');
    }
});

app.get('/api/price-changes', requireAuth, async (req, res) => {
    try {
        const storeType = req.query.store ? parseStore(req.query.store, null) : null;
        if (req.query.store && !storeType) {
            return res.status(400).json({ success: false, error: '無效的賣場類型' });
        }
        const changes = await getPriceChanges(storeType, req.query.limit);
        res.set('Cache-Control', 'private, no-store');
        return res.json({ success: true, changes, total: changes.length });
    } catch (error) {
        return sendServerError(res, error, '價格異動 API 錯誤');
    }
});

app.get('/api/update-logs', requireAuth, async (req, res) => {
    try {
        const page = parsePositiveInteger(req.query.page, 1, 100000);
        const limit = parsePositiveInteger(req.query.limit, 20, 100);
        const type = req.query.type && VALID_LOG_TYPES.has(req.query.type) ? req.query.type : null;
        const { logs, total } = await getUpdateLogs(limit, (page - 1) * limit, type);

        res.set('Cache-Control', 'private, no-store');
        return res.json({
            success: true,
            logs,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalLogs: total,
                hasMore: page * limit < total
            },
            summary: { totalLogs: total, isUpdating }
        });
    } catch (error) {
        return sendServerError(res, error, '更新日誌 API 錯誤');
    }
});

async function clearLogsHandler(req, res) {
    try {
        const oldCount = await clearUpdateLogs();
        await addUpdateLog('info', `手動清除了 ${oldCount} 條更新日誌`);
        return res.json({ success: true, message: `已清除 ${oldCount} 條更新日誌`, remainingLogs: 1 });
    } catch (error) {
        return sendServerError(res, error, '清除更新日誌 API 錯誤');
    }
}

app.delete('/api/update-logs', requireAuth, clearLogsHandler);
app.post('/api/clear-logs', requireAuth, clearLogsHandler);

// 唯一的 Web 同步入口。預設只做低流量檢查，force=true 才逐頁完整抓取。
app.post('/api/refresh', requireAuth, async (req, res) => {
    const store = req.body?.store || null;
    const force = req.body?.force === true;

    if (store && !VALID_STORES.has(store)) {
        return res.status(400).json({ success: false, error: '無效的賣場類型' });
    }
    if (isUpdating) {
        return res.status(409).json({ success: false, message: '同步工作正在執行中，請稍後再試' });
    }

    isUpdating = true;
    try {
        const result = await smartUpdate({ force, storeType: store });
        if (result.busy) return res.status(409).json({ success: false, message: result.summary });

        const [yuanzhengStats, youmaoStats] = await Promise.all([
            getProductStats('yuanzhengshan'),
            getProductStats('youmao')
        ]);

        return res.json({
            success: true,
            message: result.summary,
            result,
            yuanzhengshan: {
                total: yuanzhengStats.total,
                lastUpdate: yuanzhengStats.lastUpdate,
                imageStats: {
                    withImages: yuanzhengStats.withImages,
                    withoutImages: yuanzhengStats.withoutImages,
                    successRate: yuanzhengStats.imageSuccessRate
                }
            },
            youmao: {
                total: youmaoStats.total,
                lastUpdate: youmaoStats.lastUpdate,
                imageStats: {
                    withImages: youmaoStats.withImages,
                    withoutImages: youmaoStats.withoutImages,
                    successRate: youmaoStats.imageSuccessRate
                }
            }
        });
    } catch (error) {
        return sendServerError(res, error, '智慧同步 API 錯誤');
    } finally {
        isUpdating = false;
    }
});

app.get('/api/export', requireAuth, async (req, res) => {
    try {
        await streamProductWorkbook(res);
    } catch (error) {
        if (res.headersSent) {
            console.error('Excel 匯出串流失敗:', error);
            return res.end();
        }
        return sendServerError(res, error, 'Excel 匯出 API 錯誤');
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: '找不到此 API' });
});

if (require.main === module) {
    initializeDatabase()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`伺服器運行在 http://localhost:${PORT}`);
                console.log('✅ 資料庫已就緒；啟動時不執行平台爬蟲');
            });
        })
        .catch(error => {
            console.error('❌ 伺服器啟動失敗:', error.message);
            process.exit(1);
        });
}

module.exports = app;
