const ExcelJS = require('exceljs');
const { getActiveProducts, getProductStats } = require('./database');

function safeHyperlink(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function createWorksheet(workbook, storeName) {
    const worksheet = workbook.addWorksheet(storeName);
    worksheet.columns = [
        { header: '商品名稱', key: 'name', width: 50 },
        { header: '價格', key: 'price', width: 15 },
        { header: '圖片連結', key: 'image', width: 20 },
        { header: '商品連結', key: 'link', width: 20 },
        { header: '更新時間', key: 'updateTime', width: 18 }
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };
    worksheet.getRow(1).height = 30;
    return worksheet;
}

function fillWorksheetData(worksheet, products) {
    products.forEach((product, index) => {
        const rowIndex = index + 2;
        worksheet.addRow({
            name: String(product.name || ''),
            price: `NT$ ${Number(product.price || 0).toLocaleString('zh-TW')}`,
            image: '點擊查看圖片',
            link: '點擊查看商品',
            updateTime: new Date(product.updatedAt || Date.now()).toLocaleString('zh-TW')
        });

        const imageCell = worksheet.getCell(rowIndex, 3);
        const imageUrl = safeHyperlink(product.imageUrl);
        if (imageUrl && !imageUrl.includes('item-no-image.svg')) {
            imageCell.value = { text: '🖼️ 點擊查看圖片', hyperlink: imageUrl };
            imageCell.font = { color: { argb: 'FF009900' }, underline: true };
        } else {
            imageCell.value = '❌ 無圖片';
            imageCell.font = { color: { argb: 'FF999999' } };
        }

        const linkCell = worksheet.getCell(rowIndex, 4);
        const productUrl = safeHyperlink(product.url);
        if (productUrl) {
            linkCell.value = { text: '🔗 點擊查看商品', hyperlink: productUrl };
            linkCell.font = { color: { argb: 'FF0066CC' }, underline: true };
        } else {
            linkCell.value = '❌ 無連結';
            linkCell.font = { color: { argb: 'FF999999' } };
        }
        worksheet.getRow(rowIndex).height = 20;
    });
}

function addSummaryWorksheet(workbook, storeData) {
    const worksheet = workbook.addWorksheet('統計摘要');
    worksheet.columns = [
        { header: '賣場', key: 'store', width: 30 },
        { header: '商品總數', key: 'total', width: 15 },
        { header: '有圖片', key: 'withImages', width: 15 },
        { header: '無圖片', key: 'withoutImages', width: 15 },
        { header: '圖片成功率', key: 'successRate', width: 15 },
        { header: '最後更新', key: 'lastUpdate', width: 25 }
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCCCFF' }
    };

    for (const store of storeData) {
        if (store.products.length === 0) continue;
        worksheet.addRow({
            store: store.summaryName,
            total: store.stats.total,
            withImages: store.stats.withImages,
            withoutImages: store.stats.withoutImages,
            successRate: store.stats.imageSuccessRate,
            lastUpdate: store.stats.lastUpdate
                ? new Date(store.stats.lastUpdate).toLocaleString('zh-TW')
                : '-'
        });
    }

    const totalProducts = storeData.reduce((sum, store) => sum + store.products.length, 0);
    const totalWithImages = storeData.reduce((sum, store) => sum + store.stats.withImages, 0);
    const totalWithoutImages = storeData.reduce((sum, store) => sum + store.stats.withoutImages, 0);
    worksheet.addRow({
        store: '總計',
        total: totalProducts,
        withImages: totalWithImages,
        withoutImages: totalWithoutImages,
        successRate: totalProducts > 0 ? `${((totalWithImages / totalProducts) * 100).toFixed(1)}%` : '0%',
        lastUpdate: new Date().toLocaleString('zh-TW')
    });
    worksheet.lastRow.font = { bold: true };
    worksheet.lastRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCC00' }
    };
}

async function streamProductWorkbook(res) {
    const [yuanzhengProducts, youmaoProducts, yuanzhengStats, youmaoStats] = await Promise.all([
        getActiveProducts('yuanzhengshan'),
        getActiveProducts('youmao'),
        getProductStats('yuanzhengshan'),
        getProductStats('youmao')
    ]);

    if (yuanzhengProducts.length === 0 && youmaoProducts.length === 0) {
        res.status(400).json({ success: false, error: '兩個賣場都沒有商品資料，請先執行商品抓取' });
        return;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '商品管理系統';
    workbook.lastModifiedBy = '自動匯出';
    workbook.created = new Date();
    workbook.modified = new Date();

    const storeData = [
        {
            worksheetName: '源正山鋼索五金行',
            summaryName: '源正山 (Yahoo拍賣／外匯嚴選)',
            products: yuanzhengProducts,
            stats: yuanzhengStats
        },
        {
            worksheetName: '友茂工具-露天',
            summaryName: '友茂工具 (露天市集)',
            products: youmaoProducts,
            stats: youmaoStats
        }
    ];

    for (const store of storeData) {
        if (store.products.length === 0) continue;
        fillWorksheetData(createWorksheet(workbook, store.worksheetName), store.products);
    }
    addSummaryWorksheet(workbook, storeData);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=products_${timestamp}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = { safeHyperlink, streamProductWorkbook };
