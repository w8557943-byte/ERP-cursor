import { sequelize, syncDatabase } from '../utils/sqliteDatabase.js'
import Product from '../models/local/Product.js'

const testLocalProduct = async () => {
  try {
    console.log('Testing SQLite connection and Product model...')
    
    // 1. Sync database (creates table)
    await syncDatabase(true) // force: true will drop table if exists

    // 2. Create a sample product
    console.log('Creating sample product...')
    const newProduct = await Product.create({
      productCode: 'LOC-001',
      name: 'Local Test Product',
      category: 'Test Category',
      price: 99.99,
      cost: 50.00,
      stock: 100,
      size: { length: 10, width: 20, height: 30, unit: 'cm' },
      cloudId: 'cloud-123-abc'
    })

    console.log('Product created:', newProduct.toJSON())

    // 3. Query the product
    console.log('Querying product...')
    const foundProduct = await Product.findOne({
      where: { productCode: 'LOC-001' }
    })

    if (foundProduct) {
      console.log('Product found:', foundProduct.toJSON())
      console.log('Size (JSON):', foundProduct.size)
    } else {
      console.error('Product not found!')
    }

    // 4. Test JSON update
    console.log('Updating product size...')
    foundProduct.size = { length: 15, width: 25, height: 35, unit: 'cm' }
    await foundProduct.save()
    console.log('Product updated. New size:', foundProduct.size)

    console.log('Test completed successfully.')
    process.exit(0)
  } catch (error) {
    console.error('Test failed:', error)
    process.exit(1)
  }
}

testLocalProduct()
