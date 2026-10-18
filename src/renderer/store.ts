import { useSyncExternalStore } from 'react';
import { tian } from './api';
import { createAppStore, type State } from './state';

const store = createAppStore(tian);
export const actions = store.actions;
export const getState = store.getState;
export function useStore<T>(pick: (state: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.getState()));
}
