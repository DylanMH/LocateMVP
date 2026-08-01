/**
 * Environment-gated logging utility
 * Only logs in development, silent in production
 * 
 * For enterprise scale: reduces noise in production logs
 * and provides consistent logging interface
 */

const isDev = __DEV__;

export const logger = {
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },
  
  info: (...args: any[]) => {
    if (isDev) {
      console.info(...args);
    }
  },
  
  warn: (...args: any[]) => {
    // Always show warnings
    console.warn(...args);
  },
  
  error: (...args: any[]) => {
    // Always show errors
    console.error(...args);
  },
  
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },
};

/**
 * Performance measurement utility
 * Tracks slow operations and logs warnings
 */
export async function measurePerformance<T>(
  operationName: string,
  operation: () => Promise<T>,
  slowThresholdMs: number = 100
): Promise<T> {
  const start = performance.now();
  
  try {
    const result = await operation();
    const duration = performance.now() - start;
    
    if (duration > slowThresholdMs) {
      logger.warn(`[Performance] Slow operation: ${operationName} took ${duration.toFixed(2)}ms`);
    } else if (isDev) {
      logger.debug(`[Performance] ${operationName} took ${duration.toFixed(2)}ms`);
    }
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error(`[Performance] ${operationName} failed after ${duration.toFixed(2)}ms`, error);
    throw error;
  }
}
