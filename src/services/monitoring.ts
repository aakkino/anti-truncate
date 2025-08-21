/**
 * @fileoverview Enhanced monitoring and health check endpoints.
 */

import { BufferedLogger } from '../utils.ts';
import { GENERIC_SERVICES, SPECIAL_SERVICES } from '../config/services.ts';

interface ServiceHealth {
  name: string;
  type: 'generic' | 'special';
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
  responseTime?: number;
  error?: string;
}

interface SystemMetrics {
  uptime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  services: ServiceHealth[];
}

/**
 * 环形缓冲区实现，优化响应时间存储
 */
class CircularBuffer {
  private buffer: number[];
  private size: number;
  private index: number = 0;
  private count: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }

  add(value: number): void {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    }
  }

  getValues(): number[] {
    if (this.count === 0) return [];
    
    if (this.count < this.size) {
      return this.buffer.slice(0, this.count);
    }
    
    // 返回正确顺序的数组
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }

  getCount(): number {
    return this.count;
  }

  clear(): void {
    this.index = 0;
    this.count = 0;
  }
}

export class MonitoringService {
  private startTime: number;
  private logger: BufferedLogger;
  private serviceHealth: Map<string, ServiceHealth> = new Map();
  private requestMetrics = {
    total: 0,
    successful: 0,
    failed: 0,
    responseTimes: new CircularBuffer(1000) // 修复：使用环形缓冲区
  };
  
  constructor(logger: BufferedLogger) {
    this.startTime = Date.now();
    this.logger = logger;
    this.initializeServiceHealth();
  }
  
  /**
   * Initialize service health status
   */
  private initializeServiceHealth() {
    // Initialize generic services
    for (const [alias] of GENERIC_SERVICES) {
      this.serviceHealth.set(alias, {
        name: alias,
        type: 'generic',
        status: 'healthy',
        lastCheck: new Date().toISOString()
      });
    }
    
    // Initialize special services
    for (const [alias, config] of SPECIAL_SERVICES) {
      this.serviceHealth.set(alias, {
        name: alias,
        type: 'special',
        status: 'healthy',
        lastCheck: new Date().toISOString()
      });
    }
  }
  
  /**
   * Record a request
   */
  recordRequest(success: boolean, responseTime: number, service?: string) {
    this.requestMetrics.total++;
    this.requestMetrics.responseTimes.add(responseTime); // 修复：使用add方法
    
    if (success) {
      this.requestMetrics.successful++;
    } else {
      this.requestMetrics.failed++;
      
      // Mark service as degraded if there are failures
      if (service && this.serviceHealth.has(service)) {
        const health = this.serviceHealth.get(service)!;
        health.status = 'degraded';
        health.lastCheck = new Date().toISOString();
      }
    }
    
    // 修复：环形缓冲区自动管理大小，无需手动切片
  }
  
  /**
   * Update service health
   */
  updateServiceHealth(service: string, status: ServiceHealth['status'], error?: string) {
    if (this.serviceHealth.has(service)) {
      const health = this.serviceHealth.get(service)!;
      health.status = status;
      health.lastCheck = new Date().toISOString();
      if (error) {
        health.error = error;
      }
    }
  }
  
  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const uptime = Date.now() - this.startTime;
    // 修复：使用CircularBuffer的API计算平均响应时间
    const responseTimes = this.requestMetrics.responseTimes.getValues();
    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;
    
    // Get memory usage (Deno specific)
    const memoryUsage = {
      used: 0,
      total: 0,
      percentage: 0
    };
    
    try {
      // @ts-ignore - Deno specific API
      if (typeof Deno !== 'undefined' && Deno.metrics) {
        // @ts-ignore
        const metrics = Deno.metrics();
        memoryUsage.used = metrics.allocated || 0;
        memoryUsage.total = metrics.limit || 0;
        memoryUsage.percentage = memoryUsage.total > 0 ? (memoryUsage.used / memoryUsage.total) * 100 : 0;
      }
    } catch {
      // Memory metrics not available
    }
    
    return {
      uptime,
      totalRequests: this.requestMetrics.total,
      successfulRequests: this.requestMetrics.successful,
      failedRequests: this.requestMetrics.failed,
      averageResponseTime: avgResponseTime,
      memoryUsage,
      services: Array.from(this.serviceHealth.values())
    };
  }
  
  /**
   * Health check endpoint
   */
  getHealthCheck() {
    const metrics = this.getSystemMetrics();
    const overallStatus = this.calculateOverallStatus(metrics);
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: metrics.uptime,
      checks: {
        memory: metrics.memoryUsage.percentage < 90 ? 'healthy' : 'degraded',
        services: this.getServiceHealthStatus(metrics.services),
        requests: this.getRequestHealthStatus(metrics)
      },
      metrics: {
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        successRate: metrics.totalRequests > 0 
          ? (metrics.successfulRequests / metrics.totalRequests) * 100 
          : 100,
        averageResponseTime: metrics.averageResponseTime
      },
      services: metrics.services
    };
  }
  
  /**
   * Detailed metrics endpoint
   */
  getDetailedMetrics() {
    const metrics = this.getSystemMetrics();
    
    return {
      system: {
        uptime: metrics.uptime,
        startTime: new Date(this.startTime).toISOString(),
        memory: metrics.memoryUsage,
        nodeVersion: typeof Deno !== 'undefined' ? Deno.version.deno : 'unknown'
      },
      requests: {
        total: metrics.totalRequests,
        successful: metrics.successfulRequests,
        failed: metrics.failed,
        successRate: metrics.totalRequests > 0 
          ? (metrics.successfulRequests / metrics.totalRequests) * 100 
          : 100,
        averageResponseTime: metrics.averageResponseTime,
        responseTimeDistribution: this.getResponseTimeDistribution()
      },
      services: metrics.services,
      performance: {
        throughput: this.calculateThroughput(),
        errorRate: this.calculateErrorRate()
      }
    };
  }
  
  /**
   * Service status endpoint
   */
  getServiceStatus() {
    return {
      generic: {
        count: GENERIC_SERVICES.size,
        services: Array.from(GENERIC_SERVICES.keys())
      },
      special: {
        count: SPECIAL_SERVICES.size,
        services: Array.from(SPECIAL_SERVICES.entries()).map(([alias, config]) => ({
          alias,
          pathPrefix: config.pathPrefix,
          models: config.models || []
        }))
      },
      health: Array.from(this.serviceHealth.values())
    };
  }
  
  /**
   * Calculate overall system status
   */
  private calculateOverallStatus(metrics: SystemMetrics): 'healthy' | 'degraded' | 'unhealthy' {
    if (metrics.memoryUsage.percentage > 95) {
      return 'unhealthy';
    }
    
    if (metrics.memoryUsage.percentage > 90 || metrics.failedRequests > metrics.successfulRequests) {
      return 'degraded';
    }
    
    const unhealthyServices = metrics.services.filter(s => s.status === 'unhealthy').length;
    const degradedServices = metrics.services.filter(s => s.status === 'degraded').length;
    
    if (unhealthyServices > 0) {
      return 'unhealthy';
    }
    
    if (degradedServices > metrics.services.length * 0.3) {
      return 'degraded';
    }
    
    return 'healthy';
  }
  
  /**
   * Get service health status
   */
  private getServiceHealthStatus(services: ServiceHealth[]): 'healthy' | 'degraded' | 'unhealthy' {
    const unhealthyCount = services.filter(s => s.status === 'unhealthy').length;
    const degradedCount = services.filter(s => s.status === 'degraded').length;
    
    if (unhealthyCount > 0) {
      return 'unhealthy';
    }
    
    if (degradedCount > services.length * 0.3) {
      return 'degraded';
    }
    
    return 'healthy';
  }
  
  /**
   * Get request health status
   */
  private getRequestHealthStatus(metrics: SystemMetrics): 'healthy' | 'degraded' | 'unhealthy' {
    const errorRate = metrics.totalRequests > 0 
      ? (metrics.failedRequests / metrics.totalRequests) * 100 
      : 0;
    
    if (errorRate > 10) {
      return 'unhealthy';
    }
    
    if (errorRate > 5) {
      return 'degraded';
    }
    
    return 'healthy';
  }
  
  /**
   * Get response time distribution
   */
  private getResponseTimeDistribution() {
    // 修复：使用CircularBuffer的getValues方法
    const times = this.requestMetrics.responseTimes.getValues();
    if (times.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }
    
    const sorted = [...times].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }
  
  /**
   * Calculate throughput
   */
  private calculateThroughput() {
    const uptimeHours = (Date.now() - this.startTime) / (1000 * 60 * 60);
    return uptimeHours > 0 ? this.requestMetrics.total / uptimeHours : 0;
  }
  
  /**
   * Calculate error rate
   */
  private calculateErrorRate() {
    return this.requestMetrics.total > 0 
      ? (this.requestMetrics.failed / this.requestMetrics.total) * 100 
      : 0;
  }
  
  /**
   * Reset metrics
   */
  resetMetrics() {
    this.startTime = Date.now();
    this.requestMetrics = {
      total: 0,
      successful: 0,
      failed: 0,
      responseTimes: []
    };
    this.initializeServiceHealth();
    this.logger.log('MONITOR', 'Metrics reset');
  }
}