import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = express.Router()

router.use(authenticateToken, requireUser)

router.all('*', asyncHandler(async (req, res) => {
  return res.status(410).json({
    success: false,
    message: '生产管理接口已迁移至云端服务'
  })
}))

export default router
