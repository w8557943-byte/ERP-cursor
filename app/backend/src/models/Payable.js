import mongoose from 'mongoose';

const payableSchema = new mongoose.Schema({
  // Flexible schema to accommodate various payable fields
  // Common fields likely include:
  // supplier: String or ObjectId
  // amount: Number
  // status: String
  // dueDate: Date
  // invoiceNumber: String
}, {
  timestamps: true,
  strict: false, // Allow flexible fields
  collection: 'payables'
});

export default mongoose.model('Payable', payableSchema);
