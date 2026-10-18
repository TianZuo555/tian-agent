import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { Service } from './worker/service.js';

if (started) {
  app.quit();
}

app.commandLine.appendSwitch('force-renderer-accessibility');

let service: Service | null = null;
let mainWindow: BrowserWindow | null = null;

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`tian:${channel}`, payload);
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Tian Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const invoke = <T extends unknown[]>(
  channel: string,
  fn: (...args: T) => unknown,
) => {
  ipcMain.handle(`tian:${channel}`, async (_e, ...args) => fn(...(args as T)));
};

app.whenReady().then(async () => {
  service = new Service(app.getPath('userData'), broadcast);
  await service.init();

  const svc = service;
  invoke('scopes:list', () => svc.listScopes());
  invoke('project:add', (name: string, rootPath: string) =>
    svc.addProject(name, rootPath),
  );
  invoke('project:update', (id: string, patch: Record<string, unknown>) =>
    svc.updateProject(id, patch),
  );
  invoke('project:remove', (id: string) => svc.removeProject(id));
  invoke('dialog:pick-dir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  invoke('conv:list', () => svc.listConversations());
  invoke('conv:create', (scopeId: string) => svc.createConversation(scopeId));
  invoke('conv:submit', (id: string, text: string) => svc.submit(id, text));
  invoke('conv:abort', (id: string) => svc.abort(id));
  invoke('conv:watch', (id: string) => svc.watch(id));
  invoke('conv:unwatch', (id: string) => svc.unwatch(id));

  invoke('task:list', (scopeId: string | null) =>
    svc.taskList(scopeId ?? null),
  );
  invoke('task:add', (scopeId: string, title: string, due: string | null) =>
    svc.addTaskItem(scopeId, title, due),
  );
  invoke('task:done', (id: number, done: boolean) =>
    svc.doneTaskItem(id, done),
  );
  invoke('memory:dump', (scopeId: string) => svc.memoryDump(scopeId));
  invoke('inbox:list', (scopeId: string) => svc.inboxList(scopeId));
  invoke('run:list', (scopeId: string | null) => svc.runList(scopeId ?? null));
  invoke('run:report', (id: string) => svc.runReport(id));
  invoke('run:diff', (id: string) => svc.runDiff(id));
  invoke('run:followup', (id: string, prompt: string) =>
    svc.followUpRun(id, prompt),
  );
  invoke('run:land', (id: string) => svc.landRun(id));
  invoke('run:discard', (id: string) => svc.discardRun(id));
  invoke('run:ship', (id: string) => svc.shipRun(id));

  invoke('settings:get', () => svc.getSettings());
  invoke('settings:model', (model: { provider: string; modelId: string }) =>
    svc.setModel(model),
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void service?.close();
});
