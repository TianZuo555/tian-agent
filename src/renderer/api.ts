import type { TianApi } from '../shared/contracts';

declare global {
  interface Window {
    tian: TianApi;
  }
}
export const tian: TianApi = window.tian;
