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
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > maxBytes) {
      socket.destroy(new Error('Service frame exceeds the size limit'));
      return;
    }
    let boundary: number;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        socket.destroy(new Error('Invalid service message'));
        return;
      }
    }
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
