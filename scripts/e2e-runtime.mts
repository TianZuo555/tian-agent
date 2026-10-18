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
  window = new BrowserWindow({ show: false, webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(String(error)));
  await window.loadFile(rendererPath);
  assert.equal(await window.webContents.executeJavaScript('typeof window.tian.openSession'), 'function');
  assert.equal((await window.webContents.executeJavaScript('window.tian.listTasks("global")'))[0].title, 'Persistent task');
  assert.match((await window.webContents.executeJavaScript('window.tian.memoryDump("global")')).lines[0], /Persistent memory/);
  const conversation = await window.webContents.executeJavaScript('window.tian.createConversation("global")');
  assert.equal(typeof conversation.createdAt, 'string');
  const deadline = Date.now() + 10000;
  while (!await window.webContents.executeJavaScript('!!document.querySelector("aside[aria-label]")')) {
    if (Date.now() > deadline) throw new Error(await window.webContents.executeJavaScript('document.body.innerText'));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(errors, []);
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
