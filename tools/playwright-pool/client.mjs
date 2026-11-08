import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

class Constants {
  static Container = 'tether-sandbox';
  static RemoteRoot = '/tmp/dooc-playwright-pool';
  static RemoteRpc = 'rpc.mjs';
  static DefaultTimeoutMs = 30000;
  static TimeoutPaddingMs = 15000;
  static OutputLimit = 32 * 1024 * 1024;
  static RunIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
}

class ClientError extends Error {
  constructor(code, message, response) {
    super(message ?? code);
    this.code = code;
    this.response = response;
  }
}

export class PoolClient {
  constructor({
    container = process.env.DOOC_POOL_CONTAINER ?? Constants.Container,
    remoteRoot = process.env.DOOC_POOL_REMOTE_ROOT ?? Constants.RemoteRoot,
    timeoutMs = Constants.DefaultTimeoutMs,
  } = {}) {
    this.container = container;
    this.remoteRoot = remoteRoot;
    this.timeoutMs = timeoutMs;
  }

  async request(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new ClientError('bad_request', 'request must be an object');
    }
    if (typeof request.runId !== 'string' || !Constants.RunIdPattern.test(request.runId)) {
      throw new ClientError('invalid_run_id', 'runId must be a short path-safe string');
    }
    const remoteRpc = `${this.remoteRoot}/${request.runId}/${Constants.RemoteRpc}`;
    const payload = JSON.stringify(request);
    const timeoutMs = Math.max(
      this.timeoutMs,
      Number(request.waitMs ?? 0) + Number(request.timeoutMs ?? 0) + Constants.TimeoutPaddingMs,
    );
    return await new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', this.container, 'node', remoteRpc], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new ClientError('client_timeout', `docker exec did not finish within ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-Constants.OutputLimit); });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-Constants.OutputLimit); });
      child.on('error', (error) => finish(reject, new ClientError('client_spawn_failed', error.message)));
      child.on('close', (code) => {
        if (settled) return;
        const line = stdout.trim().split('\n').filter(Boolean).at(-1);
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          const detail = stderr.trim().slice(-800) || stdout.trim().slice(-800);
          finish(reject, new ClientError('client_bad_response', `docker exec exited ${code}: ${detail}`));
          return;
        }
        if (response.ok === true) {
          finish(resolve, response.result);
        } else {
          finish(reject, new ClientError(
            response.error ?? 'rpc_error',
            response.message ?? `rpc failed with exit ${code}`,
            response,
          ));
        }
      });
      child.stdin.on('error', () => { /* child exit is reported by close */ });
      child.stdin.end(payload);
    });
  }
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
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'bad_request', message: error.message })}\n`);
    process.exitCode = 1;
    return;
  }
  const client = new PoolClient();
  try {
    const result = await client.request(request);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.code, message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'client_failed', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
