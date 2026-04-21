import mongoose from 'mongoose'

const orderNumberLogSchema = new mongoose.Schema({
  action: { type: String, enum: ['generate', 'reused', 'confirm', 'release'], required: true },
  orderNo: { type: String, required: true },
  seq: { type: Number },
  date: { type: String },
  source: { type: String, default: 'pc' },
  reservationId: { type: String },
  timestamp: { type: Date, default: Date.now }
})

orderNumberLogSchema.index({ action: 1, timestamp: -1 })
orderNumberLogSchema.index({ date: 1, seq: 1 })

export default mongoose.model('OrderNumberLog', orderNumberLogSchema)
