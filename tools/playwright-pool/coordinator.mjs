import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PoolClient } from './client.mjs';

class Constants {
  static Container = 'tether-sandbox';
  static RemoteRoot = '/tmp/dooc-playwright-pool';
  static DefaultCapacity = 2;
  static MaxCapacity = 2;
  static ComposeProject = 'tether-sandbox';
  static ComposeService = 'sandbox';
  static ComposeProjectLabel = 'com.docker.compose.project';
  static ComposeServiceLabel = 'com.docker.compose.service';
  static StartTimeoutMs = 30000;
  static StopTimeoutMs = 30000;
  static PollIntervalMs = 250;
  static ReadyEvent = 'ready';
  static RunIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
}

class Ops {
  static Status = 'status';
  static Shutdown = 'shutdown';
}

class CoordinatorError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, { input, timeoutMs = 30000, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
      reject(new CoordinatorError('command_timeout', `${command} did not finish within ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, new CoordinatorError('command_failed', error.message)));
    child.on('close', (code) => {
      if (settled) return;
      const result = { code, stdout, stderr };
      if (code !== 0 && !allowFailure) {
        finish(reject, new CoordinatorError('command_failed', `${command} exited ${code}: ${stderr.trim()}`));
      } else {
        finish(resolve, result);
      }
    });
    child.stdin.on('error', () => { /* reported by close */ });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

export class PoolCoordinator {
  constructor({
    container = process.env.DOOC_POOL_CONTAINER ?? Constants.Container,
    capacity = Constants.DefaultCapacity,
    startIfStopped = false,
    stopContainer = false,
    remoteRoot = process.env.DOOC_POOL_REMOTE_ROOT ?? Constants.RemoteRoot,
  } = {}) {
    this.container = container;
    this.capacity = Math.min(Math.max(Number(capacity) || Constants.DefaultCapacity, 1), Constants.MaxCapacity);
    this.startIfStopped = startIfStopped;
    this.stopContainer = stopContainer;
    this.remoteRoot = remoteRoot;
    this.runId = null;
    this.remoteDir = null;
    this.child = null;
    this.exit = null;
    this.startedByUs = false;
    this.stdout = '';
    this.stderr = '';
    this.ready = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  async docker(args, options = {}) {
    return await run('docker', args, options);
  }

  async inspect() {
    const result = await this.docker(['inspect', '--format', '{{json .State}}', this.container], { allowFailure: true });
    if (result.code !== 0) {
      if (/no such (object|container)/i.test(result.stderr)) return { exists: false, running: false };
      throw new CoordinatorError('inspect_failed', result.stderr.trim() || `docker inspect exited ${result.code}`);
    }
    const state = JSON.parse(result.stdout.trim());
    return { exists: true, running: Boolean(state.Running), state };
  }

  async verifyIdentity() {
    if (this.container !== Constants.Container) return;
    const result = await this.docker(['inspect', '--format', '{{json .Config.Labels}}', this.container]);
    const labels = JSON.parse(result.stdout.trim() || '{}');
    if (
      labels[Constants.ComposeProjectLabel] !== Constants.ComposeProject
      || labels[Constants.ComposeServiceLabel] !== Constants.ComposeService
    ) {
      throw new CoordinatorError(
        'container_identity_mismatch',
        `${this.container} is not the expected Compose service ${Constants.ComposeProject}/${Constants.ComposeService}`,
      );
    }
  }

  async waitRunning() {
    const deadline = Date.now() + Constants.StartTimeoutMs;
    while (Date.now() < deadline) {
      const state = await this.inspect();
      if (state.running) return;
      await delay(Constants.PollIntervalMs);
    }
    throw new CoordinatorError('container_start_timeout', `${this.container} did not start within ${Constants.StartTimeoutMs}ms`);
  }

  async start() {
    if (this.runId) throw new CoordinatorError('already_started', 'coordinator already owns a pool');
    this.runId = randomUUID();
    this.remoteDir = `${this.remoteRoot}/${this.runId}`;
    this.stdout = '';
    this.stderr = '';
    this.exit = null;
    const state = await this.inspect();
    if (!state.exists) {
      throw new CoordinatorError('container_missing', `container ${this.container} does not exist`);
    }
    await this.verifyIdentity();
    if (!state.running) {
      if (!this.startIfStopped) {
        throw new CoordinatorError(
          'container_stopped',
          `container ${this.container} is stopped; start it explicitly or pass --start-if-stopped when this batch owns it`,
        );
      }
      await this.docker(['start', this.container]);
      this.startedByUs = true;
      await this.waitRunning();
    }
    await this.docker(['exec', this.container, 'mkdir', '-p', this.remoteDir]);
    await this.docker(['cp', fileURLToPath(new URL('./daemon.mjs', import.meta.url)), `${this.container}:${this.remoteDir}/daemon.mjs`]);
    await this.docker(['cp', fileURLToPath(new URL('./rpc.mjs', import.meta.url)), `${this.container}:${this.remoteDir}/rpc.mjs`]);
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child = spawn('docker', [
      'exec', this.container, 'node', `${this.remoteDir}/daemon.mjs`,
      '--run-id', this.runId,
      '--capacity', String(this.capacity),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.stdout += chunk;
      let index;
      while ((index = this.stdout.indexOf('\n')) >= 0) {
        const line = this.stdout.slice(0, index).trim();
        this.stdout = this.stdout.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === Constants.ReadyEvent) this.resolveReady?.(event);
        } catch { /* daemon diagnostics stay on stdout */ }
      }
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.child.on('error', (error) => {
      this.exit = { code: null, signal: null, error: error.message };
      this.rejectReady?.(new CoordinatorError('daemon_spawn_failed', error.message));
    });
    this.child.on('exit', (code, signal) => {
      this.exit = { code, signal };
      this.rejectReady?.(new CoordinatorError(
        'daemon_exited',
        `daemon exited ${code ?? signal} before ready: ${this.stderr.trim().slice(-800)}`,
      ));
    });
    const timeout = setTimeout(() => {
      this.rejectReady?.(new CoordinatorError('daemon_ready_timeout', `daemon did not become ready: ${this.stderr.trim().slice(-800)}`));
    }, Constants.StartTimeoutMs);
    try {
      await this.ready;
    } finally {
      clearTimeout(timeout);
    }
    return { runId: this.runId, container: this.container, capacity: this.capacity, remoteDir: this.remoteDir };
  }

  client() {
    return new PoolClient({ container: this.container, remoteRoot: this.remoteRoot });
  }

  async status() {
    if (!this.runId) throw new CoordinatorError('not_started', 'coordinator has no active run');
    return await this.client().request({ runId: this.runId, op: Ops.Status });
  }

  waitForExit(timeoutMs = Constants.StopTimeoutMs) {
    if (this.exit) return Promise.resolve(this.exit);
    if (!this.child) return Promise.resolve({ code: null, signal: null });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CoordinatorError('daemon_exit_timeout', `daemon did not exit within ${timeoutMs}ms`));
      }, timeoutMs);
      const onExit = (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      };
      this.child?.once('exit', onExit);
      if (this.exit) {
        this.child?.off('exit', onExit);
        clearTimeout(timer);
        resolve(this.exit);
      }
    });
  }

  async stop() {
    if (!this.runId) return;
    const runId = this.runId;
    try {
      await this.client().request({ runId, op: Ops.Shutdown });
    } catch (error) {
      if (!['client_failed', 'client_bad_response', 'client_timeout', 'rpc_failed'].includes(error.code)) throw error;
    }
    try {
      await this.waitForExit(Constants.StopTimeoutMs);
    } catch {
      this.child?.kill('SIGTERM');
      await this.waitForExit(5000).catch(() => {});
    }
    try {
      await this.docker(['exec', this.container, 'rm', '-rf', this.remoteDir]);
    } catch { /* container may already be stopped */ }
    if (this.startedByUs && this.stopContainer) {
      await this.docker(['stop', this.container]);
    }
    this.runId = null;
    this.remoteDir = null;
    this.child = null;
    this.exit = null;
    this.startedByUs = false;
  }
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--container') options.container = argv[++index];
    else if (name === '--capacity') options.capacity = Number(argv[++index]);
    else if (name === '--remote-root') options.remoteRoot = argv[++index];
    else if (name === '--run-id') options.runId = argv[++index];
    else if (name === '--start-if-stopped') options.startIfStopped = true;
    else if (name === '--stop-container') options.stopContainer = true;
    else throw new CoordinatorError('bad_argument', `unknown argument: ${name}`);
  }
  return options;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  if (command === 'start') {
    const coordinator = new PoolCoordinator(options);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await coordinator.stop();
      } finally {
        process.exit(0);
      }
    };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    const info = await coordinator.start();
    process.stdout.write(`${JSON.stringify(info)}\n`);
    await new Promise(() => {});
  } else if (command === 'status') {
    if (!options.runId || !Constants.RunIdPattern.test(options.runId)) {
      throw new CoordinatorError('run_id_required', 'status requires --run-id');
    }
    const result = await new PoolClient({ container: options.container, remoteRoot: options.remoteRoot })
      .request({ runId: options.runId, op: Ops.Status });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === 'stop') {
    if (!options.runId || !Constants.RunIdPattern.test(options.runId)) {
      throw new CoordinatorError('run_id_required', 'stop requires --run-id');
    }
    const container = options.container ?? Constants.Container;
    try {
      await new PoolClient({ container, remoteRoot: options.remoteRoot })
        .request({ runId: options.runId, op: Ops.Shutdown });
    } catch (error) {
      if (!['client_failed', 'client_bad_response', 'client_timeout', 'rpc_failed'].includes(error.code)) throw error;
    }
    try {
      await run('docker', ['exec', container, 'rm', '-rf', `${options.remoteRoot ?? Constants.RemoteRoot}/${options.runId}`], { allowFailure: true });
    } catch { /* container may already be stopped */ }
    if (options.stopContainer) await run('docker', ['stop', container], { allowFailure: true });
    process.stdout.write(`${JSON.stringify({ stopped: true, runId: options.runId })}\n`);
  } else {
    throw new CoordinatorError('bad_command', 'usage: coordinator.mjs <start|status|stop> [options]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.code ?? 'coordinator_failed', message: error.message })}\n`);
    process.exitCode = 1;
  });
}
