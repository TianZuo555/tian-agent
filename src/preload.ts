import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`tian:${channel}`, ...args);

const api = {
  listScopes: () => invoke('scopes:list'),
  addProject: (name: string, rootPath: string) =>
    invoke('project:add', name, rootPath),
  updateProject: (id: string, patch: Record<string, unknown>) =>
    invoke('project:update', id, patch),
  removeProject: (id: string) => invoke('project:remove', id),
  pickDir: () => invoke('dialog:pick-dir'),

  listConversations: () => invoke('conv:list'),
  createConversation: (scopeId: string) => invoke('conv:create', scopeId),
  submit: (conversationId: string, text: string) =>
    invoke('conv:submit', conversationId, text),
  abort: (conversationId: string) => invoke('conv:abort', conversationId),
  watch: (conversationId: string) => invoke('conv:watch', conversationId),
  unwatch: (conversationId: string) => invoke('conv:unwatch', conversationId),

  listTasks: (scopeId: string | null) => invoke('task:list', scopeId),
  addTask: (scopeId: string, title: string, due: string | null) =>
    invoke('task:add', scopeId, title, due),
  doneTask: (id: number, done: boolean) => invoke('task:done', id, done),
  memoryDump: (scopeId: string) => invoke('memory:dump', scopeId),
  inboxList: (scopeId: string) => invoke('inbox:list', scopeId),
  runList: (scopeId: string | null) => invoke('run:list', scopeId),
  runReport: (id: string) => invoke('run:report', id),
  runDiff: (id: string) => invoke('run:diff', id),
  followUpRun: (id: string, prompt: string) =>
    invoke('run:followup', id, prompt),
  landRun: (id: string) => invoke('run:land', id),
  discardRun: (id: string) => invoke('run:discard', id),
  shipRun: (id: string) => invoke('run:ship', id),

  getSettings: () => invoke('settings:get'),
  setModel: (model: { provider: string; modelId: string }) =>
    invoke('settings:model', model),

  onView: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on('tian:view', handler);
    return () => ipcRenderer.removeListener('tian:view', handler);
  },
  onConversations: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on('tian:conversations', handler);
    return () => ipcRenderer.removeListener('tian:conversations', handler);
  },
  onTasks: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on('tian:tasks', handler);
    return () => ipcRenderer.removeListener('tian:tasks', handler);
  },
  onRuns: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on('tian:runs', handler);
    return () => ipcRenderer.removeListener('tian:runs', handler);
  },
  onInbox: (cb: (payload: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on('tian:inbox', handler);
    return () => ipcRenderer.removeListener('tian:inbox', handler);
  },
};

export type TianApi = typeof api;
contextBridge.exposeInMainWorld('tian', api);
