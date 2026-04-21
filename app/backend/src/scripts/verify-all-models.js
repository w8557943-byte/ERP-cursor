import { sequelize, syncDatabase } from '../utils/sqliteDatabase.js'
import Product from '../models/local/Product.js'
import Customer from '../models/local/Customer.js'
import Order from '../models/local/Order.js'
import syncService from '../services/syncService.js'

// Mock sync to avoid cloud calls during verification
syncService.sync = async (entity, collectionName) => {
  // console.log(`⚡ [Mock Sync] Skipped for ${collectionName}`)
  return true
}
syncService.syncProduct = async (product) => {
  return true
}

const verifyAllModels = async () => {
  try {
    console.log('🔄 Verifying SQLite Models...')
    
    // 1. Sync Database
    console.log('📦 Syncing database (force: true)...')
    await syncDatabase(true) // Re-create tables
    console.log('✅ Database synced.')

    // 2. Test Customer
    console.log('\n👤 Testing Customer Model...')
    const customer = await Customer.create({
      customerCode: 'CUST-001',
      name: 'Test Customer',
      contactPerson: 'John Doe',
      phone: '13800138000',
      email: 'john@example.com',
      status: 'active'
    })
    console.log(`✅ Customer created: ${customer.name} (${customer.customerCode})`)
    
    // 3. Test Product
    console.log('\n📦 Testing Product Model...')
    const product = await Product.create({
      productCode: 'PROD-001',
      name: 'Test Product',
      category: 'Electronics',
      price: 199.99,
      cost: 100.00,
      stock: 50
    })
    console.log(`✅ Product created: ${product.name} (${product.productCode})`)

    // 4. Test Order
    console.log('\n📝 Testing Order Model...')
    const order = await Order.create({
      orderNo: 'ORD-20231027-001',
      customerId: customer.id,
      customerName: customer.name,
      totalAmount: 199.99,
      finalAmount: 199.99, // Required field
      status: 'pending',
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          price: 199.99
        }
      ]
    })
    console.log(`✅ Order created: ${order.orderNo}`)
    console.log(`   Items: ${JSON.stringify(order.items)}`)

    // 5. Verify Retrieval
    console.log('\n🔍 Verifying Data Retrieval...')
    const fetchedOrder = await Order.findOne({ 
      where: { orderNo: 'ORD-20231027-001' }
    })
    
    if (fetchedOrder) {
      console.log(`✅ Retrieved Order: ${fetchedOrder.orderNo}`)
      console.log(`   Sync Status: ${fetchedOrder.syncStatus}`)
    } else {
      console.error('❌ Failed to retrieve order')
      process.exit(1)
    }

    console.log('\n🎉 All verifications passed!')
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Verification Failed:', error)
    process.exit(1)
  }
}

verifyAllModels()
