import net from 'node:net';
import type { AddressInfo } from 'node:net';

/** A listener that counts connections and records the first bytes it receives. */
export async function listener(
  reply = 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/html\r\n\r\nok',
) {
  const state = { connections: 0, received: [] as string[] };
  const server = net.createServer((s) => {
    state.connections++;
    s.on('error', () => {});
    s.on('data', (d) => {
      state.received.push(d.toString('latin1'));
      s.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    state,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>(
        (r) => (
          server.close(() => r()),
          (server as net.Server & { closeAllConnections?: () => void }).closeAllConnections?.()
        ),
      ),
  };
}

/** Sends raw bytes to a port and resolves with everything read until close (or 1.5 s). */
export function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let out = '';
    s.on('data', (d) => (out += d.toString('latin1')));
    s.on('error', () => resolve(out));
    s.on('close', () => resolve(out));
    s.setTimeout(1500, () => s.destroy());
    s.write(text);
  });
}

export const status = (resp: string) => Number(/^HTTP\/1\.[01] (\d{3})/.exec(resp)?.[1] ?? 0);
