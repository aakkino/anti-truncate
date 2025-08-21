# 路径映射修复任务

## 问题描述
Deno Deploy 部署失败，错误：`Module not found "file:///src/config/services.ts"`
根本原因：项目混合使用 `@/` 路径映射和相对路径，Deno Deploy 无法正确解析路径映射。

## 解决方案
统一使用相对路径替换所有 `@/` 路径映射

## 执行计划
1. 分析文件结构和导入关系
2. 计算相对路径映射
3. 批量替换导入语句（4个文件）
4. 清理 deno.json 配置
5. 本地验证
6. 创建任务记录

## 路径映射关系
- `src/main.ts` → 其他文件：`./`, `./handlers/`, `./config/`, `./constants.ts`, `./services/`, `./utils.ts`
- `src/services/monitoring.ts` → 其他文件：`../utils.ts`, `../config/services.ts`
- `src/handlers/proxy.ts` → 其他文件：`../config/services.ts`, `../utils.ts`, `../constants.ts`
- `src/handlers/gemini-anti.ts` → 其他文件：`../utils.ts`

## 执行状态
✅ 计划制定完成
✅ 路径映射分析完成
✅ 批量替换导入语句完成
  - `src/main.ts`: 6个 `@/` 导入替换为相对路径
  - `src/services/monitoring.ts`: 2个 `@/` 导入替换为相对路径
  - `src/handlers/proxy.ts`: 3个 `@/` 导入替换为相对路径
  - `src/handlers/gemini-anti.ts`: 2个 `@/` 导入替换为相对路径
✅ 清理 deno.json 配置完成（移除 imports 路径映射）
⚠️ 本地验证跳过（环境无 Deno）
✅ 任务记录完成

## 修复总结
- 修改文件：4个 TypeScript 文件 + 1个配置文件
- 替换导入：13个 `@/` 路径映射改为相对路径
- 配置清理：移除 deno.json 中的 imports 配置
- 预期结果：解决 Deno Deploy 部署时的模块找不到问题 