# Agent notes

- Product requirements: `docs/prd.md`; vocabulary: `CONTEXT.md`; decisions: `docs/adr/`.
- Package manager: pnpm. Toolchain is pinned in `mise.toml` (Node 26, pnpm 12.5.1); run commands through mise (`mise run verify`) or a mise shell.
- Verify: `mise run verify` = `pnpm typecheck` + `pnpm lint` (oxlint + oxfmt; `pnpm lint:fix` to format) + `pnpm react:doctor` (react-doctor, config in `doctor.config.ts`) + `pnpm test` (builds the service payload, then runs `tests/*.test.ts` with `tsx --test`; no model calls). `mise tasks ls` lists the rest; every task wraps a `package.json` script.
- React Doctor findings: fix the root cause. Suppress a single line with `// react-doctor-disable-next-line <rule>` and a comment explaining why; do not disable whole rules without updating `doctor.config.ts`.
- Local env vars live in git-ignored `.env`, loaded by mise `[env] _.file` (start from `.env.example`). The launchd service cannot see the shell, so `mise run service:env` copies only `MAGPIE_*` / `TELEGRAM_*` into `<dataDir>/service.env` (0600); restart the service afterwards.
- Only the resident service writes `tian.db`; schema lives in `src/worker/db.ts`. Feature stores may own their tables in a separate module using `Db.sqlite`, `Db.transaction`, and `Db.once`.
- Chief tools live in `src/worker/tools.ts`; worker tools in `src/worker/worker-tools.ts`. Socket/IPC command contracts are in `src/shared/contracts.ts`.
- Docs (README, PRD, ADRs) are written in Chinese; UI copy, code identifiers, and comments are in English.
