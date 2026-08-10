require('dotenv').config();

const { initializeDatabase, closePool } = require('../database');
const { smartUpdate } = require('../smart_scraper');

const VALID_STORES = new Set(['yuanzhengshan', 'youmao']);

function parseOptions(argv = process.argv.slice(2), now = new Date()) {
    const storeArg = argv.find(arg => arg.startsWith('--store='));
    const storeType = storeArg ? storeArg.split('=')[1] : null;
    if (storeType && !VALID_STORES.has(storeType)) {
        throw new Error(`不支援的賣場: ${storeType}`);
    }

    const scheduled = argv.includes('--scheduled');
    const weeklyFullDayUtc = Number.parseInt(process.env.WEEKLY_FULL_SYNC_DAY_UTC || '0', 10);
    const weeklyFullEnabled = process.env.WEEKLY_FULL_SYNC !== 'false';
    const force = argv.includes('--force') || (
        scheduled && weeklyFullEnabled && now.getUTCDay() === weeklyFullDayUtc
    );

    return { storeType, force, scheduled };
}

async function main() {
    const options = parseOptions();
    console.log(`🚀 獨立同步工作啟動: mode=${options.force ? 'full' : 'smart'}, store=${options.storeType || 'all'}`);

    await initializeDatabase();
    const result = await smartUpdate(options);

    if (result.busy) {
        console.log(result.summary);
        return;
    }

    const failures = ['yuanzhengshan', 'youmao']
        .map(store => result[store])
        .filter(storeResult => storeResult && storeResult.error);

    console.log(result.summary);
    if (failures.length > 0) {
        throw new Error(failures.map(failure => failure.error).join('; '));
    }
}

if (require.main === module) {
    main()
        .catch(error => {
            console.error('❌ 獨立同步工作失敗:', error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            await closePool();
        });
}

module.exports = { parseOptions, main };
