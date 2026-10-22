# Tian Agent — Ubiquitous Language & Core Concepts

**English** | [简体中文](docs/CONTEXT.md)

An always-on personal agent: users manage goals; agents manage tasks. Conversations may conclude, but memory, goals, and responsibilities endure.

## Participants

**Chief**:
The always-on primary conversational agent that interacts with the user; responsible for Global memory (facts about Tian and facts shared across projects), goal planning, work delegation, and status reporting. Project memory is queried read-only when needed. The Chief does not edit code directly.
_Avoid_: steward, assistant, orchestrator

**Worker**:
A headless coding agent that executes a single Run inside an isolated Git worktree; reads shared memory but never writes memories.
_Avoid_: sub-agent, executor

**Manager (Project Manager)**:
Exactly one persistent Pi conversation per project, created when the project is registered, with a required name. The Chief delegates bounded project work to it as a discrete Task assigned to the Manager, which the Manager executes, concludes, and reports back on. Tian can also directly assign tasks inside the Manager conversation—such tasks belong directly to the Manager and conclude quietly without notifying the Chief. The Manager is the sole agent writer of its project's memories and Notes, manages project-scoped Tasks and Runs, and dispatches coding tasks to Workers. Global memory is read-only for the Manager; Goals remain owned by the Chief, and the Manager does not edit code directly.
_Avoid_: sub-agent, coordinator

## Scopes

**Scope**:
The boundary of ownership for memories, Notes, Inbox messages, and conversations. Only two scope types exist: Global and Project. Global memories and Notes belong to the Chief; Project memories and Notes belong to that project's Manager.
_Avoid_: workspace, context

**Project**:
A local directory explicitly registered by the user, mapped to a Project Scope. The user must name its Manager during registration.
_Avoid_: repo, workspace

## Goals & Work

**Goal**:
A long-term outcome the user wishes to achieve or maintain within a Scope, lasting from days to years, carrying completion criteria, constraints, and wakeup rules.
_Avoid_: objective, mission, project

**Task**:
A concrete unit of work to be completed in service of a Goal or independently. Owned by either the user or an agent, with its own state and outcome. May carry an `assignee` to delegate execution to that project's Manager.
_Avoid_: todo, job, ticket

**Run**:
A single execution performed by a Worker for a coding task inside an isolated Git worktree; may contain multiple Attempts.
_Avoid_: job, dispatch (dispatch is an action, not an object)

**Attempt**:
A single round of input and result within a Run; a follow-up generates a new Attempt, reusing the same Worker conversation and worktree.
_Avoid_: retry, round

**Review**:
The user's decision on a Run's outcome (Land, Ship, or Discard), tracked separately from the Run's execution state.
_Avoid_: acceptance, approval

**Land**:
Merges the Run's branch into the local checkout of its designated base branch.
_Avoid_: merge

**Ship**:
Pushes the Run's branch to the remote repository and creates or reuses a Pull Request.
_Avoid_: push, deploy

**Schedule**:
A durable rule that wakes a Goal according to a cron expression and produces a Task.
_Avoid_: timer, job, heartbeat

**Trigger**:
The originating cause of a Task: Manual, Schedule, or external Event.
_Avoid_: hook, wakeup

## Memory

**Memory**:
A single fact, preference, decision, or conclusion preserved across conversations, carrying provenance and confidence; single-line and at most 1,000 Unicode characters.
_Avoid_: note, fact, log line

**Core Memory**:
A small subset of memories within a Scope explicitly selected by the user or the Scope's memory owner (Chief for Global, Manager for its Project), rendered and injected within a token budget. Chief conversations receive only Global Core Memory; Manager conversations receive Global and their own Project's Core Memory.
_Avoid_: wake, profile, system memory, summary tree

**Select / Deselect**:
Places an active Memory into or removes it from Core Memory. Deselection is not deletion: the memory remains active and searchable.
_Avoid_: pin, unpin, promote (promote specifically refers to converting a candidate into an active memory)

**Core Usage**:
The ratio of estimated tokens for currently selected Core Memory entries (based on fully rendered text including sequence numbers, types, confidence levels, and usage footer) against the Scope's token budget.
_Avoid_: truncation, overflow log

**Supersede**:
Replaces an outdated Memory with a revised Memory; the previous Memory is retained as history, leaves Core Memory, and will not be re-selected automatically.
_Avoid_: overwrite, edit, update

**Provenance**:
The originating source and confidence tier of a Memory: user confirmed, agent inferred, or third-party data. The actor (who executed the write) and source (who stated the fact) are recorded separately; marked as user confirmed only if the current request originated from a genuine user turn.
_Avoid_: origin, citation

**History**:
Searchable log of all past conversation transcripts and events; only items consolidated into Memory automatically enter other conversations.
_Avoid_: episodic memory, transcript log

**Note**:
A long-form Markdown document under a Scope's `notes/` directory for content unsuitable for a single-line Memory.
_Avoid_: doc, memory

## Improvements

**Improvement Log**:
A triage-ready collection of improvement records scoped to Global or a Project, containing product issues, user friction, ideas, and wins; writable by Tian, Chief, or automated system instrumentation.
_Avoid_: bug tracker, feedback inbox, event log

**Improvement Entry**:
A single record within the Improvement Log, carrying a kind (`issue`, `friction`, `idea`, or `win`), status, and optional references to Runs, Conversations, or Tasks; can be promoted to a Task.
_Avoid_: log line, event, memory

## Interactions

**Conversation**:
A single persistent Pi session for Chief, Manager, or Worker (referred to as "Session" in the PRD).
_Avoid_: session, chat, thread

**Channel Binding**:
A stable mapping from `(channel, externalId, scopeId)` to an internal Conversation, e.g. Desktop, Telegram, a specific Goal, or a Project Manager.
_Avoid_: session, connection

**Inbox**:
A file-drop mailbox under a Scope for external participants to deliver messages.
_Avoid_: mailbox, task inbox

**Archive**:
Collapses a conversation from the sidebar and yields its claim as a Scope-level wake target without deleting transcripts or terminating Tasks; archived conversations remain openable and searchable.
_Avoid_: delete, close

**Task Board**:
A centralized interface displaying pending, running, awaiting approval, failed, and recently completed Tasks.
_Avoid_: task inbox, schedule view, dashboard

**Notification**:
A durable delivery record that wakes a Chief or Manager Conversation, deduplicated by delivery ID.
_Avoid_: alert, event, push

**Approval**:
Persistent user consent or rejection for a specific controlled action; once rejected, the identical operation cannot proceed.
_Avoid_: permission, consent, review

**Event**:
An auditable business fact recorded in the system, such as a Task status transition, an approval decision, or an external notification.
_Avoid_: log, notification
