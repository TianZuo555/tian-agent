import { expect, open, test } from 'nsh/test';

test('mobile navigation keeps drafts and messages with their conversation', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Atlas');
  await app.type('label:Message', 'Atlas draft');
  await app.press('label:Back');
  await app.press('label:Chief');
  expect(app.value('label:Message')).toBe('');
  await app.type('label:Message', 'Hello Chief');
  await app.press('label:Send');
  await app.waitFor('text:Hello Chief');
  await app.press('label:Back');
  await app.press('label:Atlas');
  expect(app.value('label:Message')).toBe('Atlas draft');
  expect(app.texts()).not.toContain('Hello Chief');
  await app.press('label:Send');
  await app.waitFor('text:Atlas draft');
});

test('rejected approval stays rejected after leaving the conversation', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Juno needs your decision');
  await app.press('label:Maintenance window');
  await app.press('label:Reject');
  await app.waitFor('text:Rejected. This action cannot be approved again.');
  await app.press('label:Back');
  await app.press('label:Juno');
  expect(app.texts()).toContain(
    'Rejected. This action cannot be approved again.',
  );
  expect(app.texts()).not.toContain('Approve');
});

test('diff files switch and review notes reach Atlas', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Atlas');
  await app.press('label:View changes');
  await app.press('label:tests/reconnect.test.ts');
  await app.type('label:Leave a review note…', 'Check the replay cursor');
  await app.press('label:Send note to Atlas');
  await app.press('label:Back');
  await app.waitFor('text:tests/reconnect.test.ts\nCheck the replay cursor');
  await app.press('label:View changes');
  app.onDialog(() => 'Land');
  await app.press('label:Land');
  await app.waitFor('text:Landed in preview');
  expect(app.texts()).not.toContain('Discard');
});

test('offline send keeps the draft and recovers after reconnect', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Settings');
  await app.press('label:Server and devices');
  await app.press('label:Offline · mac-studio');
  await app.press('label:Back');
  await app.press('label:Back');
  await app.press('label:Chief');
  await app.type('label:Message', 'Keep this offline');
  await app.waitFor('text:Offline · Nothing was sent');
  expect(app.value('label:Message')).toBe('Keep this offline');
  await app.press('label:Back');
  await app.press('label:Settings');
  await app.press('label:Server and devices');
  await app.press('label:Connected');
  await app.press('label:Back');
  await app.press('label:Back');
  await app.press('label:Chief');
  expect(app.value('label:Message')).toBe('Keep this offline');
  await app.press('label:Send');
  await app.waitFor('text:Keep this offline');
});

test('appearance and language persist and restore', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Settings');
  await app.press('label:Appearance');
  await app.press('label:Day');
  await app.press('label:Back');
  await app.press('label:General');
  await app.press('label:简体中文');
  await app.waitFor('text:通用');
  const stored = JSON.parse(app.storage()['tian.ios.preferences']);
  expect(stored.theme).toBe('day');
  expect(stored.language).toBe('zh');
  const restored = await open('./IOS.tsx', { storage: app.storage() });
  await restored.waitFor('text:下午好，Tian');
});

test('search filters Managers and handles empty results', async () => {
  const app = await open('./IOS.tsx');
  await app.type('label:Search conversations', 'd2r');
  expect(app.texts()).toContain('Vega');
  expect(app.texts()).not.toContain('Atlas');
  await app.type('label:Search conversations', 'unknown');
  await app.waitFor('text:No matching conversations.');
});

test('model selection changes only the current conversation', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Atlas');
  await app.press('label:claude-opus-4 · High');
  await app.press('label:gpt-5');
  await app.press('label:Cancel');
  await app.waitFor('text:gpt-5 · High');
  await app.press('label:Back');
  await app.press('label:Chief');
  expect(app.texts()).toContain('claude-opus-4 · High');
});

test('picked image stays in a draft until explicitly sent', async () => {
  const app = await open('./IOS.tsx');
  app.onPick(() => [
    {
      name: 'capture.png',
      type: 'image/png',
      data: new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
        1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65,
        84, 120, 156, 99, 0, 2, 0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73,
        69, 78, 68, 174, 66, 96, 130,
      ]),
    },
  ]);
  await app.press('label:Chief');
  await app.press('label:Attach image');
  await app.waitFor('label:Remove attachment');
  expect(app.picks()[0].maxDimension).toBe(2560);
  await app.press('label:Send');
  await app.waitFor('text:Saved locally in this preview.');
  expect(app.texts()).not.toContain('Remove attachment');
});

test('share cancellation returns to home without attaching an image', async () => {
  const app = await open('./IOS.tsx');
  await app.press('label:Send to Tian');
  await app.waitFor('text:SEND TO');
  await app.press('label:Choose image');
  await app.press('label:Cancel');
  await app.press('label:Chief');
  expect(app.texts()).not.toContain('Remove attachment');
});
