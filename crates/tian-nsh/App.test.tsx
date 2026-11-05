import { expect, open, test } from 'nsh/test';

test('native shell reads the real service and receives transcript updates', async () => {
  const app = await open('./App.tsx', {
    width: 1280,
    height: 840,
    platform: 'macos',
  });
  await app.waitFor('text:Service connected');
  await app.press('label:Conversation: Native shell preview');
  await app.waitFor('text:This transcript comes from the resident service.');
  const updates = () =>
    app.texts().filter((text) => /^Live update \d+$/.test(text)).length;
  const before = updates();
  await app.waitUntil(() => updates() > before);
  await app.press('id:nav-goals');
  expect(app.texts()).toContain(
    'This view is planned for a later migration phase.',
  );
  await app.press('id:nav-settings');
  await app.press('text:中文');
  expect(app.texts()).toContain('此视图将在后续迁移阶段提供。');
  await app.press('text:返回');
  await app.press('id:nav-chat');
  await app.press('text:Second conversation');
  expect(app.texts()).not.toContain(
    'This transcript comes from the resident service.',
  );
});
