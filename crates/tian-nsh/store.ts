import type {
  AppEvents,
  ChatSnapshot,
  ConversationInfo,
  ScopeInfo,
} from '../../src/shared/types';
import { createServiceClient, type Connection } from './service-client';

export type Nav = 'chat' | 'goals' | 'skills' | 'inbox' | 'settings';
export interface State {
  nav: Nav;
  returnNav: Nav;
  conversations: ConversationInfo[];
  scopes: ScopeInfo[];
  selected: string | null;
  scopeId: string;
  view: ChatSnapshot | null;
  status: AppEvents['runtime']['status'];
  error: string | null;
}
export const initialState = (): State => ({
  nav: 'chat',
  returnNav: 'chat',
  conversations: [],
  scopes: [],
  selected: null,
  scopeId: 'global',
  view: null,
  status: 'starting',
  error: null,
});

/** Store is independent of the rendering runtime so race conditions can be tested. */
export function createStore(
  connect: () => Promise<Connection>,
  get: () => State,
  set: (value: State) => void,
) {
  const patch = (value: Partial<State>) => set({ ...get(), ...value });
  let generation = 0;
  let listVersion = 0;
  let scopeVersion = 0;
  let watched: string | null = null;
  let watchQueue = Promise.resolve();
  let disposed = false;
  const client = createServiceClient(connect, (channel, payload) => {
    if (disposed) return;
    if (channel === 'runtime') {
      const runtime = payload as AppEvents['runtime'];
      generation++;
      watched = null;
      patch({
        status: runtime.status,
        error: runtime.error ?? null,
        view: null,
      });
      if (runtime.status === 'ready') void refresh().catch(fail);
    } else if (channel === 'conversations') {
      listVersion++;
      patch({ conversations: payload as ConversationInfo[] });
    } else if (channel === 'scopes') {
      scopeVersion++;
      patch({ scopes: payload as ScopeInfo[] });
    } else if (channel === 'view') {
      const view = payload as AppEvents['view'];
      if (view.conversationId === get().selected) patch({ view: view.view });
    }
  });
  function fail(error: unknown) {
    if (!disposed) patch({ error: String(error) });
  }
  async function syncWatch() {
    const epoch = generation;
    watchQueue = watchQueue
      .catch(() => {})
      .then(async () => {
        if (disposed || epoch !== generation) return;
        const selected = get().selected;
        if (watched && watched !== selected) {
          const previous = watched;
          watched = null;
          await client.invoke('unwatch', [previous]);
        }
        if (disposed || epoch !== generation || selected !== get().selected)
          return;
        if (selected && watched !== selected) {
          await client.invoke('watch', [selected]);
          if (epoch === generation) watched = selected;
        }
      });
    await watchQueue;
  }
  async function refresh() {
    const epoch = generation;
    const conversationsAt = ++listVersion;
    const scopesAt = ++scopeVersion;
    await Promise.all([
      client.invoke('listConversations', []).then((conversations) => {
        if (
          !disposed &&
          epoch === generation &&
          conversationsAt === listVersion
        )
          patch({ conversations });
      }),
      client.invoke('listScopes', []).then((scopes) => {
        if (!disposed && epoch === generation && scopesAt === scopeVersion)
          patch({ scopes });
      }),
    ]);
    if (disposed || epoch !== generation) return;
    if (!get().selected) {
      const first = get().conversations.find(
        (conversation) => !conversation.archivedAt,
      );
      if (first)
        patch({ selected: first.conversationId, scopeId: first.scopeId });
    }
    await syncWatch();
  }
  return {
    client,
    start: () => client.start(),
    select(id: string, scopeId: string) {
      patch({ selected: id, scopeId, nav: 'chat', view: null, error: null });
      void syncWatch().catch(fail);
    },
    navigate(nav: Nav) {
      patch({ nav, returnNav: nav === 'settings' ? get().nav : nav });
    },
    closeSettings() {
      patch({ nav: get().returnNav });
    },
    close() {
      disposed = true;
      generation++;
      client.close();
    },
  };
}
