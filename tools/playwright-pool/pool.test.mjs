import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PoolClient } from './client.mjs';
import { PoolCoordinator } from './coordinator.mjs';

class Constants {
  static Image = process.env.DOOC_POOL_TEST_IMAGE ?? 'tether-sandbox:3.0.2';
  static Container = process.env.DOOC_POOL_TEST_CONTAINER ?? `dooc-pwpool-test-${process.pid}-${Date.now()}`;
  static DoocUrl = process.env.DOOC_POOL_DOOC_URL ?? 'http://192.168.3.23:8788/';
  static Capacity = 2;
  static SyntheticUrl = 'http://synthetic.test/';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function docker(args, { allowFailure = false, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`docker ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !allowFailure) {
        reject(new Error(`docker ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}

async function waitFor(check, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw lastError ?? new Error(`condition not met within ${timeoutMs}ms`);
}

async function withPool(capacity, callback) {
  const coordinator = new PoolCoordinator({ container: Constants.Container, capacity });
  const info = await coordinator.start();
  const client = new PoolClient({ container: Constants.Container });
  try {
    return await callback({ ...info, coordinator, client });
  } finally {
    await coordinator.stop();
  }
}

let createdContainer = false;

before(async () => {
  if (process.env.DOOC_POOL_TEST_CONTAINER) return;
  await docker([
    'run', '-d', '--name', Constants.Container, '--init',
    '--network', 'bridge',
    '--cpus', '2',
    '--memory', '2304m',
    '--shm-size', '512m',
    '--pids-limit', '512',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    Constants.Image,
    'sleep', 'infinity',
  ]);
  createdContainer = true;
});

after(async () => {
  if (createdContainer) await docker(['rm', '-f', Constants.Container], { allowFailure: true });
});

test('independent contexts, capacity/FIFO, and fresh context after release', async () => {
  await withPool(Constants.Capacity, async ({ runId, client }) => {
    const a = await client.request({ runId, op: 'acquire', owner: 'worker-a', ttlMs: 60000 });
    const b = await client.request({ runId, op: 'acquire', owner: 'worker-b', ttlMs: 60000 });
    assert.notEqual(a.leaseId, b.leaseId);

    const [aResult, bResult] = await Promise.all([
      client.request({
        runId, op: 'eval', leaseId: a.leaseId,
        code: `
          const page = await context.newPage();
          await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>A</title><h1>A</h1>' }));
          await page.goto('${Constants.SyntheticUrl}');
          await page.evaluate(() => { document.cookie = 'a=1; path=/'; localStorage.setItem('a', '1'); });
          return {
            url: page.url(),
            title: await page.title(),
            cookie: await page.evaluate(() => document.cookie),
            storage: await page.evaluate(() => localStorage.length),
            pages: context.pages().length
          };
        `,
      }),
      client.request({
        runId, op: 'eval', leaseId: b.leaseId,
        code: `
          const pagesBefore = context.pages().length;
          const page = await context.newPage();
          await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>B</title><h1>B</h1>' }));
          await page.goto('${Constants.SyntheticUrl}');
          return {
            pagesBefore,
            cookie: await page.evaluate(() => document.cookie),
            storage: await page.evaluate(() => localStorage.length),
            title: await page.title(),
            body: await page.textContent('h1')
          };
        `,
      }),
    ]);
    assert.equal(aResult.value.url, Constants.SyntheticUrl);
    assert.equal(aResult.value.title, 'A');
    assert.equal(aResult.value.cookie, 'a=1');
    assert.equal(aResult.value.storage, 1);
    assert.equal(aResult.value.pages, 1);

    assert.equal(bResult.value.pagesBefore, 0);
    assert.equal(bResult.value.cookie, '');
    assert.equal(bResult.value.storage, 0);
    assert.equal(bResult.value.title, 'B');
    assert.equal(bResult.value.body, 'B');

    const pendingC = client.request({ runId, op: 'acquire', owner: 'worker-c', waitMs: 10000, ttlMs: 60000 });
    pendingC.catch(() => {});
    await waitFor(async () => {
      const status = await client.request({ runId, op: 'status' });
      return status.active === 2 && status.queued === 1 ? status : null;
    });
    await client.request({ runId, op: 'release', leaseId: a.leaseId });
    const c = await pendingC;

    const cResult = await client.request({
      runId, op: 'eval', leaseId: c.leaseId,
      code: `
        const pagesBefore = context.pages().length;
        const page = await context.newPage();
        await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>C</title><h1>C</h1>' }));
        await page.goto('${Constants.SyntheticUrl}');
        return {
          pagesBefore,
          cookie: await page.evaluate(() => document.cookie),
          storage: await page.evaluate(() => localStorage.length),
          title: await page.title()
        };
      `,
    });
    assert.equal(cResult.value.pagesBefore, 0);
    assert.equal(cResult.value.cookie, '');
    assert.equal(cResult.value.storage, 0);
    assert.equal(cResult.value.title, 'C');

    await client.request({ runId, op: 'release', leaseId: b.leaseId });
    await client.request({ runId, op: 'release', leaseId: c.leaseId });
  });
});

test('TTL reclaims an orphan, eval timeout invalidates the lease, release is idempotent', async () => {
  await withPool(Constants.Capacity, async ({ runId, client }) => {
    const orphan = await client.request({ runId, op: 'acquire', owner: 'orphan-worker', ttlMs: 1500 });
    const b = await client.request({ runId, op: 'acquire', owner: 'worker-b', ttlMs: 60000 });

    const started = Date.now();
    const pendingC = client.request({ runId, op: 'acquire', owner: 'worker-c', waitMs: 10000, ttlMs: 60000 });
    pendingC.catch(() => {});
    await waitFor(async () => {
      const status = await client.request({ runId, op: 'status' });
      return status.active === 2 && status.queued === 1 ? status : null;
    });
    const c = await pendingC;
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1000, `expected TTL reclaim, got ${elapsed}ms`);
    assert.ok(elapsed < 8000, `expected reclaim before wait timeout, got ${elapsed}ms`);

    await assert.rejects(
      async () => await client.request({ runId, op: 'eval', leaseId: orphan.leaseId, code: 'return 1' }),
      (error) => error.code === 'lease_expired',
    );

    await client.request({ runId, op: 'release', leaseId: b.leaseId });
    const d = await client.request({ runId, op: 'acquire', owner: 'worker-d', ttlMs: 60000 });

    const evalStarted = Date.now();
    await assert.rejects(
      async () => await client.request({
        runId, op: 'eval', leaseId: d.leaseId, timeoutMs: 500,
        code: 'await new Promise(resolve => setTimeout(resolve, 5000)); return 1;',
      }),
      (error) => error.code === 'eval_timeout',
    );
    assert.ok(Date.now() - evalStarted < 3000, 'eval timeout must not wait for the late result');

    await assert.rejects(
      async () => await client.request({ runId, op: 'eval', leaseId: d.leaseId, code: 'return 1' }),
      (error) => error.code === 'lease_expired',
    );

    const f = await client.request({ runId, op: 'acquire', owner: 'worker-f', ttlMs: 60000 });
    assert.ok(f.leaseId);
    const renewed = await client.request({ runId, op: 'renew', leaseId: f.leaseId, ttlMs: 120000 });
    assert.ok(renewed.expiresAt > f.expiresAt);

    const busyEval = client.request({
      runId, op: 'eval', leaseId: f.leaseId,
      code: 'await new Promise(resolve => setTimeout(resolve, 1000)); return 1;',
    });
    busyEval.catch(() => {});
    await delay(100);
    await assert.rejects(
      async () => await client.request({ runId, op: 'eval', leaseId: f.leaseId, code: 'return 2' }),
      (error) => error.code === 'lease_busy',
    );
    await busyEval;

    assert.deepEqual(await client.request({ runId, op: 'release', leaseId: f.leaseId }), { released: true });
    assert.deepEqual(await client.request({ runId, op: 'release', leaseId: f.leaseId }), { released: true });
    assert.deepEqual(await client.request({ runId, op: 'release', leaseId: d.leaseId }), { released: true });

    const status = await client.request({ runId, op: 'status' });
    assert.equal(status.browserConnected, true);
    assert.equal(status.queued, 0);

    await client.request({ runId, op: 'release', leaseId: c.leaseId });
  });
});

test('browser disconnect fails active and queued calls and exits the daemon nonzero', async () => {
  const coordinator = new PoolCoordinator({ container: Constants.Container, capacity: Constants.Capacity });
  const info = await coordinator.start();
  const client = new PoolClient({ container: Constants.Container });
  try {
    const longLease = await client.request({ runId: info.runId, op: 'acquire', owner: 'long-eval', ttlMs: 60000 });
    const killer = await client.request({ runId: info.runId, op: 'acquire', owner: 'killer', ttlMs: 60000 });

    const longEval = client.request({
      runId: info.runId, op: 'eval', leaseId: longLease.leaseId, timeoutMs: 10000,
      code: 'await new Promise(resolve => setTimeout(resolve, 10000)); return 1;',
    });
    longEval.catch(() => {});
    await delay(250);

    const queued = client.request({ runId: info.runId, op: 'acquire', owner: 'queued-worker', waitMs: 10000 });
    queued.catch(() => {});
    await waitFor(async () => {
      const status = await client.request({ runId: info.runId, op: 'status' });
      return status.active === 2 && status.queued === 1 ? status : null;
    });

    const kill = client.request({
      runId: info.runId, op: 'eval', leaseId: killer.leaseId,
      code: 'await context.browser().close(); return true;',
    });
    const results = await Promise.allSettled([longEval, queued, kill]);
    const longResult = results[0];
    const queuedResult = results[1];
    assert.equal(longResult.status, 'rejected');
    assert.equal(longResult.reason.code, 'pool_failed');
    assert.equal(queuedResult.status, 'rejected');
    assert.equal(queuedResult.reason.code, 'pool_failed');

    const exit = await coordinator.waitForExit(10000);
    assert.notEqual(exit.code, 0);
  } finally {
    await coordinator.stop();
  }
});

test('real Dooc page and same-origin /health from the pool browser', async () => {
  await withPool(1, async ({ runId, client }) => {
    const lease = await client.request({ runId, op: 'acquire', owner: 'dooc-reader', ttlMs: 120000 });
    try {
      const result = await client.request({
        runId, op: 'eval', leaseId: lease.leaseId, timeoutMs: 60000,
        code: `
          const page = await context.newPage();
          const response = await page.goto(${JSON.stringify(Constants.DoocUrl)}, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
          const title = await page.title();
          const text = (await page.locator('body').innerText()).trim();
          const health = await page.evaluate(async () => {
            const response = await fetch('/health');
            return { status: response.status, body: await response.json() };
          });
          return {
            status: response?.status(),
            title,
            textLength: text.length,
            textSample: text.slice(0, 80),
            health
          };
        `,
      });
      assert.equal(result.value.status, 200);
      assert.match(result.value.title, /Dooc/i);
      assert.ok(result.value.textLength > 0, `page body was empty: ${JSON.stringify(result.value)}`);
      assert.equal(result.value.health.status, 200);
      assert.equal(result.value.health.body.status, 'ok');
    } finally {
      await client.request({ runId, op: 'release', leaseId: lease.leaseId });
    }
  });
});
