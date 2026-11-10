import type { Socket } from 'node:net';

/** JSON lines over a private Unix socket, with bounded buffers and backpressure. */
export function jsonPeer(
  socket: Socket,
  onMessage: (message: unknown) => void,
  maxBytes = 16 * 1024 * 1024,
  maxOutgoingBytes = 16 * 1024 * 1024,
) {
  let buffer = '';
  socket.setEncoding('utf8');
  const tooLarge = (text: string) => {
    if (Buffer.byteLength(text) <= maxBytes) return false;
    socket.destroy(new Error('Service frame exceeds the size limit'));
    return true;
  };
  // The limit is per frame: a burst of small messages in one chunk is fine,
  // one oversized frame (complete or still arriving) is not.
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let start = 0;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n', start)) >= 0) {
      const line = buffer.slice(start, boundary);
      start = boundary + 1;
      if (!line) continue;
      if (tooLarge(line)) return;
      try {
        onMessage(JSON.parse(line));
      } catch {
        socket.destroy(new Error('Invalid service message'));
        return;
      }
    }
    buffer = buffer.slice(start);
    tooLarge(buffer);
  });
  return {
    send(message: unknown): void {
      const frame = JSON.stringify(message) + '\n';
      if (
        Buffer.byteLength(frame) > maxOutgoingBytes ||
        socket.writableLength + Buffer.byteLength(frame) > maxOutgoingBytes
      ) {
        socket.destroy(
          new Error('Service client is too slow or its frame is too large'),
        );
        return;
      }
      socket.write(frame);
    },
  };
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
