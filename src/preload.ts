import { contextBridge, ipcRenderer } from 'electron';
import { commandArgs, type CommandApi, type TianApi } from './shared/contracts';
import type { AppEvents } from './shared/types';

const commands = Object.fromEntries(
  Object.keys(commandArgs).map((command) => [
    command,
    (...args: unknown[]) => ipcRenderer.invoke('tian:invoke', command, args),
  ]),
) as CommandApi;
const events: (keyof AppEvents)[] = [
  'view',
  'conversations',
  'tasks',
  'goals',
  'notices',
  'improvements',
  'runs',
  'inbox',
  'memory',
  'skills',
  'scopes',
  'settings',
  'runtime',
];

const api: TianApi = {
  ...commands,
  desktop: ((action: string, candidateId?: string) =>
    ipcRenderer.invoke(
      'tian:desktop',
      action,
      candidateId,
    )) as TianApi['desktop'],
  on(channel, callback) {
    if (!events.includes(channel)) throw new Error(`Unknown event: ${channel}`);
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: AppEvents[typeof channel],
    ) => callback(payload);
    ipcRenderer.on(`tian:${channel}`, handler);
    return () => ipcRenderer.removeListener(`tian:${channel}`, handler);
  },
};
contextBridge.exposeInMainWorld('tian', api);
