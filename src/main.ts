import { app, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { DesktopController } from './desktop/controller.js';
import {
  desktopActions,
  themeNames,
  type DesktopAction,
  type ThemeName,
} from './shared/desktop.js';
import { servicePaths } from './shared/service-paths.js';
import { validateCommand } from './shared/contracts.js';
import { mkdirSync } from 'node:fs';
import type { Emit } from './shared/types.js';

if (process.env.TIAN_AGENT_DATA_DIR) {
  const directory = servicePaths().dataDir;
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}
const primaryInstance = !started && app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.commandLine.appendSwitch('force-renderer-accessibility');
if (!app.isPackaged)
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
let runtime: DesktopController | null = null;

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
  const isMac = process.platform === 'darwin';
  const window = new BrowserWindow({
    show: process.env.TIAN_AGENT_SHOW_WINDOW !== '0',
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    title: 'Tian Agent',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: isMac
      ? '#00000000'
      : nativeTheme.shouldUseDarkColors
        ? '#171719'
        : '#fbfbfc',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The dev server reloads its own page after re-optimizing dependencies, so
  // only navigations that leave the application are blocked.
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !MAIN_WINDOW_VITE_DEV_SERVER_URL ||
      new URL(url).origin !== new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
    )
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
      const jobIndex = process.argv.indexOf('--tian-update-job');
      runtime = new DesktopController(
        {
          paths,
          label: process.env.TIAN_AGENT_SERVICE_LABEL,
          payloadDirectory: app.isPackaged
            ? path.join(process.resourcesPath, 'service')
            : path.join(app.getAppPath(), 'dist/service'),
          updaterDirectory: app.isPackaged
            ? path.join(process.resourcesPath, 'updater')
            : path.join(app.getAppPath(), 'dist/updater'),
          appBundle:
            app.isPackaged && process.platform === 'darwin'
              ? path.dirname(path.dirname(path.dirname(app.getPath('exe'))))
              : null,
          appVersion: app.getVersion(),
          pid: process.pid,
          updateJob: jobIndex >= 0 ? process.argv[jobIndex + 1] : undefined,
          chooseApp: async () => {
            const result = await dialog.showOpenDialog({
              title: 'Choose a newer Tian Agent application',
              properties: ['openFile'],
              filters: [{ name: 'macOS application', extensions: ['app'] }],
            });
            return result.canceled ? null : (result.filePaths[0] ?? null);
          },
          quit: () => app.quit(),
        },
        broadcast,
      );
      ipcMain.handle(
        'tian:desktop',
        async (event, action: unknown, candidateId: unknown) => {
          if (
            event.senderFrame !== event.sender.mainFrame ||
            !BrowserWindow.fromWebContents(event.sender)
          )
            throw new Error('Untrusted IPC sender');
          if (
            typeof action !== 'string' ||
            !desktopActions.includes(action as DesktopAction)
          )
            throw new Error('Invalid desktop action');
          const needsId = action === 'apply-app' || action === 'cancel-app';
          if (
            needsId
              ? typeof candidateId !== 'string' ||
                !/^[a-f0-9-]{36}$/.test(candidateId)
              : candidateId !== undefined
          )
            throw new Error('Invalid desktop action arguments');
          return runtime!
            .action(action as DesktopAction, candidateId as string | undefined)
            .catch((error) => {
              console.error('Desktop action failed:', action, error);
              throw error;
            });
        },
      );
      // The renderer's theme choice steers the native appearance so vibrancy
      // and the window backing match the app's surfaces, not just the OS.
      ipcMain.on('tian:theme', (event, theme: unknown) => {
        if (
          event.senderFrame !== event.sender.mainFrame ||
          !BrowserWindow.fromWebContents(event.sender) ||
          !themeNames.includes(theme as ThemeName)
        )
          return;
        nativeTheme.themeSource = theme as ThemeName;
      });
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
      void runtime.initialize().catch(console.error);
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
