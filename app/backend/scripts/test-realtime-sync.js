
import path from 'path';
import os from 'os';

process.env.SQLITE_DB_PATH = path.join(os.tmpdir(), `test_erp_${Date.now()}.sqlite`);
console.log('Using temp DB:', process.env.SQLITE_DB_PATH);

const { sequelize, syncDatabase } = await import('../src/utils/sqliteDatabase.js');
const { default: realTimeSyncService } = await import('../src/services/realTimeSyncService.js');
const { default: Product } = await import('../src/models/local/Product.js');
const { default: SyncQueue } = await import('../src/models/local/SyncQueue.js');


const mockClient = {
    connected: true,
    publish: (topic, message, options, cb) => {
        console.log(`[MockMQTT] Published to ${topic}`);
        if (cb) cb(null);
    },
    subscribe: (topic, options, cb) => {
        console.log(`[MockMQTT] Subscribed to ${topic}`);
        if (cb) cb(null);
    },
    on: () => {}
};

realTimeSyncService.connect = function() {
    console.log('[Mock] Connecting to MQTT...');
    this.client = mockClient;
    this.isConnected = true;
    console.log('[Mock] Connected.');
};

async function run() {
    try {
        await syncDatabase(true);
        console.log('Database connected and synced.');
        
        await realTimeSyncService.initialize();

        console.log('Creating test product...');
        const product = await Product.create({
            productCode: 'RT-TEST-' + Date.now(),
            name: 'RealTime Test Product',
            category: 'Test',
            unit: 'pcs',
            price: 200,
            cost: 150,
            stock: 50,
            status: 'active'
        });

        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('Simulating Offline...');
        realTimeSyncService.isConnected = false;
        mockClient.connected = false;

        console.log('Updating product (offline)...');
        await product.update({ price: 250 });

        await new Promise(resolve => setTimeout(resolve, 500));

        const queueItems = await SyncQueue.findAll();
        console.log(`Queue items: ${queueItems.length}`);
        if (queueItems.length > 0) {
            console.log('Queue item topic:', queueItems[0].topic);
        }

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        await sequelize.close();
    }
}

run();
