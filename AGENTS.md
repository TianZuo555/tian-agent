# Agent notes

- Product requirements: `docs/prd.md`; vocabulary: `CONTEXT.md`; decisions: `docs/adr/`.
- Package manager: pnpm. Node 24+.
- Verify: `pnpm typecheck`, `pnpm lint` (oxlint + oxfmt; `pnpm lint:fix` to format), `pnpm test` (builds the service payload, then runs `tests/*.test.ts` with `tsx --test`; no model calls).
- Only the resident service writes `tian.db`; schema lives in `src/worker/db.ts`. Feature stores may own their tables in a separate module using `Db.sqlite`, `Db.transaction`, and `Db.once`.
- Chief tools live in `src/worker/tools.ts`; worker tools in `src/worker/worker-tools.ts`. Socket/IPC command contracts are in `src/shared/contracts.ts`.
- Docs (README, PRD, ADRs) are written in Chinese; UI copy, code identifiers, and comments are in English.
