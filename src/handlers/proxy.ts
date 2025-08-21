/**
 * @fileoverview Core proxy handler for generic services.
 */

import { GENERIC_SERVICES, BLACKLISTED_HEADERS, CORS_HEADERS } from '../config/services.ts';
import { BufferedLogger, PathParser, createErrorResponse, categorizeError } from '../utils.ts';
import { DEFAULT_CONFIG } from '../constants.ts';

const pathParser = new PathParser();

/**
 * Main proxy request handler for generic services
 */
export async function handleRequest(
  request: Request, 
  logger: BufferedLogger
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // Parse the path to extract service and target path
  const parsed = pathParser.parse(pathname);
  if (!parsed) {
    return createErrorResponse('Invalid path format', 400, 'Expected format: /api/{service}/{path}');
  }
  
  const { alias, path } = parsed;
  
  // Look up the service
  const serviceHost = GENERIC_SERVICES.get(alias);
  if (!serviceHost) {
    return createErrorResponse('Service not found', 404, `Service '${alias}' is not supported`);
  }
  
  // 修复：智能URL构建，避免双斜杠问题
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const targetUrl = `https://${serviceHost}/${cleanPath}${url.search}`;
  
  try {
    // Prepare headers
    const headers = new Headers();
    
    // Copy safe headers from the original request
    for (const [key, value] of request.headers.entries()) {
      if (!BLACKLISTED_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    
    // Add CORS headers
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      headers.set(key, value);
    });
    
    // Special handling for Claude API
    if (alias === 'claude' && !headers.has('anthropic-version')) {
      headers.set('anthropic-version', '2023-06-01');
    }
    
    // Handle request body transformation for special services
    let body = request.body;
    if (alias === 'gemininothink' && request.method === 'POST') {
      body = transformGeminiNoThinkBody(request);
    }
    
    // Create the fetch request
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(DEFAULT_CONFIG.requestTimeout)
    };
    
    // Forward the request
    const response = await fetch(targetUrl, fetchOptions);
    
    // Process the response
    return processResponse(response, alias, logger);
    
  } catch (error) {
    const categorized = categorizeError(error);
    logger.error(`Proxy error for ${alias}:`, error);
    return createErrorResponse(categorized.message, categorized.status, error.message);
  }
}

/**
 * Transform request body for Gemini NoThink service
 */
function transformGeminiNoThinkBody(request: Request): ReadableStream | null {
  if (!request.body) return null;
  
  const transformedStream = new TransformStream({
    async transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      
      try {
        const data = JSON.parse(text);
        
        // Add thinkingBudget: 0 to generationConfig if it exists
        if (data.generationConfig && typeof data.generationConfig === 'object') {
          data.generationConfig.thinkingBudget = 0;
        }
        
        const modifiedText = JSON.stringify(data);
        controller.enqueue(new TextEncoder().encode(modifiedText));
      } catch {
        // If JSON parsing fails, pass through the original chunk
        controller.enqueue(chunk);
      }
    }
  });
  
  return request.body.pipeThrough(transformedStream);
}

/**
 * Process the response from the target service
 */
async function processResponse(
  response: Response, 
  serviceAlias: string,
  logger: BufferedLogger
): Promise<Response> {
  // Create new headers for the response
  const responseHeaders = new Headers();
  
  // Copy safe headers from the original response
  for (const [key, value] of response.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (!BLACKLISTED_HEADERS.has(lowerKey) && 
        !lowerKey.startsWith('x-') && 
        lowerKey !== 'content-encoding') {
      responseHeaders.set(key, value);
    }
  }
  
  // Add CORS headers
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });
  
  // Handle different content types
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('application/json') || 
      contentType.includes('text/') ||
      serviceAlias === 'gemini' || 
      serviceAlias === 'gemininothink') {
    
    // For text-based responses, we can process the content
    try {
      const text = await response.text();
      
      // Log successful request
      logger.log('PROXY', serviceAlias, response.url, response.status);
      
      return new Response(text, {
        status: response.status,
        headers: responseHeaders
      });
    } catch (error) {
      logger.error('Error processing response:', error);
      return createErrorResponse('Response processing error', 500, error.message);
    }
  } else {
    // For binary responses, stream directly
    logger.log('PROXY', serviceAlias, response.url, response.status);
    
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }
}

/**
 * Helper function to create proxy response headers
 */
export function createProxyHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers();
  
  // Copy safe headers
  for (const [key, value] of originalHeaders.entries()) {
    const lowerKey = key.toLowerCase();
    if (!BLACKLISTED_HEADERS.has(lowerKey) && 
        !lowerKey.startsWith('x-') && 
        lowerKey !== 'content-encoding') {
      headers.set(key, value);
    }
  }
  
  // Add CORS headers
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  
  return headers;
}