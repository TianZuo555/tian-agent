import type { ServiceInfo } from './types';
export interface ServiceActivity {
  tasks: number;
  submissions: number;
  runs: number;
  reviews: number;
  maintenance: boolean;
}
export interface AppCandidate {
  id: string;
  version: string;
  serviceVersion: string;
  signed: boolean;
}
export interface DesktopStatus {
  appVersion: string;
  bundledServiceVersion: string;
  connected: boolean;
  connectOnLaunch: boolean;
  installed: boolean;
  legacyService: boolean;
  legacyRunning: boolean;
  loginEnabled: boolean;
  service: ServiceInfo | null;
  activity: ServiceActivity | null;
  canUpdateApp: boolean;
  lastUpdate: { phase: string; message?: string } | null;
}
export const desktopActions = [
  'status',
  'connect',
  'disconnect',
  'start',
  'stop',
  'install',
  'login-enable',
  'login-disable',
  'recover',
  'choose-app',
  'apply-app',
  'cancel-app',
  'ready',
] as const;
export type DesktopAction = (typeof desktopActions)[number];
export interface DesktopApi {
  desktop(action: 'choose-app'): Promise<AppCandidate | null>;
  desktop(
    action: Exclude<DesktopAction, 'choose-app' | 'apply-app' | 'cancel-app'>,
  ): Promise<DesktopStatus>;
  desktop(
    action: 'apply-app' | 'cancel-app',
    candidateId: string,
  ): Promise<DesktopStatus>;
}
