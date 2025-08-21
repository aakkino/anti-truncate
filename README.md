# Deno Unified Proxy

统一 API 代理服务，支持通用代理和 Gemini 防截断功能，部署在 Deno Deploy 平台。

## 功能特性

### 通用代理功能
- 支持 28+ AI 服务（OpenAI、Claude、Gemini、Groq 等）
- 高性能缓存和限流
- 优化的错误处理
- CORS 支持
- 流式传输

### Gemini 防截断功能
- 防止 Gemini 2.5 Pro/Flash 响应截断
- 智能重试机制
- 思考内容处理
- 函数调用支持

## 快速开始

### 本地开发
```bash
# 克隆项目
git clone <repository-url>
cd deno-unified-proxy

# 安装 Deno (如果未安装)
curl -fsSL https://deno.land/x/install/install.sh | sh

# 启动开发服务器
deno task dev
```

### 部署到 Deno Deploy
```bash
# 安装 deployctl
deno install -A -f -n deployctl https://deno.land/x/deploy/deployctl.ts

# 部署
deno task deploy
```

## API 使用

### 通用代理
```
GET/POST /api/{service}/{path}
```

支持的服务：
- `openai` - OpenAI API
- `claude` - Anthropic Claude API
- `gemini` - Google Gemini API (基础版本)
- `gemininothink` - Google Gemini API (禁用思考)
- `groq` - Groq API
- `xai` - xAI API
- 以及更多...

### Gemini 防截断代理
```
POST /api/gemini-anti/v1/models/{model}:generateContent
POST /api/gemini-anti/v1/models/{model}:streamGenerateContent
```

支持的模型：
- `gemini-2.5-pro`
- `gemini-2.5-flash`

## 配置

### 环境变量
```bash
# 限流配置
MAX_REQUESTS_PER_MINUTE=100
MAX_RETRIES=3
REQUEST_TIMEOUT=30000

# 调试模式
DEBUG_MODE=true

# 缓存配置
ENABLE_CACHE=true
CACHE_SIZE=1000
```

### 服务配置
在 `src/config/services.ts` 中可以配置支持的服务列表。

## 架构设计

```
┌─────────────────┐
│   Deno Deploy   │
│                 │
└─────────────────┘
         │
    ┌─────┴─────┐
    │ 统一路由器 │
    └─────┬─────┘
    ┌─────┴─────┐
    │ 服务分发器 │
    └─────┬─────┘
┌───────────┬───────────┬───────────┐
│  Gemini   │  OpenAI   │  Claude   │
│ 防截断处理 │ 通用代理  │ 通用代理  │
│(特殊处理)  │ (通用逻辑) │ (通用逻辑) │
└───────────┴───────────┴───────────┘
```

## 性能特性

- ✅ 高性能缓存机制
- ✅ 智能限流保护
- ✅ 内存优化
- ✅ 流式传输支持
- ✅ 错误恢复机制
- ✅ 全球边缘网络 (Deno Deploy)

## 监控和日志

服务包含完整的监控和日志系统：
- 请求统计
- 错误跟踪
- 性能指标
- 调试日志

## 许可证

MIT License