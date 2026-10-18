# Agent notes

- Product requirements: `docs/prd.md`; vocabulary: `CONTEXT.md`; decisions: `docs/adr/`.
- Package manager: pnpm. Node 24+.
- Verify: `pnpm typecheck`, `pnpm lint` (oxlint + oxfmt; `pnpm lint:fix` to format), `pnpm test` (builds the service payload, then runs `tests/*.test.ts` with `tsx --test`; no model calls).
- Accessibility: app components in `src/renderer` must pass the oxlint `jsx-a11y` rules (error-level override scoped to `src/renderer/**` in `.oxlintrc.json`; vendored `src/components/ui` is exempt). Every icon-only control carries an accessible name, custom widgets follow the ARIA pattern they claim (roles, roving tabindex, keyboard operation), controls are tied to visible labels via `htmlFor`/`id`, async status changes are announced (`role="status"` / `role="alert"`), decorative icons are `aria-hidden`, and animation honors `prefers-reduced-motion`. Never add the `autoFocus` attribute or `role="application"`.
- Only the resident service writes `tian.db`; schema lives in `src/worker/db.ts`. Feature stores may own their tables in a separate module using `Db.sqlite`, `Db.transaction`, and `Db.once`.
- Chief tools live in `src/worker/tools.ts`; worker tools in `src/worker/worker-tools.ts`. Socket/IPC command contracts are in `src/shared/contracts.ts`.
- Docs (README, PRD, ADRs) are written in Chinese; UI copy, code identifiers, and comments are in English.
