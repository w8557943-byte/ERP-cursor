import mongoose from 'mongoose';

const customerAliasSchema = new mongoose.Schema({
  alias: {
    type: String,
    required: true,
    trim: true
  },
  customerName: {
    type: String,
    trim: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  }
}, {
  timestamps: true,
  collection: 'customer_aliases'
});

// Compound index for alias lookup optimization
customerAliasSchema.index({ alias: 1 });

export default mongoose.model('CustomerAlias', customerAliasSchema);
