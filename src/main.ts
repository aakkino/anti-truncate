/**
 * @fileoverview Main entry point for the Deno unified proxy server.
 */

import { handleRequest } from '@/handlers/proxy.ts';
import { handleGeminiAntiRequest } from '@/handlers/gemini-anti.ts';
import { createOptionsResponse, getClientId, RateLimiter, BufferedLogger } from '@/utils.ts';
import { GENERIC_SERVICES, SPECIAL_SERVICES, getEnvConfig } from '@/config/services.ts';
import { DEFAULT_CONFIG } from '@/constants.ts';
import { MonitoringService } from '@/services/monitoring.ts';

// Initialize services
const config = getEnvConfig();
const logger = new BufferedLogger(1000, config.debugMode);
const rateLimiter = new RateLimiter(60000, config.maxRequestsPerMinute);
const monitoringService = new MonitoringService(logger);

/**
 * Main request handler for the unified proxy server
 */
async function mainHandler(request: Request): Promise<Response> {
  const startTime = Date.now();
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;
  
  try {
    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
      return createOptionsResponse();
    }
    
    // Health check endpoint
    if (pathname === '/health' || pathname === '/') {
      const health = monitoringService.getHealthCheck();
      return new Response(JSON.stringify(health), {
        headers: {
          'Content-Type': 'application/json',
          ...createOptionsResponse().headers
        }
      });
    }
    
    // Metrics endpoint
    if (pathname === '/metrics') {
      const metrics = monitoringService.getDetailedMetrics();
      return new Response(JSON.stringify(metrics), {
        headers: {
          'Content-Type': 'application/json',
          ...createOptionsResponse().headers
        }
      });
    }
    
    // Services endpoint
    if (pathname === '/services') {
      const services = monitoringService.getServiceStatus();
      return new Response(JSON.stringify(services), {
        headers: {
          'Content-Type': 'application/json',
          ...createOptionsResponse().headers
        }
      });
    }
    
    // Rate limiting
    const clientId = getClientId(request);
    if (!rateLimiter.isAllowed(clientId)) {
      logger.log(method, pathname, undefined, 429);
      return new Response('Rate limit exceeded', { status: 429 });
    }
    
    // Handle special services first
    for (const [serviceAlias, serviceConfig] of SPECIAL_SERVICES) {
      if (pathname.startsWith(serviceConfig.pathPrefix)) {
        logger.log(method, pathname, `Special service: ${serviceAlias}`);
        
        const response = await handleGeminiAntiRequest(request, pathname, logger);
        const duration = Date.now() - startTime;
        const success = response.status < 400;
        
        monitoringService.recordRequest(success, duration, serviceAlias);
        
        if (!success) {
          monitoringService.updateServiceHealth(serviceAlias, 'degraded', `HTTP ${response.status}`);
        }
        
        return response;
      }
    }
    
    // Handle generic services
    if (pathname.startsWith('/api/')) {
      const parsed = pathname.match(/^\/[^\/]+\/([^\/]+)\/(.*)$/);
      const serviceAlias = parsed ? parsed[1] : null;
      
      logger.log(method, pathname);
      const response = await handleRequest(request, logger);
      const duration = Date.now() - startTime;
      const success = response.status < 400;
      
      monitoringService.recordRequest(success, duration, serviceAlias || undefined);
      
      if (serviceAlias && !success) {
        monitoringService.updateServiceHealth(serviceAlias, 'degraded', `HTTP ${response.status}`);
      }
      
      return response;
    }
    
    // 404 for unknown paths
    logger.log(method, pathname, undefined, 404);
    const duration = Date.now() - startTime;
    monitoringService.recordRequest(false, duration);
    
    return new Response('Not found', { status: 404 });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Unhandled error in ${method} ${pathname}:`, error);
    monitoringService.recordRequest(false, duration);
    
    // 修复：使用安全的错误响应，避免泄露敏感信息
    return createErrorResponse(
      'Internal server error',
      500,
      `Request failed (${duration}ms)`
    );
  }
}

// Start the server
const port = parseInt(Deno.env.get('PORT') || '8000', 10);
console.log(`🚀 Deno Unified Proxy starting on port ${port}`);
console.log(`📊 Health check: http://localhost:${port}/health`);
console.log(`📈 Metrics: http://localhost:${port}/metrics`);
console.log(`🔧 Services: http://localhost:${port}/services`);
console.log(`⚙️  Debug mode: ${config.debugMode}`);
console.log(`🔒 Rate limiting: ${config.maxRequestsPerMinute} requests/minute`);
console.log(`🌐 Supported services: ${GENERIC_SERVICES.size} generic, ${SPECIAL_SERVICES.size} special`);

Deno.serve({ port }, mainHandler);

// Graceful shutdown
Deno.addSignalListener('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  Deno.exit(0);
});

Deno.addSignalListener('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  Deno.exit(0);
});