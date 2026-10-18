# 保留 TypeScript 常驻服务与 Electron 客户端，不改写为 Rust + GPUI

PRD v0.1 的技术方向写的是 Rust Host + GPUI Desktop。项目继续使用现有的 Node 常驻服务（launchd）+ Electron/React 客户端，PRD 中的架构原则保留，语言与 UI 框架改为现状。

## 背景

PRD 想要的 Host-owned State、Local-first、可恢复、可审计，这个项目已经以 TypeScript 实现：独占锁的常驻服务、Unix socket RPC、升级事务与回滚、Run 恢复、Durable 去重。默认执行器 Pi Durable（`@earendil-works/pi-durable`）本身是 TypeScript 库；换成 Rust Host 仍需一个 Node 进程运行 Pi，相当于多一层跨进程协议，却换不来 PRD 中任何一项能力。

## 决定

- 常驻服务继续是唯一的状态所有者，Rust Host 的职责由它承担。
- PRD 中的 "GPUI Frontend" 由现有 React renderer 承担；后台工作不在 renderer 进程，不阻塞 UI 的要求天然满足。
- Runtime-agnostic 通过现有的 `WorkerRuntime` 接口与 `AgentRuntime` 适配器实现；新增执行器实现同一接口，而不是换宿主语言。

## 后果

- 跨平台（Linux / Windows）时需要替换 launchd 部分，而不是重写服务。
- 将来如果确有性能热点（例如大规模检索），以独立组件引入，不重开整体改写。
