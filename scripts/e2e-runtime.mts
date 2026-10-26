// Validate the packaged renderer/preload against a standalone Node service.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ServiceClient } from '../src/service/client.js';

const require = createRequire(import.meta.url);
const electron = require('electron') as string;
const archive = resolve(
  `out/Tian Agent-darwin-${process.arch}/Tian Agent.app/Contents/Resources/app.asar`,
);
const packagedPayload = resolve(
  `out/Tian Agent-darwin-${process.arch}/Tian Agent.app/Contents/Resources/service`,
);
if (!existsSync(archive) || !existsSync(join(packagedPayload, 'service.cjs')))
  throw new Error('Run pnpm package first');
const temporary = mkdtempSync('/tmp/tian-runtime-');
const data = join(temporary, 'data');
const socket = join(temporary, 'agent.sock');
const memory = join(data, 'scopes/global/memory');
mkdirSync(memory, { recursive: true });
writeFileSync(
  join(memory, 'LOG.txt'),
  '2026-01-01 00:00 Persistent memory from disk\n',
);
// An inbox message with a code block and a mermaid diagram: delivered as a
// system notification, it must render under the packaged Content-Security-Policy.
const inbox = join(data, 'scopes/global/.tian/inbox');
mkdirSync(inbox, { recursive: true });
const notice = [
  '---',
  'from: external',
  'to: ',
  'ts: 2026-01-01T00:00:00.000Z',
  'thread: ',
  'id: notice-1',
  '---',
  '',
  'Arrived with a code block and a diagram.',
  '',
  '```ts',
  'export const answer: number = 42;',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Inbox] --> B[Chat]',
  '```',
  '',
].join('\n');
// Forge packages these same files. Run the copy with plain Node from outside the checkout.
cpSync(packagedPayload, join(temporary, 'bundle'), { recursive: true });
let daemon: ChildProcess | null = null;
let client: ServiceClient | null = null;
async function startDaemon() {
  daemon = spawn(
    join(temporary, 'bundle/runtime/node'),
    [join(temporary, 'bundle/service.cjs'), '--data-dir', data],
    {
      cwd: temporary,
      env: { ...process.env, TIAN_AGENT_SOCKET_PATH: socket },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  daemon.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  client = new ServiceClient(socket, undefined, { readyTimeoutMs: 15_000 });
  return client.start();
}
async function stopDaemon() {
  client?.close();
  const processToStop = daemon;
  if (!processToStop || processToStop.exitCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => {
      processToStop.kill('SIGKILL');
      reject(new Error('Service shutdown timed out'));
    }, 15_000);
    processToStop.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) done();
      else reject(new Error(`Service exited ${code}`));
    });
    processToStop.kill('SIGTERM');
  });
  daemon = null;
}
const host = join(temporary, 'host.cjs');
writeFileSync(
  host,
  String.raw`
const { app, BrowserWindow, ipcMain } = require('electron');
const { createConnection } = require('node:net');
const assert = require('node:assert/strict');
const [preloadPath, rendererPath, socketPath, userData] = process.argv.slice(2);
app.setPath('userData', userData);
app.commandLine.appendSwitch('disable-gpu');
let window;
let sequence = 0;
const pending = new Map();
const connection = createConnection(socketPath);
connection.setEncoding('utf8');
let buffer = '';
const ready = new Promise((resolve, reject) => {
  connection.on('error', reject);
  connection.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      if (message.type === 'ready') resolve();
      else if (message.type === 'result') {
        const request = pending.get(message.id);
        if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.value); }
      } else if (message.type === 'event' && window && !window.isDestroyed() && (message.clientId === undefined || message.clientId === window.webContents.id)) {
        window.webContents.send('tian:' + message.channel, message.payload);
      }
    }
  });
});
function rpc(command, args, clientId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error('RPC timeout: ' + command)), 10000);
    pending.set(id, { resolve, reject, timer });
    connection.write(JSON.stringify({ type: 'request', id, command, args, clientId }) + '\n');
  });
}
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  await ready;
  ipcMain.handle('tian:invoke', (event, command, args) => rpc(command, args, event.sender.id));
  ipcMain.handle('tian:desktop', (_event, action) => { if(action === 'ready') return null; throw new Error('Desktop controls are covered by test:app-upgrade'); });
  const errors = [];
  const cspViolations = [];
  window = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(String(error)));
  window.webContents.on('console-message', (...args) => {
    const detail = args.find((a) => a && typeof a === 'object' && typeof a.message === 'string');
    const message = detail ? detail.message : args.filter((a) => typeof a === 'string').join(' ');
    if (/content security policy/i.test(message)) cspViolations.push(message);
  });
  await window.loadFile(rendererPath);
  await window.webContents.executeJavaScript("window.__cspViolations = []; window.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI)); true");
  assert.equal(await window.webContents.executeJavaScript('typeof window.tian.openSession'), 'function');
  assert.equal((await window.webContents.executeJavaScript('window.tian.listTasks("global")'))[0].title, 'Persistent task');
  assert.match((await window.webContents.executeJavaScript('window.tian.memoryDump("global")')).items[0].content, /Persistent memory/);
  const deadline = Date.now() + 10000;
  while (!await window.webContents.executeJavaScript('!!document.querySelector("aside[aria-label]")')) {
    if (Date.now() > deadline) throw new Error(await window.webContents.executeJavaScript('document.body.innerText'));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // Open the conversation the inbox notice was delivered to, through the UI.
  assert.equal(await window.webContents.executeJavaScript("(() => { const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Conversation: CSP notice target'); if (b) { b.click(); return true; } return false; })()"), true);
  const renderDeadline = Date.now() + 20000;
  for (;;) {
    const rendered = await window.webContents.executeJavaScript("({ code: !!document.querySelector('[data-tian-prose] [data-streamdown=code-block]'), mermaid: !!document.querySelector('[data-tian-prose] svg') })");
    if (rendered.code && rendered.mermaid) break;
    if (Date.now() > renderDeadline) throw new Error('notice did not render: ' + JSON.stringify(rendered) + ' in ' + await window.webContents.executeJavaScript('document.body.innerText'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const conversation = await window.webContents.executeJavaScript('window.tian.createConversation("global")');
  assert.equal(typeof conversation.createdAt, 'string');
  assert.deepEqual(errors, []);
  assert.deepEqual(cspViolations, []);
  assert.deepEqual(await window.webContents.executeJavaScript('window.__cspViolations'), []);
  window.destroy();
  connection.end();
  console.log('Packaged sandbox preload and renderer connected to standalone service: PASS');
  app.quit();
}).catch((error) => { console.error(error); connection.destroy(); app.exit(1); });
`,
);
try {
  const first = await startDaemon();
  await client!.invoke('addTask', ['global', 'Persistent task', null]);
  // The notice targets the latest global conversation: title it so the UI
  // pass can find its sidebar row, then drop the file and wait for delivery.
  const target = await client!.invoke('createConversation', ['global']);
  await client!.invoke('submit', [target.conversationId, 'CSP notice target']);
  writeFileSync(join(inbox, 'notice-1.md'), notice);
  await new Promise<void>((resolveDelivery, rejectDelivery) => {
    const timeout = setTimeout(
      () => rejectDelivery(new Error('inbox notice was not delivered')),
      15_000,
    );
    const watcher = new ServiceClient(
      socket,
      (channel, payload) => {
        const view = payload as { conversationId?: string };
        if (
          channel === 'view' &&
          view.conversationId === target.conversationId &&
          JSON.stringify(payload).includes('notice-1')
        ) {
          clearTimeout(timeout);
          watcher.close();
          resolveDelivery();
        }
      },
      { readyTimeoutMs: 5_000 },
    );
    watcher
      .start()
      .then(() => watcher.invoke('watch', [target.conversationId]))
      .catch(rejectDelivery);
  });
  const session = await client!.invoke('openSession', [
    { channel: 'telegram', externalId: 'smoke', scopeId: 'global' },
  ]);
  const exitCode = await new Promise<number | null>((done, reject) => {
    const child = spawn(
      electron,
      [
        host,
        join(archive, '.vite/build/preload.cjs'),
        join(archive, '.vite/renderer/main_window/index.html'),
        socket,
        join(temporary, 'electron'),
      ],
      { stdio: 'inherit' },
    );
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Electron smoke timed out'));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      done(code);
    });
  });
  assert.equal(exitCode, 0);
  assert.equal(client!.info!.pid, first.pid);
  assert.equal(
    (await client!.invoke('listTasks', ['global']))[0].title,
    'Persistent task',
  );
  await stopDaemon();
  await startDaemon();
  assert.equal(
    (
      await client!.invoke('openSession', [
        { channel: 'telegram', externalId: 'smoke', scopeId: 'global' },
      ])
    ).conversationId,
    session.conversationId,
  );
  console.log(
    'App exit leaves the service running; service restart preserves sessions and memory: PASS',
  );
} finally {
  await stopDaemon();
  rmSync(temporary, { recursive: true, force: true });
}
