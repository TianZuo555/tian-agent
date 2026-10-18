# 模型统一走本地 Magpie 网关

所有模型请求都打到本机 Magpie（默认 `http://127.0.0.1:3425/v1`），由它路由到 WorkBuddy / DeepSeek / GLM / Codex / Copilot / Cursor 等上游。app 不再直连 Anthropic / OpenAI / DeepSeek 官方 API，也不再从 `~/.pi/agent/auth.json` 导入 key。

## 背景

项目原先按 provider 分支：`anthropic` / `openai` / `deepseek` 各自一个 pi-ai provider，key 从环境变量或 pi 的 auth 文件读。实际使用中这些上游都已在 Magpie 后面，且模型清单（67 个，含 reasoning level、context window、模态）只有网关知道。维护三套 provider 定义和 key 来源是纯负担。

## 决定

- worker 启动时 `GET /v1/models` 拉目录，映射成 pi-ai 的 `openai-completions` model 描述（`src/worker/magpie.ts`），用 `createProvider` 注册单个 `magpie` provider。
- 只收录声明支持 `/v1/chat/completions` 的模型；`openai-responses` / `anthropic-messages` 专有模型暂不接入。
- 目录缓存进 `settings.json`，网关挂了 app 仍能打开，模型选择器显示 "Magpie offline"。
- 认证是占位符：`MAGPIE_API_KEY` 默认 `magpie`，网关本身不做鉴权。
- reasoning level 从网关的 `reasoning_levels` 映射到 pi 的 `thinkingLevelMap`（`none` → `off`），未声明的档位显式置 `null`，避免 pi 发送上游不认的 effort。

## 后果

- 换模型只改一个字符串；新增上游是 Magpie 那边的事，app 无需发版。
- 成本字段一律记 0：网关不回传单价，本地也不该猜。usage 面板因此只能看 token 数。
- 网关不在跑时，发送会得到 stream error，UI 通过 `models:status` 提前提示。
- 依赖 `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` 两个环境变量做覆盖，没有设置页输入框（第一版）。
