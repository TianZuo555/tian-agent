import { expect, open as openApp, test } from 'nsh/test';

const open = (entry: string) => openApp(entry, { width: 1336, height: 812 });

test('conversations switch with their own header and thread', async () => {
  const app = await open('./App.tsx');
  await app.press('label:Atlas 对话');
  await app.waitFor('text:Chief 委派 · 10:25');
  await app.waitFor(
    'text:Manager · tian-agent · claude-sonnet-4 · 2 个 Worker',
  );
  expect(app.texts()).toContain('Atlas');
  await app.press('label:Juno 对话');
  await app.waitFor('text:healthapp 数据库迁移方式');
  expect(app.texts()).toContain('在线迁移');
});

test('settings pages switch inside the overlay', async () => {
  const app = await open('./App.tsx');
  await app.press('label:设置');
  await app.waitFor('text:只影响这台设备。');
  await app.press('label:减少动效');
  await app.press('label:截图');
  await app.waitFor('text:框选区域发给 Tian');
  await app.press('label:通知');
  await app.waitFor('text:只在需要你的时候打扰你。');
});

test('the composer appends a message', async () => {
  const app = await open('./App.tsx');
  await app.type('label:消息', '你好，Chief');
  await app.press('label:发送');
  await app.waitFor('text:你好，Chief');
  expect(app.texts()).toContain('现在 · 这台 Mac');
});

test('the palette lists conversations and commands', async () => {
  const app = await open('./App.tsx');
  await app.press('label:搜索或跳转');
  await app.waitFor('text:切换检查器');
  expect(app.texts()).toContain('Atlas · tian-agent');
});
