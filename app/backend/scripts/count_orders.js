import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../src/models/Order.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ronghe-erp';

async function countOrders() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const count = await Order.countDocuments({});
    console.log(`Total orders in local database: ${count}`);
    
    const orders = await Order.find({}, 'orderNo customerName createdAt').sort({ createdAt: -1 }).limit(10);
    console.log('Recent 10 orders:');
    orders.forEach(o => {
      console.log(`- ${o.orderNo} (${o.customerName}) - ${o.createdAt}`);
    });
    
  } catch (error) {
    console.error('Error counting orders:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
}

countOrders();
