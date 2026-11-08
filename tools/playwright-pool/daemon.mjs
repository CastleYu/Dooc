import { createServer } from 'node:http';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';

class Constants {
  static SocketPath = '/tmp/dooc-playwright-pool.sock';
  static PlaywrightCore = '/app/prototype/node_modules/playwright-core/index.mjs';
  static DefaultCapacity = 2;
  static MaxCapacity = 2;
  static DefaultWaitMs = 30000;
  static MaxWaitMs = 120000;
  static DefaultTtlMs = 120000;
  static MaxTtlMs = 600000;
  static MinTtlMs = 1000;
  static DefaultEvalTimeoutMs = 30000;
  static MaxEvalTimeoutMs = 120000;
  static ReclaimIntervalMs = 1000;
  static ContextCloseTimeoutMs = 10000;
  static BrowserCloseTimeoutMs = 10000;
  static SocketProbeTimeoutMs = 500;
  static MaxBodyBytes = 16 * 1024 * 1024;
  static ClosedLeaseMemory = 1000;
  static FailureExitDelayMs = 500;
  static ReadyEvent = 'ready';
  static RpcPath = '/rpc';
}

class Ops {
  static Status = 'status';
  static Acquire = 'acquire';
  static Renew = 'renew';
  static Eval = 'eval';
  static Release = 'release';
  static Shutdown = 'shutdown';
}

class States {
  static Starting = 'starting';
  static Ready = 'ready';
  static ShuttingDown = 'shutting_down';
  static Failed = 'failed';
  static Closed = 'closed';
}

class Codes {
  static BadRequest = 'bad_request';
  static BodyTooLarge = 'body_too_large';
  static RunMismatch = 'run_mismatch';
  static UnknownOperation = 'unknown_operation';
  static PoolAlreadyRunning = 'pool_already_running';
  static SocketUnavailable = 'socket_unavailable';
  static PoolNotReady = 'pool_not_ready';
  static PoolShuttingDown = 'pool_shutting_down';
  static PoolFailed = 'pool_failed';
  static PoolDisconnected = 'pool_disconnected';
  static ContextCreateFailed = 'context_create_failed';
  static ContextCloseFailed = 'context_close_failed';
  static LeaseExpired = 'lease_expired';
  static LeaseBusy = 'lease_busy';
  static UnknownLease = 'unknown_lease';
  static QueueTimeout = 'queue_timeout';
  static ClientDisconnected = 'client_disconnected';
  static CodeRequired = 'code_required';
  static EvalCompileFailed = 'eval_compile_failed';
  static EvalFailed = 'eval_failed';
  static EvalTimeout = 'eval_timeout';
  static EvalResultNotSerializable = 'eval_result_not_serializable';
}

class PoolError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function fail(code, message) {
  return new PoolError(code, message);
}

function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

async function withTimeout(promise, timeoutMs, code, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(code, message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(Codes.BodyTooLarge, `request body exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  if (size === 0) throw fail(Codes.BadRequest, 'empty request body');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(Codes.BadRequest, 'request body is not valid JSON');
  }
}

function respond(res, status, body, onDone) {
  if (res.destroyed || res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    connection: 'close',
  });
  res.end(text, onDone);
}

class BrowserPool {
  state = States.Starting;
  browser = null;
  server = null;
  leases = new Map();
  closedLeases = new Set();
  queue = [];
  active = 0;
  reclaimTimer = null;
  shutdownPromise = null;
  exitAfterResponse = false;
  exitCode = 0;
  exiting = false;

  constructor({ runId, capacity, chromium }) {
    this.runId = runId;
    this.capacity = capacity;
    this.chromium = chromium;
  }

  async start() {
    await this.ensureSocketAvailable();
    this.browser = await this.chromium.launch({ headless: true, args: ['--no-sandbox'] });
    this.browser.on('disconnected', () => {
      if (this.state === States.Ready) this.fail(Codes.PoolDisconnected, 'browser disconnected');
    });
    this.server = createServer((req, res) => { void this.handle(req, res); });
    this.server.on('error', (error) => {
      if (this.state === States.Ready) this.fail('server_error', error.message);
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off('listening', onListening); reject(error); };
      const onListening = () => { this.server.off('error', onError); resolve(); };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(Constants.SocketPath);
    });
    await chmod(Constants.SocketPath, 0o600);
    this.state = States.Ready;
    this.reclaimTimer = setInterval(() => this.reclaimExpired(), Constants.ReclaimIntervalMs);
    this.reclaimTimer.unref?.();
    console.log(JSON.stringify({
      event: Constants.ReadyEvent,
      runId: this.runId,
      capacity: this.capacity,
      socket: Constants.SocketPath,
    }));
  }

  async ensureSocketAvailable() {
    let stat;
    try {
      stat = await lstat(Constants.SocketPath);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isSocket()) throw fail(Codes.SocketUnavailable, `${Constants.SocketPath} exists and is not a socket`);
    const result = await new Promise((resolve) => {
      const socket = createConnection(Constants.SocketPath);
      const done = (value) => { socket.destroy(); resolve(value); };
      socket.once('connect', () => done('open'));
      socket.once('error', (error) => done(error.code));
      socket.setTimeout(Constants.SocketProbeTimeoutMs, () => done('timeout'));
    });
    if (result === 'open') throw fail(Codes.PoolAlreadyRunning, `pool already listens on ${Constants.SocketPath}`);
    if (result !== 'ECONNREFUSED') {
      throw fail(Codes.SocketUnavailable, `cannot verify existing socket: ${result}`);
    }
    await unlink(Constants.SocketPath);
  }

  async handle(req, res) {
    if (req.method !== 'POST' || req.url !== Constants.RpcPath) {
      return respond(res, 404, { ok: false, error: Codes.BadRequest, message: 'POST /rpc only' });
    }
    let request;
    try {
      request = await readJson(req, Constants.MaxBodyBytes);
    } catch (error) {
      return respond(res, 400, { ok: false, error: error.code ?? Codes.BadRequest, message: error.message });
    }
    const abort = new AbortController();
    res.once('close', () => { if (!res.writableEnded) abort.abort(); });
    let response;
    try {
      const result = await this.dispatch(request, { signal: abort.signal });
      response = { ok: true, result };
    } catch (error) {
      response = { ok: false, error: error.code ?? 'internal_error', message: error.message };
    }
    if (this.exitAfterResponse) {
      respond(res, 200, response, () => { void this.finalizeAndExit(); });
    } else {
      respond(res, 200, response);
    }
  }

  async dispatch(request, { signal }) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw fail(Codes.BadRequest, 'request must be a JSON object');
    }
    if (request.runId !== this.runId) throw fail(Codes.RunMismatch, 'runId does not belong to this pool');
    switch (request.op) {
      case Ops.Status:
        return this.status();
      case Ops.Acquire:
        this.requireReady();
        return await this.acquire({
          owner: typeof request.owner === 'string' && request.owner.trim() ? request.owner.trim().slice(0, 120) : 'unknown',
          waitMs: integer(request.waitMs, Constants.DefaultWaitMs, 0, Constants.MaxWaitMs),
          ttlMs: integer(request.ttlMs, Constants.DefaultTtlMs, Constants.MinTtlMs, Constants.MaxTtlMs),
          signal,
        });
      case Ops.Renew:
        this.requireReady();
        return this.renew(request);
      case Ops.Eval:
        this.requireReady();
        return await this.evalLease(request);
      case Ops.Release:
        this.requireReady();
        return await this.release(request);
      case Ops.Shutdown:
        this.exitCode = await this.shutdown();
        this.exitAfterResponse = true;
        return { shutdown: true };
      default:
        throw fail(Codes.UnknownOperation, `unknown operation: ${String(request.op)}`);
    }
  }

  status() {
    return {
      runId: this.runId,
      capacity: this.capacity,
      active: this.active,
      queued: this.queue.filter((item) => !item.settled && !item.cancelled).length,
      browserConnected: Boolean(this.browser?.isConnected()),
    };
  }

  requireReady() {
    if (this.state === States.Ready) return;
    if (this.state === States.Failed) throw fail(Codes.PoolFailed, 'pool has failed');
    if (this.state === States.ShuttingDown) throw fail(Codes.PoolShuttingDown, 'pool is shutting down');
    throw fail(Codes.PoolNotReady, `pool is ${this.state}`);
  }

  acquire({ owner, waitMs, ttlMs, signal }) {
    if (this.state !== States.Ready) return Promise.reject(fail(Codes.PoolNotReady, `pool is ${this.state}`));
    return new Promise((resolve, reject) => {
      const item = {
        owner,
        ttlMs,
        signal,
        resolve,
        reject,
        settled: false,
        cancelled: false,
        timer: null,
        onAbort: null,
      };
      const cancel = (code, message) => {
        if (item.settled) return;
        item.cancelled = true;
        this.settleReject(item, fail(code, message));
      };
      item.timer = setTimeout(() => cancel(Codes.QueueTimeout, `no slot within ${waitMs}ms`), waitMs);
      item.timer.unref?.();
      if (signal) {
        item.onAbort = () => cancel(Codes.ClientDisconnected, 'client disconnected while queued');
        if (signal.aborted) {
          cancel(Codes.ClientDisconnected, 'client disconnected while queued');
          return;
        }
        signal.addEventListener('abort', item.onAbort, { once: true });
      }
      this.queue.push(item);
      this.drain();
    });
  }

  settleResolve(item, value) {
    if (item.settled) return;
    item.settled = true;
    clearTimeout(item.timer);
    if (item.onAbort) item.signal?.removeEventListener('abort', item.onAbort);
    item.resolve(value);
  }

  settleReject(item, error) {
    if (item.settled) return;
    item.settled = true;
    clearTimeout(item.timer);
    if (item.onAbort) item.signal?.removeEventListener('abort', item.onAbort);
    item.reject(error);
  }

  drain() {
    if (this.state !== States.Ready) return;
    while (this.active < this.capacity && this.queue.length > 0) {
      const item = this.queue.shift();
      if (item.settled || item.cancelled) continue;
      this.active += 1;
      void this.createLease(item);
    }
  }

  async createLease(item) {
    let context;
    try {
      context = await this.browser.newContext();
    } catch (error) {
      this.active = Math.max(0, this.active - 1);
      this.settleReject(item, fail(Codes.ContextCreateFailed, error.message));
      this.drain();
      return;
    }
    if (item.settled || item.cancelled || this.state !== States.Ready) {
      try {
        await withTimeout(context.close(), Constants.ContextCloseTimeoutMs, Codes.ContextCloseFailed, 'context close timed out');
      } catch { /* the pool is already stopping */ }
      this.active = Math.max(0, this.active - 1);
      const code = item.cancelled
        ? Codes.ClientDisconnected
        : this.state === States.ShuttingDown ? Codes.PoolShuttingDown : Codes.PoolNotReady;
      this.settleReject(item, fail(code, 'lease was not granted'));
      this.drain();
      return;
    }
    const lease = {
      id: randomBytes(24).toString('base64url'),
      owner: item.owner,
      context,
      expiresAt: Date.now() + item.ttlMs,
      busy: false,
      closing: false,
      closePromise: null,
      pendingReject: null,
    };
    this.leases.set(lease.id, lease);
    this.settleResolve(item, { leaseId: lease.id, expiresAt: lease.expiresAt });
    this.drain();
  }

  requireLease(leaseId) {
    if (typeof leaseId !== 'string' || !leaseId) throw fail(Codes.UnknownLease, 'leaseId is required');
    const lease = this.leases.get(leaseId);
    if (lease) return lease;
    if (this.closedLeases.has(leaseId)) throw fail(Codes.LeaseExpired, 'lease is no longer active');
    throw fail(Codes.UnknownLease, 'lease does not exist');
  }

  renew(request) {
    const lease = this.requireLease(request.leaseId);
    if (lease.closing || lease.expiresAt <= Date.now()) {
      void this.closeLease(lease, Codes.LeaseExpired).catch(() => {});
      throw fail(Codes.LeaseExpired, 'lease expired');
    }
    const ttlMs = integer(request.ttlMs, Constants.DefaultTtlMs, Constants.MinTtlMs, Constants.MaxTtlMs);
    lease.expiresAt = Date.now() + ttlMs;
    return { expiresAt: lease.expiresAt };
  }

  async evalLease(request) {
    const lease = this.requireLease(request.leaseId);
    if (typeof request.code !== 'string' || !request.code.trim()) throw fail(Codes.CodeRequired, 'code is required');
    if (lease.closing || lease.expiresAt <= Date.now()) {
      void this.closeLease(lease, Codes.LeaseExpired).catch(() => {});
      throw fail(Codes.LeaseExpired, 'lease expired');
    }
    if (lease.busy) throw fail(Codes.LeaseBusy, 'another eval is running for this lease');
    lease.busy = true;
    const timeoutMs = integer(request.timeoutMs, Constants.DefaultEvalTimeoutMs, 1, Constants.MaxEvalTimeoutMs);
    const effectiveTimeoutMs = Math.min(timeoutMs, Math.max(0, lease.expiresAt - Date.now()));
    if (effectiveTimeoutMs <= 0) {
      lease.busy = false;
      void this.closeLease(lease, Codes.LeaseExpired).catch(() => {});
      throw fail(Codes.LeaseExpired, 'lease expired before eval');
    }
    let timer;
    let failEval;
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      let fn;
      try {
        fn = new AsyncFunction('context', request.code);
      } catch (error) {
        throw fail(Codes.EvalCompileFailed, error.message);
      }
      const run = Promise.resolve().then(() => fn(lease.context));
      run.catch(() => {});
      const timed = new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail(Codes.EvalTimeout, `eval exceeded ${effectiveTimeoutMs}ms`)), effectiveTimeoutMs);
        timer.unref?.();
      });
      const failed = new Promise((_, reject) => { failEval = reject; });
      lease.pendingReject = (error) => failEval(error);
      let value;
      try {
        value = await Promise.race([run, timed, failed]);
      } catch (error) {
        if (error.code === Codes.EvalTimeout) {
          void this.closeLease(lease, Codes.LeaseExpired).catch(() => {});
        }
        if (this.state === States.Failed || !this.browser?.isConnected()) {
          throw fail(Codes.PoolFailed, 'browser disconnected');
        }
        if (error.code === Codes.EvalTimeout) throw error;
        if (lease.closing) throw fail(Codes.LeaseExpired, 'lease expired during eval');
        if (error.code) throw error;
        throw fail(Codes.EvalFailed, error.message);
      }
      const safeValue = value === undefined ? null : value;
      let encoded;
      try {
        encoded = JSON.stringify(safeValue);
      } catch (error) {
        throw fail(Codes.EvalResultNotSerializable, error.message);
      }
      if (encoded === undefined) throw fail(Codes.EvalResultNotSerializable, 'result is not JSON serializable');
      return { value: JSON.parse(encoded) };
    } finally {
      clearTimeout(timer);
      lease.busy = false;
      lease.pendingReject = null;
    }
  }

  async release(request) {
    const lease = this.leases.get(request.leaseId);
    if (!lease) {
      if (this.closedLeases.has(request.leaseId)) return { released: true };
      throw fail(Codes.UnknownLease, 'lease does not exist');
    }
    await this.closeLease(lease, 'released');
    return { released: true };
  }

  async closeLease(lease, reason) {
    if (lease.closePromise) return lease.closePromise;
    lease.closing = true;
    this.leases.delete(lease.id);
    this.closedLeases.add(lease.id);
    while (this.closedLeases.size > Constants.ClosedLeaseMemory) {
      this.closedLeases.delete(this.closedLeases.values().next().value);
    }
    lease.closePromise = (async () => {
      try {
        await withTimeout(
          lease.context.close(),
          Constants.ContextCloseTimeoutMs,
          Codes.ContextCloseFailed,
          `context close timed out (${reason})`,
        );
      } catch (error) {
        if (this.state === States.Ready) this.fail(Codes.ContextCloseFailed, error.message);
        throw fail(Codes.PoolFailed, error.message);
      } finally {
        if (this.state === States.Ready) {
          this.active = Math.max(0, this.active - 1);
          this.drain();
        }
      }
    })();
    return lease.closePromise;
  }

  reclaimExpired() {
    const now = Date.now();
    for (const lease of [...this.leases.values()]) {
      if (!lease.closing && lease.expiresAt <= now) {
        void this.closeLease(lease, Codes.LeaseExpired).catch(() => {});
      }
    }
  }

  async shutdown() {
    if (this.state === States.Closed || this.state === States.Failed) return this.exitCode || 1;
    if (this.shutdownPromise) return this.shutdownPromise;
    this.state = States.ShuttingDown;
    this.shutdownPromise = (async () => {
      let exitCode = 0;
      clearInterval(this.reclaimTimer);
      for (const item of this.queue.splice(0)) {
        this.settleReject(item, fail(Codes.PoolShuttingDown, 'pool is shutting down'));
      }
      const results = await Promise.allSettled(
        [...this.leases.values()].map((lease) => this.closeLease(lease, Ops.Shutdown)),
      );
      if (results.some((result) => result.status === 'rejected')) exitCode = 1;
      try {
        await withTimeout(
          this.browser?.close(),
          Constants.BrowserCloseTimeoutMs,
          Codes.ContextCloseFailed,
          'browser close timed out',
        );
      } catch {
        exitCode = 1;
      }
      try {
        await unlink(Constants.SocketPath);
      } catch (error) {
        if (error.code !== 'ENOENT') exitCode = 1;
      }
      try {
        this.server?.close();
      } catch {
        exitCode = 1;
      }
      this.state = States.Closed;
      return exitCode;
    })();
    return this.shutdownPromise;
  }

  fail(code, message) {
    if (this.state === States.Failed || this.state === States.Closed || this.state === States.ShuttingDown) return;
    this.state = States.Failed;
    this.exitCode = 1;
    clearInterval(this.reclaimTimer);
    const error = fail(Codes.PoolFailed, `${code}: ${message}`);
    for (const item of this.queue.splice(0)) this.settleReject(item, error);
    for (const lease of this.leases.values()) {
      lease.closing = true;
      lease.pendingReject?.(error);
      void lease.context.close().catch(() => {});
    }
    this.leases.clear();
    setTimeout(() => { void this.finalizeAndExit(); }, Constants.FailureExitDelayMs).unref?.();
  }

  async finalizeAndExit() {
    if (this.exiting) return;
    this.exiting = true;
    try {
      await withTimeout(
        this.browser?.close(),
        Constants.BrowserCloseTimeoutMs,
        Codes.ContextCloseFailed,
        'browser close timed out during finalization',
      );
    } catch { /* browser may already be disconnected */ }
    try { this.server?.close(); } catch { /* already closed */ }
    try { this.server?.closeAllConnections?.(); } catch { /* already closed */ }
    try { await unlink(Constants.SocketPath); } catch { /* already removed */ }
    process.exit(this.exitCode);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--run-id') args.runId = argv[++index];
    else if (name === '--capacity') args.capacity = argv[++index];
    else if (name === '--playwright') args.playwright = argv[++index];
    else throw new Error(`unknown argument: ${name}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runId) throw new Error('run_id_required');
  const corePath = args.playwright ?? process.env.DOOC_PLAYWRIGHT_CORE ?? Constants.PlaywrightCore;
  const { chromium } = await import(pathToFileURL(corePath).href);
  const capacity = integer(args.capacity, Constants.DefaultCapacity, 1, Constants.MaxCapacity);
  const pool = new BrowserPool({ runId: args.runId, capacity, chromium });
  const stop = async () => {
    const code = await pool.shutdown();
    pool.exitCode = code;
    await pool.finalizeAndExit();
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  process.on('uncaughtException', (error) => {
    console.error(error);
    pool.fail('uncaught_exception', error.message);
  });
  process.on('unhandledRejection', (error) => {
    console.error(error);
    pool.fail('unhandled_rejection', String(error));
  });
  try {
    await pool.start();
  } catch (error) {
    try { await pool.browser?.close(); } catch { /* browser may not be connected */ }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
