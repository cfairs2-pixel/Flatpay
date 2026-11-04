import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the exact factory shipped to browsers without running the React app.
// Worker messages and the clock are synthetic; no statement/customer data is used.
const bundle = readFileSync(new URL('../public/workspace.js', import.meta.url), 'utf8');
const begin = bundle.indexOf('function d0()');
const end = bundle.indexOf('var md,uy;', begin);
assert(begin >= 0 && end > begin, 'Bundled Tesseract factory markers must be present.');
const factorySource = bundle.slice(begin, end);

function harness({ rejectAction, stalledAction, workerError } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  let receiver;
  let terminated = 0;
  const worker = {};
  const spawnFactory = new Function(
    'DA', 'u0', 'uf', 'cf', 'h0', 'FA', 'setTimeout', 'clearTimeout',
    `let cy=0,fd;${factorySource};return d0();`,
  );
  const createWorker = spawnFactory(
    () => options => options,
    () => job => ({ ...job, id: job.id || 'synthetic-job' }),
    () => ({ log() {} }),
    () => () => 'synthetic-worker',
    () => ({ DEFAULT: 3, LSTM_ONLY: 1 }),
    () => ({
      defaultOptions: {},
      spawnWorker: () => worker,
      terminateWorker: () => { terminated++; },
      onMessage: (_, callback) => { receiver = callback; },
      loadImage: async image => image,
      send: (_, job) => {
        queueMicrotask(() => {
          if (workerError && job.action === 'load') {
            worker.onerror({ message: workerError });
            return;
          }
          if (job.action === stalledAction) return;
          const failed = job.action === rejectAction;
          receiver({
            workerId: job.workerId,
            jobId: job.jobId,
            action: job.action,
            status: failed ? 'reject' : 'resolve',
            data: failed ? `Synthetic ${job.action} failure` : {},
          });
        });
      },
    }),
    (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    id => timers.delete(id),
  );
  return {
    // A supplied error handler prevents the library's diagnostic rethrow in
    // its message callback; the factory must still reject its returned promise.
    start: () => createWorker('eng', 1, { errorHandler() {} }),
    timers,
    get terminated() { return terminated; },
    expireStartupTimer() {
      assert.equal(timers.size, 1, 'Exactly one startup timer should be active.');
      const [id, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 180000, 'Startup timeout should allow three minutes.');
      timers.delete(id);
      timer.callback();
    },
  };
}

test('OCR startup succeeds without leaving a deadline timer', async () => {
  const runtime = harness();
  const worker = await runtime.start();
  assert.equal(runtime.timers.size, 0);
  assert.equal(runtime.terminated, 0);
  await worker.terminate();
  assert.equal(runtime.terminated, 1);
});

for (const action of ['load', 'loadLanguage', 'initialize']) {
  test(`OCR ${action} failure rejects an Error and terminates its worker`, async () => {
    const runtime = harness({ rejectAction: action });
    await assert.rejects(runtime.start(), error => {
      assert(error instanceof Error);
      assert.equal(error.message, `Synthetic ${action} failure`);
      return true;
    });
    assert.equal(runtime.terminated, 1);
    assert.equal(runtime.timers.size, 0);
  });
}

test('OCR startup worker error releases the worker and timer', async () => {
  const runtime = harness({ workerError: 'Synthetic startup worker crash' });
  await assert.rejects(runtime.start(), { message: 'Synthetic startup worker crash' });
  assert.equal(runtime.terminated, 1);
  assert.equal(runtime.timers.size, 0);
});

test('unresponsive OCR startup expires without a real three-minute wait', async () => {
  const runtime = harness({ stalledAction: 'load' });
  const startup = runtime.start();
  runtime.expireStartupTimer();
  await assert.rejects(startup, /took too long to start.*Check your connection/);
  assert.equal(runtime.terminated, 1);
  assert.equal(runtime.timers.size, 0);
});
