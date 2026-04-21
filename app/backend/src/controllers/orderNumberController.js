import orderNumberService from '../services/orderNumberService.js';

class OrderNumberController {
  async generate(req, res) {
    try {
      const result = await orderNumberService.generateOrderNumber();
      res.json({
        code: 200,
        message: 'Order number generated successfully',
        data: result
      });
    } catch (error) {
      console.error('Failed to generate order number:', error);
      res.status(500).json({
        code: 500,
        message: 'Failed to generate order number',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async confirm(req, res) {
    try {
      const { orderNo } = req.body;
      if (!orderNo) {
        return res.status(400).json({
          code: 400,
          message: 'orderNo is required'
        });
      }

      await orderNumberService.confirmOrderNumber(orderNo);
      res.json({
        code: 200,
        message: 'Order number confirmed successfully'
      });
    } catch (error) {
      console.error('Failed to confirm order number:', error);
      res.status(500).json({
        code: 500,
        message: 'Failed to confirm order number',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async release(req, res) {
    try {
      const { orderNo, reservationId } = req.body || {}
      if (!orderNo && !reservationId) {
        return res.status(400).json({ code: 400, message: 'orderNo or reservationId is required' })
      }
      const result = await orderNumberService.releaseOrderNumber({ orderNo, reservationId })
      if (!result) return res.status(404).json({ code: 404, message: 'Reservation not found' })
      res.json({ code: 200, message: 'Order number released successfully', data: { orderNo: result.orderNo, reservationId: result._id } })
    } catch (error) {
      console.error('Failed to release order number:', error);
      res.status(500).json({
        code: 500,
        message: 'Failed to release order number',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
  }

  async stats(req, res) {
    try {
      const today = new Date()
      const dateKey = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
      const OrderReservation = (await import('../models/OrderReservation.js')).default
      const OrderSequence = (await import('../models/OrderSequence.js')).default
      const [reservedCount, usedCount, releasedCount] = await Promise.all([
        OrderReservation.countDocuments({ date: dateKey, status: 'RESERVED' }),
        OrderReservation.countDocuments({ date: dateKey, status: 'USED' }),
        OrderReservation.countDocuments({ date: dateKey, status: 'RELEASED' }),
      ])
      const seqDoc = await OrderSequence.findOne({ date: dateKey })
      const currentSeq = seqDoc ? seqDoc.seq : 0
      res.json({ code: 200, data: { date: dateKey, currentSeq, reservedCount, usedCount, releasedCount } })
    } catch (error) {
      res.status(500).json({ code: 500, message: 'Failed to fetch order number stats', error: process.env.NODE_ENV === 'development' ? error.message : undefined })
    }
  }
}

export default new OrderNumberController();
