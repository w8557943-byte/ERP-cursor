import express from 'express';
import orderNumberController from '../controllers/orderNumberController.js';
import { authenticateToken, requireUser } from '../middleware/auth.js';

const router = express.Router();

router.post('/generate', authenticateToken, requireUser, orderNumberController.generate);
router.post('/confirm', authenticateToken, requireUser, orderNumberController.confirm);
router.post('/release', authenticateToken, requireUser, orderNumberController.release);
router.get('/stats', authenticateToken, requireUser, orderNumberController.stats);

export default router;
