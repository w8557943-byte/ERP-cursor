import batchSyncService from '../src/services/batchSyncService.js';
import { sequelize } from '../src/utils/sqliteDatabase.js';
import Product from '../src/models/local/Product.js';
import syncService from '../src/services/syncService.js';
import syncManager from '../src/services/syncManager.js';

// Mock syncService.sync
syncService.sync = async (item, modelName) => {
    console.log(`[Mock] Syncing ${modelName} ${item.id}`);
    await new Promise(resolve => setTimeout(resolve, 50));
    return { success: true };
};

// Mock syncManager.broadcastSyncUpdate
syncManager.broadcastSyncUpdate = (type, data) => {
    // Only log essential info
    if (type === 'batch_progress') {
        const p = data.progress;
        console.log(`[Broadcast] ${type}: ${p.processed}/${p.total} (Success: ${p.success}, Failed: ${p.failed})`);
    } else {
        console.log(`[Broadcast] ${type}:`, data.status);
    }
};

async function run() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        // Create a dummy product
        const product = await Product.create({
            productCode: 'TEST-' + Date.now(),
            name: 'Test Product',
            category: 'Test',
            unit: 'pcs',
            price: 100,
            stock: 10,
            status: 'active'
        });
        console.log(`Created test product: ${product.id}`);

        console.log('Starting batch sync...');
        
        // We manually create a job and run it to await completion
        const job = batchSyncService.createJob({ since: null });
        
        // Run it
        await batchSyncService.runFullSyncJob(job.id);

        console.log('Sync finished.');
        console.log('Job status:', job.status);
        console.log('Job progress:', job.progress);

        // Cleanup
        await product.destroy();

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        await sequelize.close();
    }
}

run();
