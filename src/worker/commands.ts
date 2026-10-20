import type { Service } from './service.js';
import type { Handlers } from '../shared/contracts.js';

/** One command implementation shared by every transport and channel adapter. */
export const commandHandlers = (service: Service, clientId: number) =>
  ({
    getActivity: () => service.activity(),
    beginMaintenance: () => service.beginMaintenance(),
    finishMaintenance: () => service.finishMaintenance(),
    listScopes: () => service.listScopes(),
    addProject: (name, rootPath, managerName) =>
      service.addProject(name, rootPath, managerName),
    updateProject: (id, patch) => service.updateProject(id, patch),
    removeProject: (id) => service.removeProject(id),
    listConversations: () => service.listConversations(),
    createConversation: (scopeId) => service.createConversation(scopeId),
    archiveConversation: (id, archived) =>
      service.archiveConversation(id, archived),
    openSession: (binding) => service.openSession(binding),
    openManager: (projectId) => service.openManager(projectId),
    submit: (id, text, requestId) => service.submit(id, text, requestId),
    abort: (id) => service.abort(id),
    watch: (id) => service.watch(id, clientId),
    unwatch: (id) => service.unwatch(id, clientId),
    listTasks: (scopeId) => service.taskList(scopeId),
    addTask: (scopeId, title, due) => service.addTaskItem(scopeId, title, due),
    doneTask: (id, done) => service.doneTaskItem(id, done),
    listGoals: (scopeId) => service.goalList(scopeId),
    createGoal: (
      scopeId,
      objective,
      successCriteria,
      constraints,
      maxRunsPerDay,
    ) =>
      service.createGoal(
        scopeId,
        objective,
        successCriteria,
        constraints,
        maxRunsPerDay,
      ),
    updateGoal: (goalId, patch) => service.updateGoal(goalId, patch),
    setGoalStatus: (goalId, status) => service.setGoalStatus(goalId, status),
    runGoalNow: (goalId) => service.runGoalNow(goalId),
    addSchedule: (goalId, cron, timezone) =>
      service.addSchedule(goalId, cron, timezone),
    removeSchedule: (scheduleId) => service.removeSchedule(scheduleId),
    listNotices: (scopeId) => service.noticeList(scopeId),
    listImprovements: (scopeId) => service.improvementList(scopeId),
    getImprovement: (id) => service.getImprovementItem(id),
    addImprovement: (scopeId, kind, summary, detail, severity) =>
      service.addImprovementItem(scopeId, kind, summary, detail, severity),
    setImprovementStatus: (id, status) =>
      service.setImprovementStatusItem(id, status),
    promoteImprovement: (id) => service.promoteImprovementItem(id),
    reportClientIssue: (summary, detail) =>
      service.reportClientIssue(summary, detail),
    memoryDump: (scopeId) => service.memoryDump(scopeId),
    memoryRevise: (scopeId, seq, text, reason) =>
      service.memoryRevise(scopeId, seq, text, reason),
    memoryForget: (scopeId, seq, reason) =>
      service.memoryForget(scopeId, seq, reason),
    memoryPromote: (scopeId, seq) => service.memoryPromote(scopeId, seq),
    memoryDismiss: (scopeId, seq) => service.memoryDismiss(scopeId, seq),
    memorySelect: (scopeId, seq) => service.memorySelect(scopeId, seq),
    memoryDeselect: (scopeId, seq) => service.memoryDeselect(scopeId, seq),
    inboxList: (scopeId) => service.inboxList(scopeId),
    runList: (scopeId) => service.runList(scopeId),
    runReport: (id) => service.runReport(id),
    runDiff: (id) => service.runDiff(id),
    followUpRun: (id, prompt) => service.followUpRun(id, prompt),
    stopRun: (id) => service.stopRun(id),
    landRun: (id) => service.landRun(id),
    discardRun: (id) => service.discardRun(id),
    shipRun: (id) => service.shipRun(id),
    skillList: (scopeId) => service.skillList(scopeId),
    skillHistory: (scopeId, name) => service.skillHistory(scopeId, name),
    skillApprove: (skillId) => service.skillApprove(skillId),
    skillRetire: (skillId, reason) => service.skillRetire(skillId, reason),
    skillRollback: (skillId, reason) => service.skillRollback(skillId, reason),
    getSettings: () => service.getSettings(),
    setModel: (model) => service.setModel(model),
    modelCatalog: () => service.getModelCatalog(),
    refreshModels: () => service.refreshModels(),
    usageStats: (scopeId) => service.usageStats(scopeId),
  }) satisfies Handlers;
