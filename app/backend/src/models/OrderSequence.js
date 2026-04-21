import mongoose from 'mongoose';

const orderSequenceSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true
  },
  seq: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('OrderSequence', orderSequenceSchema);
