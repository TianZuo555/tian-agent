// A real resident service with model-free transcripts for NSH development.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { ResidentServer } from '../src/service/server';
import { servicePaths } from '../src/shared/service-paths';

const root = mkdtempSync('/tmp/tian-nsh-');
const paths = {
  ...servicePaths(join(root, 'data')),
  socketPath: join(root, 'agent.sock'),
};
const server = new ResidentServer(paths);
await server.start();
const first = await server.service.createConversation('global');
server.service.db.setConversationTitle(
  first.conversationId,
  'Native shell preview',
);
const second = await server.service.createConversation('global');
server.service.db.setConversationTitle(
  second.conversationId,
  'Second conversation',
);
const agents = (
  server.service as unknown as {
    agents: { conversation(id: string): Promise<Conversation> };
  }
).agents;
const transcript = await agents.conversation(first.conversationId);
async function append(text: string) {
  await transcript.commit(
    (tx) =>
      tx.appendEntry(transcript.id, {
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [{ type: 'text', text }],
            api: 'openai-completions',
            provider: 'magpie',
            model: 'fixture',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        ],
      }),
    BACKGROUND_CONTEXT,
  );
}
await append(
  '## Native shell preview\n\nThis transcript comes from the resident service.\n\n中文消息。\n\n```ts\nconst answer = 42;\n```',
);
let updates = 0;
let appending = false;
const timer = setInterval(() => {
  if (appending || updates >= 1000) return;
  appending = true;
  void append(`Live update ${++updates}`)
    .catch(console.error)
    .finally(() => {
      appending = false;
    });
}, 3000);
const environment = {
  TIAN_AGENT_DATA_DIR: paths.dataDir,
  TIAN_AGENT_SOCKET_PATH: paths.socketPath,
};
writeFileSync(join(root, 'env.json'), JSON.stringify(environment));
console.log(
  JSON.stringify({
    root,
    ...environment,
    pid: process.pid,
    conversations: [first.conversationId, second.conversationId],
  }),
);
console.log(
  `TIAN_AGENT_DATA_DIR='${paths.dataDir}' TIAN_AGENT_SOCKET_PATH='${paths.socketPath}' nsh run crates/tian-nsh --target macos`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  while (appending) await new Promise((resolve) => setTimeout(resolve, 10));
  await server.close();
  rmSync(root, { recursive: true, force: true });
}
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
