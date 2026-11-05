# Pi Server Operations Spec

**English** | 简体中文 (to follow)

Status: Draft v0.1 — 2026-11.

## 1. Host and Layout

One server per user, on a machine that stays awake: the user's main Mac in v1, a Linux box later.

| Item           | macOS v1                                            | Linux (planned)                    |
| -------------- | --------------------------------------------------- | ---------------------------------- |
| Supervisor     | launchd, label `dev.tian.agent`                     | systemd unit `pi-server.service`   |
| Data directory | `~/Library/Application Support/Tian Agent` (`0700`) | `$XDG_DATA_HOME/pi-server`         |
| Socket         | `<dataDir>/agent.sock`                              | same                               |
| Secrets env    | `<dataDir>/service.env` (`0600`)                    | same (`systemd` `EnvironmentFile`) |
| Install dir    | `<dataDir>/service` (versioned releases)            | same layout                        |
| Logs           | `<dataDir>/service/logs/service.log`                | same                               |
| Lock           | `<dataDir>/service.lock`, stale after 10 s          | same                               |
| Network        | WSS on the tailnet interface, port 8787             | same                               |

Rules:

- The service holds an exclusive lock on the data dir. Two servers on one data dir is a misconfiguration, not a supported mode.
- The process runs as the login user, not root. No daemon user, no container in v1.
- The data dir is excluded from cloud sync (iCloud/Dropbox): SQLite plus WAL under a sync agent corrupts.

## 2. Tailscale

- The server node carries the tag `tag:pi-server`; its MagicDNS name is the address clients use (`pi.tailxxxx.ts.net`).
- Node key expiry is disabled for the server node (`tailscale set --advertise-tags=tag:pi-server`, expiry off in the admin console). An expired server key looks exactly like a crash to every client.
- ACL sketch (admin console, HuJSON):

```jsonc
{
  // Replace with the owner's Tailscale login. `autogroup:member` includes every
  // invited user of the tailnet, not only the owner.
  "tagOwners": { "tag:pi-server": ["owner@example.com"] },
  "acls": [
    // Only the owner's own devices may reach the Pi API and nothing else.
    {
      "action": "accept",
      "src": ["owner@example.com"],
      "dst": ["tag:pi-server:8787"],
    },
    // The server reaches nothing on the tailnet except the model gateway.
    {
      "action": "accept",
      "src": ["tag:pi-server"],
      "dst": ["tag:model-gateway:3425"],
    },
  ],
}
```

- The ACL names the owner's identity explicitly, never `autogroup:member`: a tailnet can have invited users, and that group would grant their devices the same access. If the owner's devices carry tags, use a source that only the owner controls.

- Funnel stays off. No `0.0.0.0` listener. If the server needs a public endpoint later, that is a separate, deliberate decision.
- TLS: certificate from `tailscale cert <name>.ts.net`, renewed before expiry by a launchd timer (or `tailscale serve` termination). The application trusts TLS; there is no `--insecure` mode.
- Web build (if served by the server): same origin, same certificate, port 8787 with a static route.

## 3. Installation and Upgrade

The existing upgrade model (D9) carries over: versioned release directories, a maintenance transaction, a database snapshot, a health check, and rollback.

1. `pi upgrade <release>` downloads or receives the release, verifies its checksum, and writes it beside the current release.
2. The service enters maintenance: it answers `getActivity` and refuses other commands (`beginMaintenance`).
3. The service snapshots the databases, applies migrations in one transaction, and stops accepting requests.
4. launchd restarts it into the new release. A health probe (`ping`, `getActivity`, database version) runs for 60 s.
5. Failure: the previous release is restored, the snapshot is restored if the database version advanced, and the service returns to maintenance-free state.

Constraints:

- `DATABASE_VERSION` and `SERVICE_PROTOCOL` are checked at startup. A server refuses to start when the database is newer than the binary.
- One upgrade at a time; the lock makes that explicit.
- Clients see the maintenance state and show the card from [ui.md](ui.md#9-states).
- A client never triggers an upgrade. The user does, from Settings or a CLI.

## 4. Backups and Restore

- **Automatic:** before every upgrade (snapshot of `tian.db` and `pi-session.sqlite` via the SQLite backup API, WAL checkpointed first). Kept 7 daylies and 4 weeklies, plus every upgrade snapshot for 30 days.
- **Scheduled:** daily at 03:00 local time to `<dataDir>/backups`, optionally mirrored to the user's backup target (restic/Borg or Time Machine for the data dir).
- **Verify:** nightly `PRAGMA integrity_check` on the newest backup; a failed check raises a notice in the client.
- **Restore:** stop the service, move the current data dir aside, restore the newest verified backup, start the service, confirm `DATABASE_VERSION` and one conversation. Documented as a five-command procedure, tested once per release.

## 5. Logs, Metrics, Health

- Structured JSON lines: `ts`, `level`, `area`, `event`, `deviceId`, `command`, `requestId`, `durationMs`, `error.code`. Message bodies and model keys never appear.
- Rotation: 20 MiB × 5 files. Client can fetch the tail through the Settings → Service screen (admin-only path in v1: local socket only).
- Health: `ping` → `{ version, databaseVersion, protocol, startedAt, dataDirBytes, queueDepth, lastRunAt }`.
- Counters worth keeping: requests by command, event frames per minute, connected devices, run failures by role, model gateway latency, dedupe hits, resume failures.
- No external telemetry in v1. Local aggregation only; anything leaving the machine is opt-in.

## 6. Secrets and Keys

- Model keys and channel credentials live in `<dataDir>/service.env` (`0600`), copied from mise only by `mise run service:env`. The app and clients never see them.
- Rotating a key = edit `service.env`, restart the service, verify one model call.
- Device revocation is not key rotation: revoking a device closes its connections and keeps its record with `revokedAt` set. The record is the denylist, so the same node cannot enroll again; delete it only after the node is also removed from the tailnet.
- The Tailscale node key never leaves `tailscaled`.

## 7. Disk and Data Lifecycle

- Baseline: two SQLite databases plus WAL/SHM, worktrees under the project directories, release dirs, logs, backups.
- Watch: WAL growth after long transactions, `pi-session.sqlite` growth from transcripts (paging in the client does not shrink it), orphaned worktrees from failed Runs.
- Policy: worktrees older than 30 days with a discarded review are eligible for cleanup; a Run's artifacts follow its review state. Transcript pruning is not automatic in v1.
- Alerts: free space below 10 GiB, database size over 5 GiB, backup failure, integrity-check failure.

## 8. Several Machines and Migration

- One server. Several machines may run _clients_; two servers never share a data dir.
- Moving the server to a new Mac: stop the service, copy the data dir (excluding the lock and socket), install the service, move the tailnet node name to the new machine (or use a new name and update clients), start, verify one device handshake.
- Tailnet node names are user-visible; a rename is a client reconnect, not a data migration.

## 9. Incident Playbook

| Symptom                       | First checks                                                                             | Likely fix                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Clients cannot connect        | `tailscale status`, listener on the tailnet IP, service log `listen`, certificate expiry | Restart the node or the service; renew the certificate             |
| Service not running           | launchd status, lock file, log tail                                                      | Remove a stale lock only if no process holds it; start the service |
| Runs stop mid-turn            | log for `attempt`, disk space, model gateway health, worker exit                         | Free disk, restart the gateway, re-dispatch the attempt            |
| Database error                | `PRAGMA integrity_check`, newest backup, `DATABASE_VERSION`                              | Restore the backup; never edit the database by hand                |
| Duplicate messages            | dedupe hits in logs, `requestId` reuse on the client                                     | Fix the client intent key; do not delete messages by hand          |
| Client battery drain (mobile) | connection churn, reconnect backoff, keepalive                                           | Server-side keepalive only; investigate the client's tailnet mode  |
| Upgrade stuck in maintenance  | `maintenance.json`, logs, release dirs                                                   | Finish or roll back the transaction by hand, then restart          |

## 10. Open Questions

1. Linux parity: when the server moves to a Linux box, systemd + GTK-less host, or stay on macOS only in v1?
2. Backup destination: local only, restic to a remote, or Time Machine for the data dir? Restore tests need a defined target.
3. Should health and counters be exposed through the protocol to the client (Settings → Service), or stay local-only?
4. Certificate renewal: `tailscale cert` timer versus `tailscale serve`, which terminates TLS itself. The second removes application TLS code.
5. Data dir encryption at rest: rely on FileVault (v1) or add application-level encryption for memory and transcripts?
