# Improvement Log

**English** | [简体中文](zh/improvement-log.md)

The Log view and the `improvements` table record product issues, user friction, ideas, and wins. They stay separate from audit Events and Memory ([D11](decisions.md#d11--improvement-log-writable-by-user-and-chief-automatic-fingerprinting-for-system-errors)).

- Each entry has `kind` (issue / friction / idea / win), `status` (open / promoted / resolved / dismissed), severity, source (user / chief / system), and scope. It can link to a Run, Conversation, or Event. The list returns summaries only. The UI loads detail text when you expand a row.
- The Chief writes with `log_improvement`. Users create entries in the Log view. Use `list_improvements` to prevent duplicate records.
- Service startup, listeners, Inbox, History, notifications, scheduler, Runs, Land/Ship, Telegram, and renderer errors record automatically through a single `reportIssue` sink. The system merges matching `area + error name + code + message` in the same scope into an open/promoted entry and increments `occurrences`. Text redacts bot tokens, Bearer tokens, `sk-*` keys, and common secret assignments.
- Promote creates a pending Task with deduplication key `improvement:<id>` in the same transaction and writes back `task_id`. Repeated promotions reuse the same Task.
- Automatic capture is best-effort. Storage failures fall back to `console.error` and do not block primary work. Raw process output still writes to `service.log`.
- Log commands and `improvements` events raise `SERVICE_PROTOCOL` to 3.
