import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { ServiceClient } from './service/client.js';
import { servicePaths } from './shared/service-paths.js';
import { startService } from './service/launchd.js';
import { validateCommand } from './shared/contracts.js';
import type { Emit } from './shared/types.js';

const primaryInstance = !started && app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.commandLine.appendSwitch('force-renderer-accessibility');
let runtime: ServiceClient | null = null;

const broadcast: Emit = (channel, payload, clientId) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (
      !window.webContents.isDestroyed() &&
      (clientId === undefined || window.webContents.id === clientId)
    ) {
      window.webContents.send(`tian:${channel}`, payload);
    }
  }
};

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Tian Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  const clientId = window.webContents.id;
  window.webContents.once('destroyed', () => runtime?.releaseClient(clientId));
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
}

if (primaryInstance)
  void app
    .whenReady()
    .then(() => {
      const paths = servicePaths();
      runtime = new ServiceClient(paths.socketPath, broadcast);
      if (process.platform === 'darwin')
        void startService({ paths }).catch(console.error);
      ipcMain.handle(
        'tian:invoke',
        async (event, command: unknown, args: unknown) => {
          if (
            event.senderFrame !== event.sender.mainFrame ||
            !BrowserWindow.fromWebContents(event.sender)
          )
            throw new Error('Untrusted IPC sender');
          validateCommand(command, args);
          if (command === 'pickDir') {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
            });
            return result.canceled ? null : result.filePaths[0];
          }
          return runtime!.invoke(command, args as never, event.sender.id);
        },
      );
      void runtime.start().catch(console.error);
      createWindow();
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow();
      });
    })
    .catch((error) => {
      console.error(error);
      app.quit();
    });

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) createWindow();
  else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  runtime?.close();
});
