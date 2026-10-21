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

test('a running round updates its committed tool calls instead of adding rows', () => {
  const { rows } = toRows({
    entries: [
      {
        id: 1,
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                callId: 'c1',
                name: 'recall',
                arguments: { query: 'launch' },
              },
              { type: 'toolCall', callId: 'c2', name: 'list_tasks' },
            ],
          },
        ],
      },
    ],
    docs: {
      'pi.live': {
        run: { taskId: 1, inputs: [] },
        tools: [
          {
            callId: 'c1',
            name: 'recall',
            status: 'running',
            output: 'partial',
          },
        ],
      },
    },
  });

  assert.deepEqual(
    rows.map((row) => [row.role, row.toolCalls?.length]),
    [['tool', 2]],
  );
  assert.deepEqual(
    rows[0].toolCalls?.map((call) => [call.callId, call.status, call.output]),
    [
      ['c1', 'running', 'partial'],
      ['c2', 'pending', undefined],
    ],
  );
});

test('live calls missing from the transcript share one tool row', () => {
  const { rows } = toRows({
    entries: [],
    docs: {
      'pi.live': {
        run: { taskId: 1, inputs: [] },
        tools: [
          { callId: 'c1', name: 'dispatch', status: 'running' },
          { callId: 'c2', name: 'send_msg', status: 'pending' },
        ],
      },
    },
  });

  assert.deepEqual(
    rows.map((row) => row.role),
    ['tool'],
  );
  assert.deepEqual(
    rows[0].toolCalls?.map((call) => [call.callId, call.status]),
    [
      ['c1', 'running'],
      ['c2', 'pending'],
    ],
  );
});

test('a finished tool result wins over the live slot', () => {
  const { rows } = toRows({
    entries: [
      {
        id: 1,
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', callId: 'c1', name: 'recall' }],
          },
        ],
      },
      {
        id: 2,
        kind: 'pi.tool-result',
        model: [{ role: 'tool', toolCallId: 'c1', content: 'result' }],
      },
    ],
    docs: {
      'pi.live': {
        tools: [
          {
            callId: 'c1',
            name: 'recall',
            status: 'done',
            output: 'stale',
          },
        ],
      },
    },
  });

  assert.deepEqual(
    rows.map((row) => row.toolCalls?.[0]?.output),
    ['result'],
  );
  assert.equal(rows[0].toolCalls?.[0]?.status, 'done');
  assert.equal(rows.length, 1);
});

test('a run of tool-only rounds folds into one activity row', () => {
  const round = (id: number, callId: string) => ({
    id,
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', callId, name: 'recall' },
          { type: 'thinking', thinking: `round ${String(id)}` },
        ],
      },
    ],
  });
  const { rows } = toRows(
    view([
      round(1, 'c1'),
      { id: 2, kind: 'pi.tool-result' },
      round(3, 'c2'),
      // Prose ends the fold; its own calls stay with the message.
      {
        id: 4,
        kind: 'pi.assistant',
        model: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Both rounds are done.' },
              { type: 'toolCall', callId: 'c3', name: 'send_msg' },
            ],
          },
        ],
      },
      round(5, 'c4'),
      round(6, 'c5'),
    ]),
  );

  assert.deepEqual(
    rows.map((row) => [
      row.role,
      row.text,
      row.toolCalls?.map((call) => call.callId).join(','),
    ]),
    [
      ['tool', '', 'c1,c2'],
      ['assistant', 'Both rounds are done.', 'c3'],
      ['tool', '', 'c4,c5'],
    ],
  );
});
