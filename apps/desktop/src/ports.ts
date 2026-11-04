import net from 'node:net';

function tryPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address() as net.AddressInfo;
      server.close(() => resolve(bound));
    });
  });
}

/** `preferred` if it's free, else any free port on 127.0.0.1. */
export async function freePort(preferred = 0): Promise<number> {
  if (preferred && (await tryPort(preferred))) return preferred;
  const port = await tryPort(0);
  if (!port) throw new Error('No free port on 127.0.0.1');
  return port;
}
