/**
 * Logging Utility
 * 
 * Centralized logging with structured output and log levels.
 * Future: Can be extended to write to files or external services.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

/**
 * Format log message with timestamp and context
 * @param {string} level - Log level
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {object} context - Additional context
 * @returns {string}
 */
function formatMessage(level, module, message, context) {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level}] [${module}] ${message}${contextStr}`;
}

/**
 * Log debug message
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {object} context - Additional context
 */
export function debug(module, message, context) {
  if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
    console.debug(formatMessage('DEBUG', module, message, context));
  }
}

/**
 * Log info message
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {object} context - Additional context
 */
export function info(module, message, context) {
  if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
    console.log(formatMessage('INFO', module, message, context));
  }
}

/**
 * Log warning message
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {object} context - Additional context
 */
export function warn(module, message, context) {
  if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
    console.warn(formatMessage('WARN', module, message, context));
  }
}

/**
 * Log error message
 * @param {string} module - Module name
 * @param {string} message - Log message
 * @param {object} context - Additional context
 */
export function error(module, message, context) {
  if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
    console.error(formatMessage('ERROR', module, message, context));
  }
}

/**
 * Create a module-specific logger
 * @param {string} moduleName - Name of the module
 * @returns {object} Logger instance
 */
export function createLogger(moduleName) {
  return {
    debug: (message, context) => debug(moduleName, message, context),
    info: (message, context) => info(moduleName, message, context),
    warn: (message, context) => warn(moduleName, message, context),
    error: (message, context) => error(moduleName, message, context),
  };
}
