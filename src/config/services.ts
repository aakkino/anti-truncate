/**
 * @fileoverview Service configuration for the unified proxy.
 */

import { DEFAULT_CONFIG } from '../constants.ts';

// 通用服务映射
export const GENERIC_SERVICES = new Map([
  ["discord", "discord.com/api"],
  ["telegram", "api.telegram.org"],
  ["httpbin", "httpbin.org"],
  ["openai", "api.openai.com"],
  ["claude", "api.anthropic.com"],
  ["gemini", "generativelanguage.googleapis.com"],
  ["gemininothink", "generativelanguage.googleapis.com"],
  ["meta", "www.meta.ai/api"],
  ["groq", "api.groq.com/openai"],
  ["xai", "api.x.ai"],
  ["cohere", "api.cohere.ai"],
  ["huggingface", "api-inference.huggingface.co"],
  ["together", "api.together.xyz"],
  ["novita", "api.novita.ai"],
  ["portkey", "api.portkey.ai"],
  ["fireworks", "api.fireworks.ai"],
  ["targon", "api.targon.com"],
  ["openrouter", "openrouter.ai/api"],
  ["siliconflow", "api.siliconflow.cn"],
  ["modelscope", "api-inference.modelscope.cn"],
  ["gmi", "api.gmi-serving.com"],
  ["azureinference", "models.inference.ai.azure.com"],
  ["githubai", "models.github.ai/inference"],
  ["dmxcom", "www.dmxapi.com"],
  ["dmxcn", "www.dmxapi.cn"]
]);

// 特殊服务配置
export const SPECIAL_SERVICES = new Map([
  ["gemini-anti", {
    pathPrefix: "/api/gemini-anti",
    host: "generativelanguage.googleapis.com",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    handler: "gemini", // 处理器名称
    antiTruncate: true,
    requiresApiKey: true
  }]
]);

// CORS 头配置
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, anthropic-version, x-api-key, X-Goog-Api-Key"
};

// Header 黑名单
export const BLACKLISTED_HEADERS = new Set([
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker",
  "cdn-loop", "cf-ew-via", "baggage", "sb-request-id", "x-amzn-trace-id",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-server",
  "x-real-ip", "x-original-host", "forwarded", "via", "referer",
  "x-request-id", "x-correlation-id", "x-trace-id"
]);

// 错误模式匹配
export const ERROR_PATTERNS = [
  { pattern: /timeout|aborted/i, type: 'TIMEOUT', message: 'Request timeout - the target service took too long to respond', status: 504 },
  { pattern: /network|fetch/i, type: 'NETWORK', message: 'Network error - unable to reach the target service', status: 502 },
  { pattern: /dns|name resolution/i, type: 'DNS', message: 'DNS resolution failed - unable to resolve target hostname', status: 502 },
  { pattern: /connection refused|connect/i, type: 'CONNECTION', message: 'Connection refused - target service is not accepting connections', status: 503 },
  { pattern: /ssl|tls|certificate/i, type: 'SSL', message: 'SSL/TLS error - certificate or encryption issue', status: 502 }
];

// 环境变量配置
export function getEnvConfig() {
  return {
    ...DEFAULT_CONFIG,
    maxRetries: parseInt(Deno.env.get('MAX_RETRIES') || '3', 10),
    requestTimeout: parseInt(Deno.env.get('REQUEST_TIMEOUT') || '30000', 10),
    maxRequestsPerMinute: parseInt(Deno.env.get('MAX_REQUESTS_PER_MINUTE') || '100', 10),
    enableCache: Deno.env.get('ENABLE_CACHE') !== 'false',
    cacheSize: parseInt(Deno.env.get('CACHE_SIZE') || '1000', 10),
    debugMode: Deno.env.get('DEBUG_MODE') === 'true',
    upstreamUrlBase: Deno.env.get('UPSTREAM_URL_BASE') || 'https://generativelanguage.googleapis.com'
  };
}

// 获取所有支持的服务列表
export function getAllServices() {
  const services = [];
  
  // 添加通用服务
  for (const [alias] of GENERIC_SERVICES) {
    services.push({
      alias,
      type: 'generic',
      description: `${alias} API`
    });
  }
  
  // 添加特殊服务
  for (const [alias, config] of SPECIAL_SERVICES) {
    services.push({
      alias,
      type: 'special',
      description: `${alias} (${config.models?.join(', ')})`,
      pathPrefix: config.pathPrefix
    });
  }
  
  return services;
}