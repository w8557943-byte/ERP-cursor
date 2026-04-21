// 简单的日志工具
const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
const noop = () => {};
const formatLine = (level, message) => `[${level}] ${new Date().toISOString()} - ${message}`;

export const logger = {
  info: isTestEnv ? noop : (message, ...args) => console.log(formatLine('INFO', message), ...args),
  error: isTestEnv ? noop : (message, ...args) => console.error(formatLine('ERROR', message), ...args),
  warn: isTestEnv ? noop : (message, ...args) => console.warn(formatLine('WARN', message), ...args),
  debug: isTestEnv ? noop : (message, ...args) => console.debug(formatLine('DEBUG', message), ...args)
};
