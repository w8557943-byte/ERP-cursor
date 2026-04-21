import express from 'express'
import { Op } from 'sequelize'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Order from '../models/local/Order.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

let sqliteReadyPromise = null
const ensureSqliteReady = async () => {
  if (!sqliteReadyPromise) {
    sqliteReadyPromise = syncDatabase(false)
  }
  await sqliteReadyPromise
}

const buildLocalStats = async (salesTrendRange) => {
  await ensureSqliteReady()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const rangeKey = String(salesTrendRange || 'month').toLowerCase()
  const days = rangeKey === 'year' ? 365 : (rangeKey === 'quarter' ? 90 : 30)
  const windowStart = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const monthSalesRaw = await Order.sum('finalAmount', {
    where: { createdAt: { [Op.gte]: monthStart, [Op.lt]: nextMonthStart } }
  }).catch(() => 0)
  const monthSales = Number(monthSalesRaw || 0)

  const rows = await Order.findAll({
    attributes: ['createdAt', 'finalAmount', 'totalAmount'],
    where: { createdAt: { [Op.gte]: windowStart, [Op.lt]: tomorrowStart } },
    order: [['createdAt', 'ASC']]
  }).catch(() => [])

  const bucket = new Map()
  for (let i = 0; i < days; i += 1) {
    const d = new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    bucket.set(label, 0)
  }

  for (const r of rows || []) {
    const src = typeof r.toJSON === 'function' ? r.toJSON() : r
    const t = src?.createdAt instanceof Date ? src.createdAt.getTime() : Date.parse(String(src?.createdAt || ''))
    if (!Number.isFinite(t)) continue
    const d = new Date(t)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!bucket.has(label)) continue
    const v = Number(src?.finalAmount ?? src?.totalAmount ?? 0)
    bucket.set(label, (bucket.get(label) || 0) + (Number.isFinite(v) ? v : 0))
  }

  const trendByDay = Array.from(bucket.entries()).map(([label, value]) => ({ label, value: Number(value || 0) }))

  return {
    business: {
      monthSales,
      monthYoY: 0,
      monthGrossProfit: 0,
      monthGrossMargin: 0
    },
    chartData: {
      trendByDay
    },
    _meta: { source: 'local_sqlite' }
  }
}

/**
 * GET /api/data-management/stats
 * 获取经营数据统计
 * 
 * Query Parameters:
 * - salesTrendRange: 'month' | 'quarter' | 'year' (默认: 'month')
 * 
 * Returns:
 * {
 *   success: boolean,
 *   data: {
 *     business: {
 *       monthSales: number,
 *       monthYoY: number,
 *       monthGrossProfit: number,
 *       monthGrossMargin: number
 *     },
 *     chartData: {
 *       trendByDay: Array<{ label: string, value: number }>
 *     }
 *   },
 *   message?: string
 * }
 */
router.get('/stats', 
  authenticateToken, 
  requireUser, 
  asyncHandler(async (req, res) => {
    const { salesTrendRange = 'month' } = req.query

    if (isOfflineMode()) {
      const local = await buildLocalStats(salesTrendRange)
      return res.json({ success: true, data: local })
    }

    // 确保云服务已初始化
    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
      const local = await buildLocalStats(salesTrendRange).catch(() => null)
      if (local) return res.json({ success: true, data: local })
      return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }

    // 提取查询参数
    // 调用云函数
    try {
      const result = await cloudbaseService.callFunction('erp-api', {
        action: 'getDataManagementStats',
        salesTrendRange,
        userId: req.user?.id,
        token: req.headers.authorization
      })
      
      // 转换数据格式
      const data = result?.result?.data || {}
      const business = data.business || {}
      const chartData = data.chartData || {}
      
      return res.json({
        success: true,
        data: {
          business: {
            monthSales: Number(business.monthSales || 0),
            monthYoY: Number(business.monthYoY || 0),
            monthGrossProfit: Number(business.monthGrossProfit || 0),
            monthGrossMargin: Number(business.monthGrossMargin || 0)
          },
          chartData: {
            trendByDay: Array.isArray(chartData.trendByDay) 
              ? chartData.trendByDay 
              : []
          }
        }
      })
    } catch (error) {
      const local = await buildLocalStats(salesTrendRange).catch(() => null)
      if (local) return res.json({ success: true, data: local })
      console.error('调用云函数失败:', error)
      return res.status(500).json({ success: false, message: '获取统计数据失败', data: { business: { monthSales: 0, monthYoY: 0, monthGrossProfit: 0, monthGrossMargin: 0 }, chartData: { trendByDay: [] } } })
    }
  })
)

export default router
