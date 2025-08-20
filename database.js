const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL 資料庫配置
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://inventory_etrp_user:WDJMfBCcsdDia908CWWeWLD4nswfhIgl@dpg-d2i2gp3uibrs73dqr3vg-a.singapore-postgres.render.com/inventory_etrp',
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false // Render 需要 SSL
    }
});

// 初始化資料庫表結構
async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🗄️ 正在初始化資料庫表結構...');
        
        // 檢查是否需要升級現有表格
        const checkColumnResult = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'products' AND column_name = 'store_type'
        `);
        
        if (checkColumnResult.rows.length === 0) {
            console.log('🔄 檢測到舊版本表格，執行升級...');
            
            // 如果表格存在但沒有store_type欄位，需要升級
            const tableExistsResult = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'products'
                )
            `);
            
            if (tableExistsResult.rows[0].exists) {
                // 表格存在，需要升級
                console.log('📊 備份現有商品資料...');
                
                // 添加store_type欄位
                await client.query(`
                    ALTER TABLE products 
                    ADD COLUMN store_type VARCHAR(20) DEFAULT 'yuanzhengshan'
                `);
                
                // 更新現有記錄的store_type
                await client.query(`
                    UPDATE products 
                    SET store_type = 'yuanzhengshan' 
                    WHERE store_type IS NULL
                `);
                
                // 設定store_type為NOT NULL
                await client.query(`
                    ALTER TABLE products 
                    ALTER COLUMN store_type SET NOT NULL
                `);
                
                // 刪除舊的主鍵約束
                await client.query(`
                    ALTER TABLE products 
                    DROP CONSTRAINT IF EXISTS products_pkey
                `);
                
                // 添加新的複合主鍵
                await client.query(`
                    ALTER TABLE products 
                    ADD CONSTRAINT products_pkey PRIMARY KEY (id, store_type)
                `);
                
                console.log('✅ 表格升級完成');
            } else {
                // 表格不存在，創建新表格
                await client.query(`
                    CREATE TABLE products (
                        id VARCHAR(20) NOT NULL,
                        store_type VARCHAR(20) NOT NULL DEFAULT 'yuanzhengshan',
                        name TEXT NOT NULL,
                        price INTEGER DEFAULT 0,
                        image_url TEXT,
                        product_url TEXT,
                        scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        is_active BOOLEAN DEFAULT TRUE,
                        PRIMARY KEY (id, store_type)
                    )
                `);
            }
        } else {
            console.log('✅ 表格結構已是最新版本');
        }
        
        // 創建更新日誌表
        await client.query(`
            CREATE TABLE IF NOT EXISTS update_logs (
                id SERIAL PRIMARY KEY,
                type VARCHAR(20) NOT NULL,
                message TEXT NOT NULL,
                details JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 創建索引以提升查詢效能
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);
            CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
            CREATE INDEX IF NOT EXISTS idx_update_logs_created_at ON update_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_update_logs_type ON update_logs(type);
        `);
        
        console.log('✅ 資料庫表結構初始化完成');
        
    } catch (error) {
        console.error('❌ 資料庫初始化失敗:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// 插入或更新商品
async function upsertProduct(product, storeType = 'yuanzhengshan') {
    const client = await pool.connect();
    
    try {
        const result = await client.query(`
            INSERT INTO products (id, store_type, name, price, image_url, product_url, scraped_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id, store_type) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                price = EXCLUDED.price,
                image_url = EXCLUDED.image_url,
                product_url = EXCLUDED.product_url,
                updated_at = EXCLUDED.updated_at,
                is_active = TRUE
            RETURNING *
        `, [
            product.id,
            storeType,
            product.name,
            product.price || 0,
            product.imageUrl || null,
            product.url || null,
            product.scrapedAt ? new Date(product.scrapedAt) : new Date(),
            new Date()
        ]);
        
        return result.rows[0];
    } finally {
        client.release();
    }
}

// 批量插入或更新商品
async function upsertProducts(products, storeType = 'yuanzhengshan') {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log(`📝 開始批量更新 ${products.length} 個${storeType}商品到資料庫...`);
        
        const results = [];
        const batchSize = 150; // 針對2GB RAM優化，增加批量大小
        
        for (let i = 0; i < products.length; i += batchSize) {
            const batch = products.slice(i, i + batchSize);
            
            for (const product of batch) {
                const result = await client.query(`
                    INSERT INTO products (id, store_type, name, price, image_url, product_url, scraped_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id, store_type) 
                    DO UPDATE SET 
                        name = EXCLUDED.name,
                        price = EXCLUDED.price,
                        image_url = EXCLUDED.image_url,
                        product_url = EXCLUDED.product_url,
                        updated_at = EXCLUDED.updated_at,
                        is_active = TRUE
                    RETURNING *
                `, [
                    product.id,
                    storeType,
                    product.name,
                    product.price || 0,
                    product.imageUrl || null,
                    product.url || null,
                    product.scrapedAt ? new Date(product.scrapedAt) : new Date(),
                    new Date()
                ]);
                
                results.push(result.rows[0]);
            }
            
            console.log(`✅ 已處理 ${Math.min(i + batchSize, products.length)}/${products.length} 個商品`);
        }
        
        await client.query('COMMIT');
        console.log(`🎉 批量更新完成，共處理 ${results.length} 個商品`);
        
        return results;
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 批量更新失敗:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// 獲取所有活躍商品
async function getActiveProducts(storeType = 'yuanzhengshan', limit = null, offset = 0) {
    const client = await pool.connect();
    
    try {
        let query = `
            SELECT id, store_type as "storeType", name, price, image_url as "imageUrl", product_url as "url", 
                   scraped_at as "scrapedAt", updated_at as "updatedAt"
            FROM products 
            WHERE is_active = TRUE AND store_type = $1
            ORDER BY updated_at DESC
        `;
        
        const params = [storeType];
        if (limit) {
            query += ` LIMIT $2 OFFSET $3`;
            params.push(limit, offset);
        }
        
        const result = await client.query(query, params);
        return result.rows;
        
    } finally {
        client.release();
    }
}

// 獲取商品統計
async function getProductStats(storeType = null) {
    const client = await pool.connect();
    
    try {
        if (storeType) {
            // 單一商店統計
            const result = await client.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 END) as with_images,
                    COUNT(CASE WHEN image_url IS NULL OR image_url = '' THEN 1 END) as without_images,
                    MAX(updated_at) as last_update
                FROM products 
                WHERE is_active = TRUE AND store_type = $1
            `, [storeType]);
            
            const stats = result.rows[0];
            const imageSuccessRate = stats.total > 0 ? 
                ((parseInt(stats.with_images) / parseInt(stats.total)) * 100).toFixed(1) : 0;
            
            return {
                total: parseInt(stats.total),
                withImages: parseInt(stats.with_images),
                withoutImages: parseInt(stats.without_images),
                imageSuccessRate: `${imageSuccessRate}%`,
                lastUpdate: stats.last_update
            };
        } else {
            // 所有商店統計
            const result = await client.query(`
                SELECT 
                    store_type,
                    COUNT(*) as total,
                    COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 END) as with_images,
                    COUNT(CASE WHEN image_url IS NULL OR image_url = '' THEN 1 END) as without_images,
                    MAX(updated_at) as last_update
                FROM products 
                WHERE is_active = TRUE 
                GROUP BY store_type
            `);
            
            const stats = {
                total: 0,
                yuanzhengshan: 0,
                youmao: 0,
                withImages: 0,
                withoutImages: 0,
                lastUpdate: null
            };
            
            result.rows.forEach(row => {
                const storeTotal = parseInt(row.total);
                const storeWithImages = parseInt(row.with_images);
                
                stats.total += storeTotal;
                stats.withImages += storeWithImages;
                stats.withoutImages += parseInt(row.without_images);
                stats[row.store_type] = storeTotal;
                
                if (!stats.lastUpdate || (row.last_update && row.last_update > stats.lastUpdate)) {
                    stats.lastUpdate = row.last_update;
                }
            });
            
            const imageSuccessRate = stats.total > 0 ? 
                ((stats.withImages / stats.total) * 100).toFixed(1) : 0;
            stats.imageSuccessRate = `${imageSuccessRate}%`;
            
            return stats;
        }
        
    } finally {
        client.release();
    }
}

// 標記商品為非活躍（下架）
async function deactivateProducts(productIds, storeType = 'yuanzhengshan') {
    const client = await pool.connect();
    
    try {
        if (productIds.length === 0) return [];
        
        const placeholders = productIds.map((_, index) => `$${index + 1}`).join(',');
        const result = await client.query(`
            UPDATE products 
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
            WHERE id IN (${placeholders}) AND store_type = $${productIds.length + 1}
            RETURNING id, name
        `, [...productIds, storeType]);
        
        return result.rows;
        
    } finally {
        client.release();
    }
}

// 比較並更新商品（增量更新）
async function compareAndUpdateProducts(newProducts, storeType = 'yuanzhengshan') {
    const client = await pool.connect();
    
    try {
        console.log(`🔍 開始比較${storeType}商品差異...`);
        
        // 獲取現有商品
        const existingResult = await client.query(`
            SELECT id, name, price, image_url, product_url, 
                   EXTRACT(EPOCH FROM updated_at) as updated_timestamp
            FROM products 
            WHERE is_active = TRUE AND store_type = $1
        `, [storeType]);
        
        const existingProducts = new Map(
            existingResult.rows.map(p => [p.id, {
                id: p.id,
                name: p.name,
                price: p.price,
                imageUrl: p.image_url,
                url: p.product_url,
                updatedTimestamp: p.updated_timestamp
            }])
        );
        
        const newProductsMap = new Map(newProducts.map(p => [p.id, p]));
        
        let newCount = 0;
        let modifiedCount = 0;
        let removedCount = 0;
        
        const productsToUpdate = [];
        
        // 檢查新增和修改的商品
        for (const [id, newProduct] of newProductsMap) {
            const existingProduct = existingProducts.get(id);
            
            if (!existingProduct) {
                // 新商品
                productsToUpdate.push(newProduct);
                newCount++;
            } else {
                // 檢查是否有變更
                const hasChanges = 
                    existingProduct.name !== newProduct.name ||
                    existingProduct.price !== newProduct.price ||
                    existingProduct.imageUrl !== newProduct.imageUrl ||
                    existingProduct.url !== newProduct.url;
                
                if (hasChanges) {
                    productsToUpdate.push(newProduct);
                    modifiedCount++;
                }
            }
        }
        
        // 檢查已下架的商品
        const removedProductIds = [];
        for (const [id] of existingProducts) {
            if (!newProductsMap.has(id)) {
                removedProductIds.push(id);
                removedCount++;
            }
        }
        
        console.log(`📊 差異分析: 新增 ${newCount}, 修改 ${modifiedCount}, 下架 ${removedCount}`);
        
        // 執行更新
        if (productsToUpdate.length > 0) {
            await upsertProducts(productsToUpdate, storeType);
        }
        
        if (removedProductIds.length > 0) {
            await deactivateProducts(removedProductIds, storeType);
        }
        
        return {
            newCount,
            modifiedCount,
            removedCount,
            totalUpdated: productsToUpdate.length
        };
        
    } finally {
        client.release();
    }
}

// 添加更新日誌
async function addUpdateLogToDB(type, message, details = null) {
    const client = await pool.connect();
    
    try {
        await client.query(`
            INSERT INTO update_logs (type, message, details)
            VALUES ($1, $2, $3)
        `, [type, message, details ? JSON.stringify(details) : null]);
        
    } catch (error) {
        console.error('添加更新日誌失敗:', error.message);
    } finally {
        client.release();
    }
}

// 獲取更新日誌
async function getUpdateLogs(limit = 50) {
    const client = await pool.connect();
    
    try {
        const result = await client.query(`
            SELECT id, type, message, details, created_at as timestamp
            FROM update_logs 
            ORDER BY created_at DESC 
            LIMIT $1
        `, [limit]);
        
        return result.rows.map(row => ({
            id: row.id,
            type: row.type,
            message: row.message,
            details: row.details,
            timestamp: row.timestamp.toISOString()
        }));
        
    } finally {
        client.release();
    }
}

// 清除更新日誌
async function clearUpdateLogs() {
    const client = await pool.connect();
    
    try {
        const result = await client.query('SELECT COUNT(*) as count FROM update_logs');
        const oldCount = parseInt(result.rows[0].count);
        
        await client.query('DELETE FROM update_logs');
        
        return oldCount;
        
    } finally {
        client.release();
    }
}

// 測試資料庫連接
async function testConnection() {
    const client = await pool.connect();
    
    try {
        const result = await client.query('SELECT NOW() as current_time');
        console.log('✅ 資料庫連接成功:', result.rows[0].current_time);
        return true;
    } catch (error) {
        console.error('❌ 資料庫連接失敗:', error.message);
        return false;
    } finally {
        client.release();
    }
}

// 關閉連接池
async function closePool() {
    await pool.end();
}

module.exports = {
    pool,
    initializeDatabase,
    upsertProduct,
    upsertProducts,
    getActiveProducts,
    getProductStats,
    deactivateProducts,
    compareAndUpdateProducts,
    addUpdateLogToDB,
    getUpdateLogs,
    clearUpdateLogs,
    testConnection,
    closePool
};
