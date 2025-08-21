/**
 * @fileoverview Gemini anti-truncation handler with stream processing.
 */

import { 
  FINISHED_TOKEN, 
  INCOMPLETE_TOKEN, 
  TARGET_MODELS, 
  FINISH_TOKEN_PROMPT, 
  RETRY_PROMPT,
  REMINDER_PROMPT,
  MAX_FETCH_RETRIES,
  MAX_NON_RETRYABLE_STATUS_RETRIES,
  RETRYABLE_STATUS_CODES,
  DEFAULT_CONFIG,
  PERFORMANCE_CONFIG
} from '../constants.ts';
import { BufferedLogger, createErrorResponse } from '../utils.ts';

interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text?: string;
      functionCall?: any;
      functionResponse?: any;
    }>;
    role?: string;
  }>;
  tools?: any[];
  toolConfig?: any;
  generationConfig?: any;
  safetySettings?: any[];
  systemInstruction?: any;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string;
        functionCall?: any;
      }>;
      role?: string;
    };
    finishReason?: string;
    safetyRatings?: any[];
  }>;
  usageMetadata?: any;
}

/**
 * Main handler for Gemini anti-truncation requests
 */
export async function handleGeminiAntiRequest(
  request: Request,
  pathname: string,
  logger: BufferedLogger
): Promise<Response> {
  try {
    // Parse the request
    const url = new URL(request.url);
    const modelMatch = pathname.match(/\/models\/([^:]+):/);
    
    if (!modelMatch) {
      return createErrorResponse('Invalid model path', 400, 'Expected format: /api/gemini-anti/v1/models/{model}:generateContent');
    }
    
    const model = modelMatch[1];
    
    // Check if model is supported
    if (!TARGET_MODELS.includes(model)) {
      return createErrorResponse('Model not supported', 400, `Model '${model}' is not supported for anti-truncation`);
    }
    
    // Parse request body
    const geminiRequest: GeminiRequest = await request.json();
    
    // Check if it's a streaming request
    const isStreaming = pathname.includes('streamGenerateContent');
    
    if (isStreaming) {
      return handleStreamingRequest(geminiRequest, model, url.search, logger);
    } else {
      return handleNonStreamingRequest(geminiRequest, model, url.search, logger);
    }
    
  } catch (error) {
    logger.error('Gemini anti-truncation error:', error);
    return createErrorResponse('Internal server error', 500, error.message);
  }
}

/**
 * Handle non-streaming Gemini requests
 */
async function handleNonStreamingRequest(
  request: GeminiRequest,
  model: string,
  searchParams: string,
  logger: BufferedLogger
): Promise<Response> {
  const startTime = Date.now();
  
  try {
    // Add anti-truncation prompt
    const modifiedRequest = addAntiTruncationPrompt(request);
    
    // Make the request with retry logic
    const response = await makeGeminiRequestWithRetry(
      modifiedRequest,
      model,
      searchParams,
      false,
      logger
    );
    
    // Process the response
    const geminiResponse: GeminiResponse = await response.json();
    
    // Check if response is complete
    const isComplete = isResponseComplete(geminiResponse);
    
    if (!isComplete) {
      // Retry with incomplete content
      return handleIncompleteResponse(geminiResponse, modifiedRequest, model, searchParams, logger);
    }
    
    // Clean up the response
    const cleanedResponse = cleanResponse(geminiResponse);
    
    logger.log('GEMINI-ANTI', model, response.url, response.status);
    
    return new Response(JSON.stringify(cleanedResponse), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Gemini non-streaming error (${model}):`, error);
    return createErrorResponse('Gemini request failed', 500, `${error.message} (${duration}ms)`);
  }
}

/**
 * Handle streaming Gemini requests
 */
async function handleStreamingRequest(
  request: GeminiRequest,
  model: string,
  searchParams: string,
  logger: BufferedLogger
): Promise<Response> {
  const startTime = Date.now();
  
  try {
    // Add anti-truncation prompt
    const modifiedRequest = addAntiTruncationPrompt(request);
    
    // Create a transform stream for processing
    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = line.slice(6);
              
              // 修复：空数据检查
              if (!jsonData || jsonData.trim() === '') {
                controller.enqueue(new TextEncoder().encode(`${line}\n`));
                continue;
              }
              
              const data = JSON.parse(jsonData);
              const processed = processStreamChunk(data);
              if (processed) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(processed)}\n\n`));
              }
            } catch (e) {
              // 修复：细化异常处理，添加详细日志
              if (e instanceof SyntaxError) {
                logger.debug(`JSON parse error in stream chunk: ${e.message}, data: ${line.slice(6, 100)}...`);
              } else {
                logger.error(`Unexpected error processing stream chunk: ${e.message}`);
              }
              
              // 修复：对于JSON错误，尝试降级处理
              controller.enqueue(new TextEncoder().encode(`${line}\n`));
            }
          } else {
            controller.enqueue(new TextEncoder().encode(`${line}\n`));
          }
        }
      }
    });
    
    // Make the streaming request
    const response = await makeGeminiRequestWithRetry(
      modifiedRequest,
      model,
      searchParams,
      true,
      logger
    );
    
    logger.log('GEMINI-ANTI-STREAM', model, response.url, response.status);
    
    return new Response(response.body?.pipeThrough(transformStream), {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Gemini streaming error (${model}):`, error);
    return createErrorResponse('Gemini streaming failed', 500, `${error.message} (${duration}ms)`);
  }
}

/**
 * Add anti-truncation prompt to the request
 */
function addAntiTruncationPrompt(request: GeminiRequest): GeminiRequest {
  const modifiedRequest = { ...request };
  
  // Add system instruction with anti-truncation prompt
  if (!modifiedRequest.systemInstruction) {
    modifiedRequest.systemInstruction = {
      parts: [{ text: FINISH_TOKEN_PROMPT }],
      role: 'user'
    };
  } else {
    // Append to existing system instruction
    const existingText = modifiedRequest.systemInstruction.parts[0]?.text || '';
    modifiedRequest.systemInstruction.parts[0].text = existingText + '\n\n' + FINISH_TOKEN_PROMPT;
  }
  
  return modifiedRequest;
}

/**
 * Make Gemini request with retry logic
 */
async function makeGeminiRequestWithRetry(
  request: GeminiRequest,
  model: string,
  searchParams: string,
  isStreaming: boolean,
  logger: BufferedLogger,
  retryCount = 0
): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }
  
  const endpoint = isStreaming ? 'streamGenerateContent' : 'generateContent';
  // 修复：不在URL中包含API密钥，避免日志泄露
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}`;
  const url = searchParams ? `${baseUrl}${searchParams}` : baseUrl;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,  // 使用请求头传递API密钥
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(DEFAULT_CONFIG.requestTimeout)
    });
    
    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.includes(response.status) && retryCount < MAX_FETCH_RETRIES) {
        logger.debug(`Retrying Gemini request (${retryCount + 1}/${MAX_FETCH_RETRIES})`);
        // 修复：使用指数退避算法，避免频繁重试
        const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return makeGeminiRequestWithRetry(request, model, searchParams, isStreaming, logger, retryCount + 1);
      }
      
      // 修复：对于不可重试的错误，直接返回，避免无限递归
      throw new Error(`Gemini API request failed with status ${response.status}: ${response.statusText}`);
    }
    
    return response;
    
  } catch (error) {
    if (retryCount < MAX_FETCH_RETRIES) {
      logger.debug(`Retrying Gemini request due to error (${retryCount + 1}/${MAX_FETCH_RETRIES})`);
      // 修复：使用指数退避算法
      const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      return makeGeminiRequestWithRetry(request, model, searchParams, isStreaming, logger, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Check if response is complete
 */
function isResponseComplete(response: GeminiResponse): boolean {
  if (!response.candidates || response.candidates.length === 0) {
    return false;
  }
  
  const candidate = response.candidates[0];
  if (!candidate.content || !candidate.content.parts) {
    return false;
  }
  
  const text = candidate.content.parts.map(part => part.text || '').join('');
  return text.includes(FINISHED_TOKEN);
}

/**
 * Handle incomplete response
 */
async function handleIncompleteResponse(
  incompleteResponse: GeminiResponse,
  originalRequest: GeminiRequest,
  model: string,
  searchParams: string,
  logger: BufferedLogger
): Promise<Response> {
  logger.debug('Handling incomplete response, attempting retry');
  
  // Create retry request with the incomplete content
  const retryRequest = createRetryRequest(incompleteResponse, originalRequest);
  
  try {
    const response = await makeGeminiRequestWithRetry(
      retryRequest,
      model,
      searchParams,
      false,
      logger
    );
    
    const geminiResponse: GeminiResponse = await response.json();
    const combinedResponse = combineResponses(incompleteResponse, geminiResponse);
    
    return new Response(JSON.stringify(combinedResponse), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
    
  } catch (error) {
    logger.error('Retry failed:', error);
    // Return the incomplete response as fallback
    return new Response(JSON.stringify(incompleteResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
}

/**
 * Create retry request from incomplete response
 */
function createRetryRequest(
  incompleteResponse: GeminiResponse,
  originalRequest: GeminiRequest
): GeminiRequest {
  const incompleteText = incompleteResponse.candidates[0].content.parts
    .map(part => part.text || '')
    .join('');
  
  const retryRequest = { ...originalRequest };
  
  // Add the incomplete text as context with retry prompt
  const retryContent = {
    parts: [{ text: `${incompleteText}\n\n${RETRY_PROMPT}` }],
    role: 'user'
  };
  
  retryRequest.contents = [...originalRequest.contents, retryContent];
  
  return retryRequest;
}

/**
 * Combine incomplete and complete responses
 */
function combineResponses(
  incomplete: GeminiResponse,
  complete: GeminiResponse
): GeminiResponse {
  const incompleteText = incomplete.candidates[0].content.parts
    .map(part => part.text || '')
    .join('');
  
  const completeText = complete.candidates[0].content.parts
    .map(part => part.text || '')
    .join('');
  
  // Remove the incomplete part from the complete text
  const finalText = completeText.replace(incompleteText, '').trim();
  
  return {
    candidates: [{
      content: {
        parts: [{ text: finalText }],
        role: complete.candidates[0].content.role
      },
      finishReason: complete.candidates[0].finishReason,
      safetyRatings: complete.candidates[0].safetyRatings
    }],
    usageMetadata: complete.usageMetadata
  };
}

/**
 * Clean response by removing anti-truncation tokens
 */
function cleanResponse(response: GeminiResponse): GeminiResponse {
  if (!response.candidates || response.candidates.length === 0) {
    return response;
  }
  
  const candidate = response.candidates[0];
  if (!candidate.content || !candidate.content.parts) {
    return response;
  }
  
  // Remove anti-truncation tokens
  candidate.content.parts = candidate.content.parts.map(part => {
    if (part.text) {
      return {
        ...part,
        text: part.text
          .replace(FINISHED_TOKEN, '')
          .replace(INCOMPLETE_TOKEN, '')
          .replace(REMINDER_PROMPT, '')
          .trim()
      };
    }
    return part;
  });
  
  return response;
}

/**
 * Process streaming chunks
 */
function processStreamChunk(chunk: any): any {
  if (!chunk.candidates || chunk.candidates.length === 0) {
    return chunk;
  }
  
  const candidate = chunk.candidates[0];
  if (!candidate.content || !candidate.content.parts) {
    return chunk;
  }
  
  // Clean streaming chunks
  candidate.content.parts = candidate.content.parts.map(part => {
    if (part.text) {
      return {
        ...part,
        text: part.text
          .replace(FINISHED_TOKEN, '')
          .replace(INCOMPLETE_TOKEN, '')
          .replace(REMINDER_PROMPT, '')
      };
    }
    return part;
  });
  
  return chunk;
}