import { request as httpRequest } from 'node:http';

class Constants {
  static SocketPath = '/tmp/dooc-playwright-pool.sock';
  static RpcPath = '/rpc';
  static MinTimeoutMs = 30000;
  static TimeoutPaddingMs = 15000;
}

function write(response, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = exitCode;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let request;
  try {
    request = JSON.parse(await readStdin());
  } catch (error) {
    return write({ ok: false, error: 'bad_request', message: `invalid stdin JSON: ${error.message}` }, 1);
  }
  const payload = JSON.stringify(request);
  const timeoutMs = Math.max(
    Constants.MinTimeoutMs,
    Number(request.waitMs ?? 0) + Number(request.timeoutMs ?? 0) + Constants.TimeoutPaddingMs,
  );
  const response = await new Promise((resolve) => {
    const req = httpRequest({
      socketPath: Constants.SocketPath,
      path: Constants.RpcPath,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        connection: 'close',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve({ ok: false, error: 'rpc_bad_response', message: `daemon returned HTTP ${res.statusCode}` });
        }
      });
      res.on('error', (error) => resolve({ ok: false, error: 'rpc_failed', message: error.message }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`rpc timed out after ${timeoutMs}ms`));
    });
    req.on('error', (error) => resolve({ ok: false, error: 'rpc_failed', message: error.message }));
    req.end(payload);
  });
  write(response, 0);
}

main().catch((error) => {
  write({ ok: false, error: 'rpc_failed', message: error.message }, 1);
});
