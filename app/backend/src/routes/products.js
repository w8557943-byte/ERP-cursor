import express from 'express'
import { Op } from 'sequelize'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Product from '../models/local/Product.js'

const router = express.Router()

let sqliteReadyPromise = null
const ensureSqliteReady = async () => {
  if (!sqliteReadyPromise) {
    sqliteReadyPromise = syncDatabase(false)
  }
  await sqliteReadyPromise
}

const safeNumber = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const normalizeProduct = (row) => {
  if (!row) return null
  const src = typeof row.toJSON === 'function' ? row.toJSON() : row
  const id = String(src.id ?? '').trim()
  const name = String(src.name ?? '').trim()
  const productCode = String(src.productCode ?? '').trim()
  return {
    ...src,
    id,
    _id: id,
    key: id,
    name,
    productCode,
    code: productCode
  }
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const {
    page = 1,
    pageSize = 10,
    limit = '',
    keyword = '',
    search = '',
    q = '',
    category = '',
    status = ''
  } = req.query || {}

  const finalPage = Math.max(1, safeNumber(page, 1))
  const requestedSize = safeNumber(pageSize || limit, 10)
  const finalPageSize = Math.min(200, Math.max(1, requestedSize))
  const offset = (finalPage - 1) * finalPageSize

  const kw = String(keyword || search || q || '').trim()
  const categoryFilter = String(category || '').trim()
  const statusFilter = String(status || '').trim()

  const where = {}
  if (categoryFilter) where.category = categoryFilter
  if (statusFilter) where.status = statusFilter

  if (kw) {
    const like = `%${kw}%`
    where[Op.or] = [
      { productCode: { [Op.like]: like } },
      { name: { [Op.like]: like } },
      { category: { [Op.like]: like } },
      { subcategory: { [Op.like]: like } },
      { specification: { [Op.like]: like } },
      { material: { [Op.like]: like } }
    ]
    const maybeId = Number(kw)
    if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
      where[Op.or].unshift({ id: maybeId })
    }
  }

  const { rows, count } = await Product.findAndCountAll({
    where,
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    offset,
    limit: finalPageSize
  })

  const products = (rows || []).map(normalizeProduct).filter(Boolean)
  const total = Number(count || 0)

  return res.json({
    success: true,
    data: {
      products,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / finalPageSize) : 0
      },
      _meta: { source: 'local_sqlite' }
    }
  })
}))

router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '产品ID不能为空' })

  let product = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    product = await Product.findByPk(maybeId)
  }
  if (!product) {
    product = await Product.findOne({ where: { cloudId: idRaw } })
  }
  if (!product) {
    product = await Product.findOne({ where: { productCode: idRaw } })
  }

  if (!product) return res.status(404).json({ success: false, message: '产品不存在' })
  return res.json({ success: true, data: { product: normalizeProduct(product) } })
}))

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const body = req.body || {}
  const productCode = String(body.productCode || body.code || '').trim()
  const name = String(body.name || '').trim()
  const category = String(body.category || '').trim()

  if (!productCode || !name || !category) {
    return res.status(400).json({ success: false, message: '产品编码、名称、分类不能为空' })
  }

  const created = await Product.create({
    productCode,
    name,
    category,
    subcategory: body.subcategory != null ? String(body.subcategory) : undefined,
    specification: body.specification != null ? String(body.specification) : undefined,
    material: body.material != null ? String(body.material) : undefined,
    size: body.size && typeof body.size === 'object' ? body.size : undefined,
    weight: body.weight && typeof body.weight === 'object' ? body.weight : undefined,
    color: body.color != null ? String(body.color) : undefined,
    unit: body.unit != null ? String(body.unit) : undefined,
    price: body.price != null ? Number(body.price) : 0,
    cost: body.cost != null ? Number(body.cost) : 0,
    profitMargin: body.profitMargin != null ? Number(body.profitMargin) : undefined,
    stock: body.stock != null ? parseInt(body.stock) : undefined,
    minStock: body.minStock != null ? parseInt(body.minStock) : undefined,
    maxStock: body.maxStock != null ? parseInt(body.maxStock) : undefined,
    safetyStock: body.safetyStock != null ? parseInt(body.safetyStock) : undefined,
    status: body.status != null ? String(body.status) : undefined,
    isCustomizable: body.isCustomizable != null ? Boolean(body.isCustomizable) : undefined,
    leadTime: body.leadTime != null ? parseInt(body.leadTime) : undefined
  })

  return res.status(201).json({ success: true, message: '产品创建成功', data: { product: normalizeProduct(created) } })
}))

router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '产品ID不能为空' })

  let product = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    product = await Product.findByPk(maybeId)
  }
  if (!product) {
    product = await Product.findOne({ where: { cloudId: idRaw } })
  }
  if (!product) return res.status(404).json({ success: false, message: '产品不存在' })

  const body = req.body || {}
  const patch = {}
  const pick = (key, v) => {
    if (v === undefined) return
    patch[key] = v
  }

  pick('productCode', body.productCode != null ? String(body.productCode) : (body.code != null ? String(body.code) : undefined))
  pick('name', body.name != null ? String(body.name) : undefined)
  pick('category', body.category != null ? String(body.category) : undefined)
  pick('subcategory', body.subcategory != null ? String(body.subcategory) : undefined)
  pick('specification', body.specification != null ? String(body.specification) : undefined)
  pick('material', body.material != null ? String(body.material) : undefined)
  pick('size', body.size && typeof body.size === 'object' ? body.size : undefined)
  pick('weight', body.weight && typeof body.weight === 'object' ? body.weight : undefined)
  pick('color', body.color != null ? String(body.color) : undefined)
  pick('unit', body.unit != null ? String(body.unit) : undefined)
  pick('price', body.price != null ? Number(body.price) : undefined)
  pick('cost', body.cost != null ? Number(body.cost) : undefined)
  pick('profitMargin', body.profitMargin != null ? Number(body.profitMargin) : undefined)
  pick('stock', body.stock != null ? parseInt(body.stock) : undefined)
  pick('minStock', body.minStock != null ? parseInt(body.minStock) : undefined)
  pick('maxStock', body.maxStock != null ? parseInt(body.maxStock) : undefined)
  pick('safetyStock', body.safetyStock != null ? parseInt(body.safetyStock) : undefined)
  pick('status', body.status != null ? String(body.status) : undefined)
  pick('isCustomizable', body.isCustomizable != null ? Boolean(body.isCustomizable) : undefined)
  pick('leadTime', body.leadTime != null ? parseInt(body.leadTime) : undefined)

  await product.update(patch)
  return res.json({ success: true, message: '产品更新成功', data: { product: normalizeProduct(product) } })
}))

router.patch('/:id/stock', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '产品ID不能为空' })

  let product = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    product = await Product.findByPk(maybeId)
  }
  if (!product) {
    product = await Product.findOne({ where: { cloudId: idRaw } })
  }
  if (!product) return res.status(404).json({ success: false, message: '产品不存在' })

  const body = req.body || {}
  const stockDelta = body.delta != null ? safeNumber(body.delta, NaN) : NaN
  const stockValue = body.stock != null ? safeNumber(body.stock, NaN) : NaN

  if (Number.isFinite(stockValue)) {
    await product.update({ stock: Math.max(0, Math.floor(stockValue)) })
  } else if (Number.isFinite(stockDelta)) {
    const next = Math.max(0, Math.floor(Number(product.stock || 0) + stockDelta))
    await product.update({ stock: next })
  } else {
    return res.status(400).json({ success: false, message: '缺少库存调整参数' })
  }

  return res.json({ success: true, message: '库存更新成功', data: { product: normalizeProduct(product) } })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '产品ID不能为空' })

  let product = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    product = await Product.findByPk(maybeId)
  }
  if (!product) {
    product = await Product.findOne({ where: { cloudId: idRaw } })
  }
  if (!product) return res.status(404).json({ success: false, message: '产品不存在' })

  await product.destroy()
  return res.json({ success: true, message: '产品删除成功' })
}))

export default router
