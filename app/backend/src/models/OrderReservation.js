import mongoose from 'mongoose';

const orderReservationSchema = new mongoose.Schema({
  orderNo: {
    type: String,
    required: true,
    unique: true
  },
  seq: {
    type: Number,
    required: true
  },
  date: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['RESERVED', 'USED', 'RELEASED'],
    default: 'RESERVED'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for finding expired numbers efficiently
orderReservationSchema.index({ status: 1, expiresAt: 1 });
orderReservationSchema.index({ date: 1, seq: 1 }, { unique: true });

export default mongoose.model('OrderReservation', orderReservationSchema);
