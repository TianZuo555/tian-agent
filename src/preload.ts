import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_EVENT_CHANNELS,
  commandArgs,
  type CommandApi,
  type TianApi,
} from './shared/contracts';
import type { AppEvents } from './shared/types';

const commands = Object.fromEntries(
  Object.keys(commandArgs).map((command) => [
    command,
    (...args: unknown[]) => ipcRenderer.invoke('tian:invoke', command, args),
  ]),
) as CommandApi;
const events = APP_EVENT_CHANNELS;

const api: TianApi = {
  ...commands,
  desktop: ((action: string, candidateId?: string) =>
    ipcRenderer.invoke(
      'tian:desktop',
      action,
      candidateId,
    )) as TianApi['desktop'],
  setTheme(theme) {
    ipcRenderer.send('tian:theme', theme);
  },
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
