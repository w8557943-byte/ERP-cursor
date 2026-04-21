import express from 'express'
import shippingNumberController from '../controllers/shippingNumberController.js'
import { authenticateToken, requireAdmin } from '../middleware/auth.js'

const router = express.Router()

router.post('/generate', authenticateToken, requireAdmin, shippingNumberController.generate)

export default router
