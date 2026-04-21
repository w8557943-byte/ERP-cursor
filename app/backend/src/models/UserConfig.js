import mongoose from 'mongoose';

const userConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed
  },
  userId: {
    type: String
  }
}, {
  timestamps: true,
  collection: 'user_configs'
});

userConfigSchema.index({ key: 1 });
userConfigSchema.index({ userId: 1 });

export default mongoose.model('UserConfig', userConfigSchema);
