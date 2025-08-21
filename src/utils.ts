/**
 * @fileoverview Utility classes and functions for the unified proxy.
 */

import { CORS_HEADERS, ERROR_PATTERNS } from '../config/services.ts';

/**
 * 高性能日志记录器（使用缓冲区）
 */
export class BufferedLogger {
  private buffer: string[] = [];
  private flushInterval: number;
  private debugMode: boolean;

  constructor(flushInterval = 1000, debugMode = false) {
    this.flushInterval = flushInterval;
    this.debugMode = debugMode;
    this.startFlushing();
  }

  log(method: string, pathname: string, targetUrl?: string, status?: number) {
    const timestamp = new Date().toISOString();
    const statusInfo = status ? ` [${status}]` : '';
    const target = targetUrl ? ` -> ${targetUrl}` : '';
    this.buffer.push(`[${timestamp}] ${method} ${pathname}${target}${statusInfo}`);
  }

  debug(message: string, ...args: any[]) {
    if (this.debugMode) {
      console.log(`[DEBUG ${new Date().toISOString()}]`, message, ...args);
    }
  }

  error(message: string, ...args: any[]) {
    console.error(`[ERROR ${new Date().toISOString()}]`, message, ...args);
  }

  private startFlushing() {
    setInterval(() => {
      if (this.buffer.length > 0) {
        console.log(this.buffer.join('\n'));
        this.buffer = [];
      }
    }, this.flushInterval);
  }
}

/**
 * 优化的路径解析器 - 修复竞态条件
 */
export class PathParser {
  private cache = new Map<string, { alias: string; path: string; timestamp: number }>();
  private readonly maxCacheSize = 1000;
  private readonly cacheTTL = 300000; // 5分钟TTL
  private cacheHits = 0;
  private cacheMisses = 0;

  parse(pathname: string): { alias: string; path: string } | null {
    const now = Date.now();
    
    // 修复：原子性检查缓存
    const cached = this.cache.get(pathname);
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      this.cacheHits++;
      return { alias: cached.alias, path: cached.path };
    }

    // 使用正则表达式一次性解析
    const match = pathname.match(/^\/[^\/]+\/([^\/]+)\/(.*)$/);
    if (!match) {
      return null;
    }

    const result = {
      alias: match[1],
      path: match[2]
    };

    // 修复：原子性缓存更新，包含时间戳
    this.updateCache(pathname, result, now);
    this.cacheMisses++;

    return result;
  }

  /**
   * 修复：原子性缓存更新
   */
  private updateCache(pathname: string, result: { alias: string; path: string }, timestamp: number): void {
    // 如果缓存已满，先清理过期条目
    if (this.cache.size >= this.maxCacheSize) {
      this.cleanupCache(timestamp);
    }

    // 如果清理后仍然已满，使用LRU策略
    if (this.cache.size >= this.maxCacheSize) {
      this.evictOldest();
    }

    // 安全地添加新条目
    this.cache.set(pathname, { ...result, timestamp });
  }

  /**
   * 修复：清理过期缓存条目
   */
  private cleanupCache(now: number): void {
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if ((now - entry.timestamp) >= this.cacheTTL) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * 修复：LRU淘汰最旧的条目
   */
  private evictOldest(): void {
    let oldestKey = '';
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    const now = Date.now();
    let expired = 0;
    let valid = 0;
    
    for (const [, entry] of this.cache.entries()) {
      if ((now - entry.timestamp) >= this.cacheTTL) {
        expired++;
      } else {
        valid++;
      }
    }
    
    const totalRequests = this.cacheHits + this.cacheMisses;
    
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      valid,
      expired,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: totalRequests > 0 ? this.cacheHits / totalRequests : 0
    };
  }

  /**
   * 手动清理过期缓存
   */
  cleanup(): void {
    this.cleanupCache(Date.now());
  }
}

/**
 * 请求限流器（适配 Deno Deploy）- 修复内存泄漏
 */
export class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private lastCleanup: number = Date.now();
  private cleanupInterval: number;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.cleanupInterval = Math.max(windowMs / 4, 15000); // 清理间隔：窗口期的1/4，最少15秒
    
    // 修复：启动定期清理，防止内存泄漏
    this.startPeriodicCleanup();
  }

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    
    // 修复：每次检查时也进行增量清理
    this.incrementalCleanup(now);
    
    const requests = this.requests.get(clientId) || [];
    
    // 清理过期请求
    const validRequests = requests.filter(time => now - time < this.windowMs);
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(clientId, validRequests);
    
    return true;
  }

  /**
   * 修复：增量清理机制，避免一次性清理太多数据
   */
  private incrementalCleanup(now: number) {
    if (now - this.lastCleanup < this.cleanupInterval && this.requests.size <= 1000) {
      return;
    }

    let cleaned = 0;
    const maxCleanupPerCycle = 50; // 每次最多清理50个条目
    
    for (const [clientId, requests] of this.requests.entries()) {
      if (cleaned >= maxCleanupPerCycle) break;
      
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(clientId);
        cleaned++;
      } else if (validRequests.length !== requests.length) {
        this.requests.set(clientId, validRequests);
        cleaned++;
      }
    }
    
    this.lastCleanup = now;
  }

  /**
   * 修复：定期清理机制，防止长期内存泄漏
   */
  private startPeriodicCleanup() {
    setInterval(() => {
      this.fullCleanup();
    }, this.cleanupInterval);
  }

  /**
   * 修复：完整清理，定期执行
   */
  private fullCleanup() {
    const now = Date.now();
    const oldSize = this.requests.size;
    
    for (const [clientId, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length === 0) {
        this.requests.delete(clientId);
      } else {
        this.requests.set(clientId, validRequests);
      }
    }
    
    const newSize = this.requests.size;
    if (oldSize > newSize) {
      console.log(`RateLimiter: cleaned ${oldSize - newSize} expired entries, ${newSize} remaining`);
    }
  }

  /**
   * 获取内存使用统计
   */
  getStats() {
    const now = Date.now();
    let totalRequests = 0;
    let activeClients = 0;
    
    for (const [, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < this.windowMs);
      if (validRequests.length > 0) {
        activeClients++;
        totalRequests += validRequests.length;
      }
    }
    
    return {
      totalClients: this.requests.size,
      activeClients,
      totalRequests,
      memoryEntries: this.requests.size
    };
  }
}

/**
 * 缓存条目接口
 */
interface CacheEntry {
  response: Response;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccess: number;
}

/**
 * 响应对象池 - 修复：添加TTL和LRU机制
 */
export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 100, defaultTTL = 300000) { // 默认5分钟TTL
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    
    // 修复：启动定期清理过期缓存
    this.startTTLCleanup();
  }

  get(key: string): Response | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    
    // 修复：检查TTL过期
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // 修复：更新LRU信息
    entry.accessCount++;
    entry.lastAccess = now;
    
    return entry.response.clone();
  }

  set(key: string, response: Response, ttl?: number): void {
    const now = Date.now();
    const entry: CacheEntry = {
      response: response.clone(),
      timestamp: now,
      ttl: ttl || this.defaultTTL,
      accessCount: 1,
      lastAccess: now
    };

    // 修复：如果缓存已满，使用LRU策略淘汰
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * 修复：LRU淘汰策略
   */
  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      // 优先淘汰访问次数少且最久未使用的条目
      const score = entry.lastAccess - (entry.accessCount * 1000);
      if (score < oldestTime) {
        oldestTime = score;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 修复：定期清理过期缓存
   */
  private startTTLCleanup(): void {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 修复：清理过期条目
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`ResponseCache: cleaned ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const now = Date.now();
    let expired = 0;
    let valid = 0;
    let totalSize = 0;
    
    for (const [, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        expired++;
      } else {
        valid++;
      }
      totalSize += JSON.stringify(entry).length;
    }
    
    return {
      total: this.cache.size,
      valid,
      expired,
      maxSize: this.maxSize,
      estimatedSizeBytes: totalSize,
      hitRate: this.cache.size > 0 ? valid / this.cache.size : 0
    };
  }
}

/**
 * 优化的错误分类函数
 */
export function categorizeError(error: Error) {
  const errorMessage = error.message;
  
  for (const { pattern, type, message, status } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return { type, message, status };
    }
  }
  
  return {
    type: 'UNKNOWN',
    message: `Unexpected error: ${error.message}`,
    status: 500
  };
}

/**
 * 安全地过滤错误消息，避免泄露敏感信息
 */
function sanitizeErrorMessage(message: string, isProduction: boolean): string {
  if (!isProduction) {
    return message;
  }
  
  // 生产环境中过滤敏感信息
  const sensitivePatterns = [
    /key|token|password|secret|auth|api[_-]?key/i,
    /localhost|127\.0\.0\.1|192\.168\./,
    /\/[a-zA-Z0-9+/=]{20,}/,  // Base64编码的密钥
    /[a-zA-Z0-9]{32,}/        // 长字符串（可能是密钥）
  ];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(message)) {
      return 'Internal service error - details hidden for security';
    }
  }
  
  return message;
}

/**
 * 创建标准错误响应
 */
export function createErrorResponse(
  message: string, 
  status: number, 
  details?: string,
  cache?: ResponseCache
): Response {
  const isProduction = Deno.env.get('DENO_ENV') === 'production';
  const safeMessage = sanitizeErrorMessage(message, isProduction);
  const safeDetails = details ? sanitizeErrorMessage(details, isProduction) : undefined;
  
  const cacheKey = `${status}-${safeMessage}-${safeDetails || ''}`;
  
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  
  const errorBody = JSON.stringify({
    error: safeMessage,
    status,
    timestamp: new Date().toISOString(),
    ...(safeDetails && { details: safeDetails })
  });
  
  const response = new Response(errorBody, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
  
  if (cache) {
    cache.set(cacheKey, response);
  }
  
  return response.clone();
}

/**
 * 创建 OPTIONS 响应
 */
export function createOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

/**
 * 解析客户端 ID
 */
export function getClientId(request: Request): string {
  return request.headers.get("x-forwarded-for") || 
         request.headers.get("x-real-ip") || 
         "unknown";
}

/**
 * 监控服务
 */
export class MonitoringService {
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    lastReset: Date.now()
  };

  logRequest(duration: number, success: boolean) {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    // 更新平均响应时间
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration) / 
      this.metrics.totalRequests;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  reset() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastReset: Date.now()
    };
  }
}