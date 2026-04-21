// 数据验证中间件
export const validateMiddleware = (req, res, next) => {
  // 基础验证中间件，实际项目中可以根据需要添加具体验证逻辑
  next();
};