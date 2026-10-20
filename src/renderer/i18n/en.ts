/**
 * English is the default locale and source of truth for all UI copy.
 *
 * Vocabulary strictly follows CONTEXT.md:
 * - Chief (总管): Long-running conversational agent. Avoid: steward, assistant, orchestrator.
 * - Worker (工兵): Execution agent in isolated worktrees. Avoid: sub-agent, executor.
 * - Manager (项目管理者): Project-scoped durable session. Avoid: sub-agent, coordinator.
 * - Scope: Global or Project boundary. Avoid: workspace, context.
 * - Project: Registered local directory mapped to a Scope. Avoid: repo, workspace.
 * - Goal: Long-running outcome. Avoid: objective, mission, project.
 * - Task: Concrete unit of work. Avoid: todo, job, ticket.
 * - Run: Execution attempt by a Worker. Avoid: job, dispatch.
 * - Land / Ship / Discard: Terminal review decisions. Avoid: merge (for land), deploy/push (for ship).
 * - Approval: User authorization for controlled operations. Avoid: permission, consent.
 * - Improvement Log: Curated collection of issues, friction, ideas, and wins.
 *
 * Values are either plain strings with `{param}` placeholders or functions for plural/compound formatting.
 */
export type Params = Record<string, string | number>;
export type Message = string | ((params: Params) => string);

export const en = {
  // ─── 1. Common Verbs & Chrome ──────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.add': 'Add',
  'common.new': 'New',
  'common.loading': 'Loading…',
  'common.browse': 'Browse',
  'common.allScopes': 'All scopes',
  'common.newConversation': 'New conversation',
  'common.rollback': 'Roll back',

  // ─── 2. Boot & Crash Error Screens ─────────────────────────────────────────
  'boot.waking': 'Waking the chief…',
  'boot.unreachable': 'Cannot reach the background service',
  'boot.openServiceSettings': 'Open service settings',
  'error.title': 'Something went wrong',
  'error.recorded':
    'The error was recorded in the Improvement Log. Reload to continue.',
  'error.reload': 'Reload',

  // ─── 3. Connection Banner ──────────────────────────────────────────────────
  'banner.error.title': 'The last operation did not finish',
  'banner.error.detail': 'Check the service settings, then try again.',
  'banner.disconnected.title': 'Background service disconnected',
  'banner.disconnected.detail':
    'Tasks keep running in the background. Reconnect to keep watching.',
  'banner.starting.title': 'Reconnecting to the background service',
  'banner.starting.detail': 'Reconnecting to the background service…',
  'banner.serviceSettings': 'Service settings',
  'banner.dismissError': 'Dismiss error',

  // ─── 4. Pane & Sidebar Toggles ─────────────────────────────────────────────
  'shell.resizeContext': 'Resize context pane',
  'shell.resizeNav': 'Resize navigation',
  'toggle.hideSidebar': 'Hide sidebar',
  'toggle.showSidebar': 'Show sidebar',
  'toggle.hideContext': 'Hide context pane',
  'toggle.showContext': 'Show context pane',

  // ─── 5. Primary Navigation Tabs ────────────────────────────────────────────
  'nav.chat': 'Chat',
  'nav.goals': 'Goals',
  'nav.skills': 'Skills',
  'nav.inbox': 'Inbox',
  'nav.settings': 'Settings',

  // ─── 6. Sidebar & Project Scopes ───────────────────────────────────────────
  'sidebar.tagline': 'chief of staff',
  'sidebar.navigation': 'Navigation',
  'sidebar.primaryNav': 'Primary',
  'sidebar.commandPalette': 'Command palette',
  'sidebar.search': 'Search',
  'sidebar.projects': 'Projects',
  'sidebar.addProject': 'Add project',
  'sidebar.noProjects':
    'No projects yet. Add a directory to give the chief a project scope.',
  'sidebar.addAProject': 'Add a project',
  'sidebar.archive': 'Archive',
  'sidebar.archivedSection': 'Archived conversations',
  'sidebar.showMore': 'Show more',
  'sidebar.showLess': 'Show less',
  'sidebar.noConversations': 'No conversations yet',
  'sidebar.restore': 'Restore',
  'sidebar.archiveTooltip': 'Archive',
  'sidebar.newConversationTooltip': 'New conversation',
  'sidebar.projectManager': 'Project manager',
  'sidebar.scopeLabel': 'Scope: {name}',
  'sidebar.selectScope': 'Select scope {name}',
  'sidebar.openManager': 'Open {name} manager',
  'sidebar.newConversationIn': 'New conversation in {name}',
  'sidebar.conversationLabel': 'Conversation: {title}',
  'sidebar.archivedConversationLabel': 'Archived conversation: {title}',
  'sidebar.managerLabel': 'Project manager: {title}',
  'sidebar.archivedManagerLabel': 'Archived project manager: {title}',
  'sidebar.archiveAction': 'Archive conversation: {title}',
  'sidebar.restoreAction': 'Restore conversation: {title}',
  'sidebar.openSettings': 'Open settings',
  'sidebar.addProjectTitle': 'New project',
  'sidebar.addProjectDesc': 'Register a directory as a scope for the chief.',
  'sidebar.projectName': 'Name',
  'sidebar.projectNameAria': 'Project name',
  'sidebar.projectPath': '/path/to/project',
  'sidebar.projectPathAria': 'Project path',

  // ─── 7. Service Status Footer ──────────────────────────────────────────────
  'service.connected': 'Service connected',
  'service.connecting': 'Connecting…',
  'service.reconnecting': 'Reconnecting…',
  'service.unavailable': 'Service unavailable',

  // ─── 8. Relative Time Formats ──────────────────────────────────────────────
  'time.now': 'now',
  'time.m': '{n}m',
  'time.h': '{n}h',
  'time.d': '{n}d',
  'ago.justNow': 'just now',
  'ago.m': '{n}m ago',
  'ago.h': '{n}h ago',
  'ago.d': '{n}d ago',

  // ─── 9. Chat Composer ──────────────────────────────────────────────────────
  'composer.placeholder': 'Message the chief…',
  'composer.waiting': 'Waiting for the service…',
  'composer.message': 'Message',
  'composer.model': 'Model',
  'composer.local': 'Local',
  'composer.send': 'Send',
  'composer.stop': 'Stop',
  'composer.sendHint': 'send',
  'composer.newLineHint': 'new line',
  'composer.working': 'working',
  'composer.ready': 'ready',

  // ─── 10. Chat View & Suggestions ───────────────────────────────────────────
  'chat.conversation': 'Conversation',
  'chat.messages': 'Messages',
  'chat.scopeTag': 'Scope · {name}',
  'chat.personalSteward': 'Chief of staff',
  'chat.welcomeTitle': 'Pick up where you left off.',
  'chat.welcomeBody':
    'Choose a conversation on the left, or start something new. Tian keeps the context so you do not have to.',
  'chat.browse': 'Browse',
  'chat.emptyTitle': 'The chief is standing by.',
  'chat.emptyBody':
    'Ask for a plan, a status check, or hand off a task. Tian remembers what matters across conversations.',
  'chat.pressK': 'press ⌘K for everything',
  'chat.suggestion.plan.title': 'Plan my day',
  'chat.suggestion.plan.hint': 'goals, tasks, and time',
  'chat.suggestion.plan.prompt':
    'Help me plan my day. Look at my active goals and tasks, then propose a short, realistic plan.',
  'chat.suggestion.goals.title': 'Review goals',
  'chat.suggestion.goals.hint': 'what needs attention',
  'chat.suggestion.goals.prompt':
    'Review my active goals and tell me what needs attention next, in priority order.',
  'chat.suggestion.check.title': 'Status check',
  'chat.suggestion.check.hint': 'runs and loose ends',
  'chat.suggestion.check.prompt':
    'Check current status: summarize recent runs and anything that needs my attention.',
  'chat.working': 'working…',
  'chat.thinking': 'thinking…',
  'chat.writing': 'writing…',
  'chat.copy': 'Copy message',
  'chat.copied': 'Copied',
  'chat.assistantMessage': 'Agent message',
  'chat.userMessage': 'User message',
  'chat.latest': 'latest',
  'chat.toolCalls': (p: Params) => `${p.count} tool calls`,
  'chat.running': (p: Params) => `${p.count} running`,
  'chat.failed': (p: Params) => `${p.count} failed`,
  'chat.mermaid': 'Mermaid diagram',

  // ─── 11. Context Pane & Run Actions ────────────────────────────────────────
  'context.title': 'Context',
  'context.sections': 'Context sections',
  'context.tasks': 'Tasks',
  'context.runs': 'Runs',
  'context.memory': 'Memory',
  'context.backToRuns': 'Back to runs',
  'context.dispatched': (p: Params) => `${p.count} dispatched`,
  'context.refreshRuns': 'Refresh runs',
  'context.noRuns': 'No runs yet',
  'context.noRunsHint': 'Runs dispatched to a worker will appear here.',
  'context.noTasks': 'No tasks yet',
  'context.noTasksHint': 'Add one below or ask the chief to plan.',
  'context.addTask': 'Add a task…',
  'context.newTaskTitle': 'New task title',
  'context.addTaskAria': 'Add task',
  'context.taskLabel': 'Task: {title}',
  'context.runLabel': 'Run {id}: {status}',
  'context.followUp': 'Follow up',
  'context.land': 'Land',
  'context.ship': 'Ship',
  'context.discard': 'Discard',
  'context.noBranch': 'No git branch for this run.',
  'context.noChanges': 'No file changes in this run.',
  'context.skills': 'Skills ({count})',
  'context.report': 'Report',

  // ─── 12. Run Status Badges ─────────────────────────────────────────────────
  'run.running': 'running',
  'run.queued': 'queued',
  'run.collecting': 'collecting',
  'run.done': 'done',
  'run.failed': 'failed',
  'run.interrupted': 'interrupted',
  'run.discarded': 'discarded',
  'run.landed': 'landed',
  'run.shipped': 'shipped',

  // ─── 13. Memory Management Panel ───────────────────────────────────────────
  'memory.active': (p: Params) => `${p.count} active`,
  'memory.candidates': (p: Params) => `${p.count} candidates`,
  'memory.coreStats': 'core: {selected} · {tokens}/{budget} tokens',
  'memory.history': 'History',
  'memory.emptyAll': 'No memories at all',
  'memory.empty': 'No memories yet',
  'memory.emptyHint':
    'Facts the chief keeps, plus candidates extracted from history, live here.',
  'memory.candidatesSection': 'Candidates — extracted from history',
  'memory.coreSection': 'Core — injected every turn',
  'memory.searchableSection': 'Active — searchable, not resident',
  'memory.historySection': 'History',
  'memory.seqLabel': 'Memory #{seq}',
  'memory.promote': 'Promote memory #{seq}',
  'memory.dismissCandidate': 'Dismiss candidate #{seq}',
  'memory.removeCore': 'Remove memory #{seq} from Core',
  'memory.selectCore': 'Select memory #{seq} into Core',
  'memory.revise': 'Revise memory #{seq}',
  'memory.forget': 'Forget memory #{seq}',
  'memory.reviseDesc':
    'The old memory is kept as history but leaves Core Memory.',
  'memory.revisedTextAria': 'Revised memory text',
  'memory.characters': '{count}/1000 characters',
  'memory.reason': 'Reason',
  'memory.reviseReasonPlaceholder': 'Why is this being revised?',
  'memory.reviseReasonAria': 'Revision reason',
  'memory.reviseSubmit': 'Revise',
  'memory.forgetDesc':
    'It is marked deleted and leaves Core Memory; the record is kept in the version history.',
  'memory.forgetReasonPlaceholder': 'Why should this be forgotten?',
  'memory.forgetReasonAria': 'Forget reason',
  'memory.forgetSubmit': 'Forget',
  'memory.replaces': 'replaces #{seq}',
  'memory.statusDeleted': 'deleted',
  'memory.statusSuperseded': 'superseded',
  'memory.savedDropped':
    'Saved #{seq}, but it no longer fits Core Memory and is only searchable. Free Core budget and select it to make it resident again.',

  // ─── 14. Goals & Tasks ─────────────────────────────────────────────────────
  'goals.meta': '{open} active · {pending} pending',
  'goals.new': 'New goal',
  'goals.empty.title': 'No goals yet.',
  'goals.empty.hint': 'Give the chief something long-running to keep moving.',
  'goals.noneActive': 'Nothing active — the closed ones are below.',
  'goals.notices': 'Notices',
  'goals.closed': 'Closed',
  'goals.resume': 'Resume',
  'goals.resumeAria': 'Resume goal',
  'goals.noTasks': 'No tasks yet. Add one above or let the chief create them.',
  'goals.openSection': 'Open goals',
  'goals.noticesSection': 'Notices',
  'goals.tasksSection': 'Tasks',
  'goals.closedSection': 'Closed goals',
  'goals.aria': 'Goals',

  'goal.status.active': 'Active',
  'goal.status.paused': 'Paused',
  'goal.status.blocked': 'Blocked',
  'goal.status.completed': 'Completed',
  'goal.status.cancelled': 'Cancelled',

  'task.status.pending': 'Pending',
  'task.status.running': 'Running',
  'task.status.waiting_approval': 'Pending approval',
  'task.status.blocked': 'Blocked',
  'task.status.failed': 'Failed',
  'task.status.paused': 'Paused',
  'task.status.completed': 'Completed',
  'task.status.cancelled': 'Cancelled',

  'goal.nextRun': 'next {time}',
  'goal.lastRun': 'last run {time}',
  'goal.tasksProgress': '{done}/{total} tasks',
  'goal.due': 'due {date}',
  'goal.badge': 'Goal',
  'goal.runNow': 'Run now',
  'goal.pause': 'Pause',
  'goal.pauseAria': 'Pause goal',
  'goal.resumeAria': 'Resume goal',
  'goal.edit': 'Edit',
  'goal.editAria': 'Edit goal',
  'goal.cancel': 'Cancel goal',
  'goal.schedule': 'Schedule',
  'goal.removeSchedule': 'Remove schedule',
  'goal.cronPlaceholder': 'cron expression, e.g. 30 9 * * *',
  'goal.cronAria': 'Cron expression',
  'goal.form.edit': 'Edit goal',
  'goal.form.desc':
    'A goal is an outcome to reach or keep over time. The chief splits it into tasks and reports progress.',
  'goal.form.objectivePlaceholder':
    'Objective: e.g. check tian-agent CI every morning',
  'goal.form.objective': 'Objective',
  'goal.form.criteriaPlaceholder':
    'Success criteria (optional): e.g. green for 7 days',
  'goal.form.criteria': 'Success criteria',
  'goal.form.constraintsPlaceholder':
    'Constraints (optional): e.g. read-only, no issues',
  'goal.form.constraints': 'Constraints',
  'goal.form.budget': 'Daily run budget',
  'goal.form.create': 'Create goal',

  // ─── 15. Inbox View ────────────────────────────────────────────────────────
  'inbox.meta': '{unread} unread · {total} total',
  'inbox.empty.title': 'Inbox zero.',
  'inbox.empty.hint':
    'Messages from agents, runs, and other channels land here.',
  'inbox.aria': 'Inbox',

  // ─── 16. Skills Registry ───────────────────────────────────────────────────
  'skills.meta': '{approved} approved · {candidates} candidates',
  'skills.aria': 'Skills',
  'skill.status.candidate': 'Candidate',
  'skill.status.approved': 'Approved',
  'skill.status.retired': 'Retired',
  'skill.status.superseded': 'Superseded',
  'skill.verified': 'verified',
  'skill.failedRun': 'verification failed',
  'skills.empty.title': 'No skills yet.',
  'skills.empty.hint':
    'When a run succeeds with clear steps, the procedure lands here as a candidate. Nothing reaches a worker before you approve it.',
  'skills.candidates': 'Candidates',
  'skills.candidatesHint':
    'Extracted from successful runs. Approve to let workers load them, or dismiss.',
  'skills.approved': 'Approved',
  'skills.approvedHint':
    'Injected into matching worker briefs at dispatch. Roll back if a run using a version fails.',
  'skills.retired': 'Retired',
  'skills.retiredHint':
    'Kept for the record; retired and superseded versions are never injected.',
  'skills.history': 'History ({count})',
  'skills.rollbackFull': 'Roll back to the previous version',
  'skills.approve': 'Approve',
  'skills.dismiss': 'Dismiss',
  'skills.retire': 'Retire',
  'skills.rollbackAria': 'Roll back {name} to the previous version',
  'skills.approveAria': 'Approve {name}',
  'skills.dismissAria': 'Dismiss {name}',
  'skills.retireAria': 'Retire {name}',
  'skills.updated': 'updated {time}',

  // ─── 17. Settings View ─────────────────────────────────────────────────────
  'settings.aria': 'Settings',
  'settings.sectionsNav': 'Settings sections',
  'settings.closeAria': 'Close settings',
  'settings.magpieOnline': 'magpie online',
  'settings.magpieOffline': 'magpie offline',
  'settings.openCount': '{count} open',
  'settings.section.general': 'General',
  'settings.section.appearance': 'Appearance',
  'settings.section.model': 'Model',
  'settings.section.usage': 'Usage',
  'settings.section.log': 'Improvement log',
  'settings.section.service': 'Service',
  'settings.language': 'Language',
  'settings.languageDesc': 'Interface language. English is the default.',
  'settings.appearance.theme': 'Theme',
  'settings.appearance.themeDesc':
    'System follows the appearance setting of macOS.',
  'settings.appearance.system': 'System',
  'settings.appearance.light': 'Light',
  'settings.appearance.dark': 'Dark',

  // ─── 18. Model Configuration ───────────────────────────────────────────────
  'model.available': '{count} available',
  'model.connected': 'Magpie connected',
  'model.unreachable': 'Magpie unreachable',
  'model.refresh': 'Refresh',
  'model.default': 'Default model',
  'model.choose': 'Choose a model',
  'model.desc':
    'New conversations use the selected model; existing ones keep the model they started with.',
  'model.save': 'Save model',
  'model.unsaved': 'Unsaved change',
  'model.using': 'Using {id}',
  'model.gatewayTitle': 'Gateway override',
  'model.gatewayDesc.pre': 'Set ',
  'model.gatewayDesc.mid': ' and ',
  'model.gatewayDesc.post': ' to point at a different gateway. Defaults to ',
  'model.gatewayDesc.tail': '.',

  // ─── 19. Usage Heatmap ─────────────────────────────────────────────────────
  'usage.aria': 'Model usage in the last {weeks} weeks',
  'usage.none': 'No usage',
  'usage.cell': '{date}: {tokens} tokens, {cost}',
  'usage.total': '{tokens} tokens · {cost} in the last {weeks} weeks',
  'usage.less': 'Less',
  'usage.more': 'More',
  'usage.messages': (p: Params) =>
    `${p.count} ${Number(p.count) === 1 ? 'message' : 'messages'}`,

  // ─── 20. Improvement Log ───────────────────────────────────────────────────
  'log.title': 'Improvement log',
  'log.kind.issue': 'Issue',
  'log.kind.friction': 'Friction',
  'log.kind.idea': 'Idea',
  'log.kind.win': 'Win',
  'log.status.open': 'Open',
  'log.status.promoted': 'Promoted',
  'log.status.resolved': 'Resolved',
  'log.status.dismissed': 'Dismissed',
  'log.severity.low': 'Low',
  'log.severity.medium': 'Medium',
  'log.severity.high': 'High',
  'log.filter.allKinds': 'All kinds',
  'log.filter.issues': 'Issues',
  'log.filter.friction': 'Friction',
  'log.filter.ideas': 'Ideas',
  'log.filter.wins': 'Wins',
  'log.filter.active': 'Active',
  'log.filter.done': 'Done',
  'log.filter.all': 'All',
  'log.promote': 'Promote',
  'log.resolve': 'Resolve',
  'log.dismiss': 'Dismiss',
  'log.reopen': 'Reopen',
  'log.newEntry': 'New entry',
  'log.openCount': '{count} open',
  'log.promotedCount': '{count} promoted',
  'log.totalCount': '{count} total',
  'log.empty': 'Nothing logged yet.',
  'log.noMatch': 'No entries match this view.',
  'log.emptyHint':
    'Log a product issue, friction point, idea, or win. The Chief also records observations while it works.',
  'log.noMatchHint': 'Try a different status, kind, or scope filter.',
  'log.sectionAria': '{label} entries',
  'log.noDetail': 'No detail recorded.',
  'log.meta.task': 'task',
  'log.meta.run': 'run',
  'log.meta.conv': 'conv',
  'log.meta.event': 'event',
  'log.meta.fp': 'fp',
  'log.meta.first': 'first',
  'log.source.you': 'You',
  'log.source.chief': 'Chief',
  'log.source.system': 'System',
  'log.dialog.title': 'New log entry',
  'log.dialog.desc':
    'Record a durable issue, friction point, idea, or win. The Chief can also write here while it works.',
  'log.dialog.kind': 'Kind',
  'log.dialog.summary': 'Summary',
  'log.dialog.summaryPlaceholder': 'What could be better?',
  'log.dialog.detail': 'Detail',
  'log.dialog.detailPlaceholder':
    'Reproduction, evidence, or the concrete proposal…',
  'log.dialog.severity': 'Severity',
  'log.dialog.addingTo': 'Adding to {scope}',
  'log.dialog.submit': 'Log entry',
  'log.sectionMeta': '{open} open · {total} total',

  // ─── 21. Service Settings & Updates ────────────────────────────────────────
  'service.aria': 'Service and updates',
  'service.legacyNote':
    'The legacy service needs a one-time migration: stop it, then install the bundled service shipped with this app. Updating does not delete data.',
  'service.disconnectNote':
    'After disconnecting, background tasks keep running and this window will not reconnect on its own. Stopping the service releases its process and database connections.',
  'service.lastUpdate': 'Last update: ',
  'service.appVersion': 'App version',
  'service.background': 'Background service',
  'service.window': 'This window',
  'service.windowConnected': 'Connected',
  'service.windowDisconnected': 'Disconnected',
  'service.bundled': 'Bundled service version',
  'service.activityTasks': '{count} active tasks',
  'service.activityRuns': '{count} workers',
  'service.maintenance': 'maintenance',
  'service.legacyRunning': 'Legacy running · migration pending',
  'service.legacyStopped': 'Legacy stopped · migration pending',
  'service.running': 'Running · {version}',
  'service.stopped': 'Stopped',
  'service.notInstalled': 'Not installed',
  'service.refresh': 'Refresh status',
  'service.disconnectWindow': 'Disconnect this window',
  'service.connect': 'Connect to service',
  'service.start': 'Start service & connect',
  'service.stop': 'Stop service',
  'service.stopTitle': 'Stop the background service?',
  'service.stopDescLegacy':
    'The legacy service has no idle-task check. Confirm current work can pause first; stopping saves resumable state through a normal shutdown, and the new bundled service can then be installed. Conversations and Memory are kept.',
  'service.stopDesc':
    'Every channel loses the chief until the service restarts. Conversations, tasks, and Memory are kept; reopening the app will not restart the service. Running tasks must finish first.',
  'service.installTitleUpgrade': 'Upgrade the bundled background service?',
  'service.installTitle': 'Install and start the background service?',
  'service.installDesc':
    'Uses the service and runtime bundled with this app. Existing data is kept; the connection drops briefly during the upgrade and the database is backed up first. Running tasks must finish first.',
  'service.upgrade': 'Upgrade bundled service',
  'service.install': 'Install & start service',
  'service.importApp': 'Import new app…',
  'service.recover': 'Recover unfinished update',
  'service.packagedNote':
    'Packaged macOS builds support importing and installing a newer .app.',
  'service.loginToggle': 'Launch at login: {state}',
  'service.on': 'On',
  'service.off': 'Off',
  'service.confirmStop': 'Confirm stop',
  'service.confirmInstall': 'Confirm install / upgrade',
  'service.confirmApply': 'Confirm upgrade & restart',
  'service.chooseAppTitle': 'Upgrade to {version}?',
  'service.chooseAppDesc':
    'The app will quit and relaunch. The installed background service upgrades along with it; the database is backed up first, and the previous version is restored if the launch check fails. Save any unsent input first.',
  'service.chooseAppSigned': ' The new version is signed and verified.',
  'service.chooseAppUnsigned': ' This is a local unsigned development build.',

  // ─── 22. App Update Phases ─────────────────────────────────────────────────
  'update.preparing': 'Preparing',
  'update.backed-up': 'Backed up',
  'update.starting': 'Checking new build',
  'update.committed': 'Done',
  'update.rolled-back': 'Rolled back',
  'update.failed': 'Update failed',
  'update.waiting-for-exit': 'Waiting for the app to exit',
  'update.installing': 'Installing',
  'update.recovery-failed': 'Recovery failed',

  // ─── 23. Command Palette ───────────────────────────────────────────────────
  'palette.aria': 'Command palette',
  'palette.input': 'Jump to a conversation or run a command…',
  'palette.inputAria': 'Search commands',
  'palette.empty': 'Nothing matches that.',
  'palette.navigate': 'navigate',
  'palette.open': 'open',
  'palette.close': 'close',
  'palette.newConversationHint': 'in the active scope',
  'palette.goChat': 'Go to Chat',
  'palette.goGoals': 'Go to Goals',
  'palette.goSkills': 'Go to Skills',
  'palette.goInbox': 'Go to Inbox',
  'palette.goSettings': 'Go to Settings',
  'palette.refreshModels': 'Refresh model catalog',
  'palette.switchScope': 'switch scope',

  // ─── 24. Project Settings Dialog ───────────────────────────────────────────
  'project.settingsAria': 'Settings for {name}',
  'project.settingsTitle': '{name} settings',
  'project.autoLand': 'Auto-land finished runs',
  'project.allowInPlace':
    'Allow execution in the original directory for non-Git projects',
  'project.timeout': 'Run timeout (minutes)',
  'project.baseBranch': 'Base branch',
  'project.preamble': 'Worker instructions',
  'project.saveAria': 'Save settings for {name}',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, Message>;
