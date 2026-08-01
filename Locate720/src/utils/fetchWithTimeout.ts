/**
 * Fetch with timeout wrapper
 * Prevents hanging network requests that can freeze the app
 * 
 * For enterprise scale: ensures predictable behavior under poor network conditions
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number; // Timeout in milliseconds (default: 30000)
}

/**
 * Fetch wrapper with automatic timeout
 * Throws error if request takes longer than specified timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Provide clear error message for timeout
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${url}`);
    }
    
    throw error;
  }
}

/**
 * Fetch with retry logic (for critical operations)
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithTimeoutOptions = {},
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.message && error.message.includes('HTTP 4')) {
        throw error;
      }
      
      // Exponential backoff between retries
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  
  throw lastError || new Error('Fetch failed after retries');
}
