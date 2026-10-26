# 开发与验证

[English](../development.md) | **简体中文**

工具链、任务和本地环境变量由 [mise](https://mise.jdx.dev/) 声明在 `mise.toml`：Node 26 与 pnpm 12.5.1 固定在项目内，进入目录后自动切换，不依赖全局配置。开发构建要求 Node 24+。每个 mise 任务只是对 `package.json` 脚本的封装，CI 与不用 mise 的机器可直接 `pnpm <script>`；`mise tasks ls` 列出全部任务。

## 常用命令

```sh
mise install        # 安装固定版本的 Node 与 pnpm
mise run setup      # pnpm install + 安装常驻服务
mise run start      # 启动 App
mise run check      # typecheck + lint
mise run doctor     # 仅 React Doctor
mise run verify     # check + doctor + test，提交前跑这个
```

类型检查用 [`tsrs`](https://github.com/oxc-project/tsrs)（TypeScript 7 编译器的 Rust 移植）：`pnpm typecheck` 跑 `tsrs --noEmit`，比 `tsc` 快一个数量级且内存约为三分之一。它跟随 TS 7 语义，因此 `tsconfig.json` 里不能用 TS 7 移除的选项（`baseUrl`、ES5 target、AMD/UMD module 等）；`paths` 不需要 `baseUrl`。保留 `pnpm typecheck:tsc` 作为对照——它运行 TypeScript 7 自带的参考 `tsc`，怀疑 tsrs 误报时先跑它确认，两者的诊断应逐字一致。lint 以 `oxlint --deny-warnings` 运行，警告与错误一样让检查失败；`oxfmt --check` 校验格式。

## 本地环境变量

`mise.toml` 通过 `[env] _.file` 读取仓库根目录的 `.env`（已 gitignore，缺失不报错，值标记为 redacted）。从模板开始：

```sh
cp .env.example .env
```

| 变量                                 | 作用                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` | 模型网关地址与密钥，默认 `http://127.0.0.1:3425/v1`              |
| `TELEGRAM_BOT_TOKEN`                 | Telegram Bot token；为空时适配器不启动                           |
| `TELEGRAM_ALLOWED_CHAT_IDS`          | 允许对话的 chat id，逗号分隔                                     |
| `WECHAT_ALLOWED_USER_IDS`            | 允许对话的微信 id（`…@im.wechat`），逗号分隔；为空时适配器不启动 |
| `TIAN_AGENT_DATA_DIR`                | 数据目录；`mise run service:env` 也据此决定写到哪里              |
| `TIAN_AGENT_SOCKET_PATH`             | Unix socket 路径（绝对路径，不超过 100 字节）                    |

`.env` 只影响 mise shell 里的 App 与 `pnpm` 任务。常驻服务由 launchd 启动，读不到 shell 环境；用 `mise run service:env` 把非空的 `MAGPIE_*` / `TELEGRAM_*` / `WECHAT_*` 原子写入 `<dataDir>/service.env`（0600），再 `mise run service:restart`。其余开发变量不会进入服务环境。Agent 的 shell 命令（例如工兵的 `bash` 调用）不会收到这些变量。

## 测试

| 命令                                | 覆盖                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                         | 临时数据库、真实临时 Git 仓库与可控工兵：权限、记忆、Inbox、Run 状态、前端同步、多客户端服务。先构建服务产物；不调用模型                 |
| `pnpm test:runtime`                 | 打包后的服务产物脱离 checkout、用普通 Node 运行，连接 sandbox preload 与真实 renderer；退出 Electron 后服务继续运行                      |
| `pnpm test:launchd`                 | 安装一次性 LaunchAgent，强制结束进程，验证自动重启、持久化恢复与客户端重连，结束后删除                                                   |
| `pnpm test:upgrade`                 | 服务升级事务：维护期拒绝写入、启动失败回滚、数据库备份恢复、未完成升级恢复、停止服务与登录偏好的独立性                                   |
| `pnpm test:app-upgrade`             | 构建两个真实 macOS App，验证设置面板、断开重连、启动失败回滚、配套升级与界面确认。会临时改动版本号并在结束时恢复，不要与其他打包命令并行 |
| `pnpm tsx scripts/e2e-dispatch.mts` | 手工集成检查，执行真实工兵任务，需要模型凭据                                                                                             |

## React 代码质量

[React Doctor](https://react.doctor) 用确定性规则扫描 `src/**`（跳过构建产物）的正确性、性能、可访问性、安全与可维护性，`mise run verify` 会执行。规则与例外写在 `doctor.config.ts`。新增诊断优先修根因；确属误报或有意为之，用单行 `// react-doctor-disable-next-line <rule>` 并写明原因，不整条规则关掉。
