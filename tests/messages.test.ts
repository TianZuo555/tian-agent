import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  noticeParts,
  toRows,
  type ConversationView,
} from '../src/shared/messages';

function view(entries: ConversationView['entries']): ConversationView {
  return { entries, docs: {} };
}

test('notifications become notice rows so their markdown is rendered', () => {
  const { rows } = toRows(
    view([
      {
        id: 1,
        kind: 'system.notification',
        model: [{ role: 'user', content: '**done**' }],
      },
      {
        id: 2,
        kind: 'worker.input',
        model: [{ role: 'user', content: '- a\n- b' }],
      },
      { id: 3, kind: 'tian.unanswered', data: 'Model did not respond.' },
    ]),
  );
  assert.deepEqual(
    rows.map((row) => [row.role, row.variant, row.text]),
    [
      ['system', 'notice', '**done**'],
      ['system', 'notice', '- a\n- b'],
      ['system', 'notice', 'Model did not respond.'],
    ],
  );
});

test('transcript markers stay plain separators', () => {
  const { rows } = toRows(
    view([
      { id: 1, kind: 'pi.reset' },
      { id: 2, kind: 'pi.compaction' },
    ]),
  );
  assert.deepEqual(
    rows.map((row) => [row.role, row.variant]),
    [
      ['system', undefined],
      ['system', undefined],
    ],
  );
});

test('model errors are notices, not separators', () => {
  const { rows } = toRows(
    view([
      {
        id: 1,
        kind: 'pi.assistant',
        model: [
          { role: 'assistant', content: [], errorMessage: 'rate limited' },
        ],
      },
    ]),
  );
  assert.deepEqual(
    rows.map((row) => [row.role, row.variant]),
    [['system', 'notice']],
  );
});

test('a notification label is split from the markdown body it labels', () => {
  assert.deepEqual(
    noticeParts('[run r-1 attempt 1 failed]\n\n**Report**\n- done'),
    { label: 'run r-1 attempt 1 failed', body: '**Report**\n- done' },
  );
  assert.deepEqual(noticeParts('plain text'), {
    label: null,
    body: 'plain text',
  });
  // Only a short first line is a label; a bracket in prose is left alone.
  const long = `[${'x'.repeat(200)}]`;
  assert.deepEqual(noticeParts(long), { label: null, body: long });
});
