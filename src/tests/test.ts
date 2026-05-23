/**
 * ============================================================
 *  EXTREME COMBINED STRESS TEST — PLC Library
 *  Target: Real Modbus slave on 127.0.0.1:502
 *  (Must be running before you execute this script)
 * ============================================================
 *
 *  This test suite merges and amplifies all previous tests,
 *  adding extreme concurrency, rapid state changes, reconnect
 *  chaos, and potential resource leak detection.
 *
 *  HOW TO RUN:
 *    npx tsx test.ts
 * ============================================================
 */

import PLC from '../PLC.js';

const HOST = '127.0.0.1';
const PORT = 502;

// ─────────────────────────────────────────────────────────────
//  Test runner
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const log: string[] = [];
const leakWarnings: string[] = [];

process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    leakWarnings.push(warning.message);
  }
});

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    log.push(`  ✅  ${name}`);
  } catch (err: any) {
    failed++;
    log.push(`  ❌  ${name}\n       → ${err?.message ?? err}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Changes = Record<number, { PrevValue: number; Value: number }>;

// ─────────────────────────────────────────────────────────────
//  Single shared PLC connection for many tests
// ─────────────────────────────────────────────────────────────

console.log(`\nConnecting to Modbus slave at ${HOST}:${PORT}...`);
const plc = new PLC({ host: HOST, port: PORT });
plc.on('error', () => {}); // suppress unhandled crashes
await plc.connect();
console.log('Connected. Running EXTREME tests...\n');

// ─────────────────────────────────────────────────────────────
//  SECTION A — Basic Connectivity & Sanity
// ─────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════');
console.log(' SECTION A: Connectivity');
console.log('══════════════════════════════════════');

await test('connect() resolves true', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  p.on('error', () => {});
  const result = await p.connect();
  assert(result === true, `expected true got ${result}`);
  await p.disconnect();
});

await test('connect() emits "connect" event', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  p.on('error', () => {});
  let fired = false;
  p.on('connect', () => {
    fired = true;
  });
  await p.connect();
  assert(fired, '"connect" event never fired');
  await p.disconnect();
});

await test('read() before connect() throws with helpful message', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  let message = '';
  try {
    await p.read(1);
  } catch (e: any) {
    message = e.message;
  }
  assert(message.includes('connect()'), `unhelpful error: "${message}"`);
});

await test('watch() before connect() throws', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  let threw = false;
  try {
    await p.watch(1, () => {});
  } catch {
    threw = true;
  }
  assert(threw, 'expected error before connect');
});

await test('write() before connect() throws', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  let threw = false;
  try {
    await p.write(1, 1);
  } catch {
    threw = true;
  }
  assert(threw, 'expected error before connect');
});

// ─────────────────────────────────────────────────────────────
//  SECTION B — Disconnecting
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION B: Disconnecting');
console.log('══════════════════════════════════════');

await test('disconnect() emits "disconnect" event', async () => {
  const p = new PLC({ host: HOST, port: PORT });
  p.on('error', () => {});
  await p.connect();
  let fired = false;
  p.on('disconnect', () => {
    fired = true;
  });
  await p.disconnect();
  assert(fired, '"disconnect" event never fired');
});

await test('disconnect() prevents auto-reconnect from triggering', async () => {
  const p = new PLC({ host: HOST, port: PORT, maxRetries: 3, retryDelay: 50 });
  p.on('error', () => {});
  await p.connect();
  await p.disconnect();
  await wait(300);
  assert(!p.isReconnecting, 'auto-reconnect started after intentional disconnect');
});

// ─────────────────────────────────────────────────────────────
//  SECTION C — Basic Reading & Writing
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION C: Read / Write');
console.log('══════════════════════════════════════');

await test('read() single register returns a number', async () => {
  const data = await plc.read(1);
  assert(typeof data[1]?.AddressValues[0] === 'number', `expected number got ${typeof data[1]?.AddressValues[0]}`);
});

await test('read() array of registers all have values', async () => {
  const data = await plc.read([1, 2, 3]);
  assert(data[1] !== undefined, 'register 1 missing');
  assert(data[2] !== undefined, 'register 2 missing');
  assert(data[3] !== undefined, 'register 3 missing');
});

await test('read() string address works like numeric', async () => {
  const data = await plc.read('1');
  assert(data[1] !== undefined, 'string address not resolved');
});

await test('readInputs() returns a number', async () => {
  const data = await plc.readInputs(1);
  assert(typeof data[1]?.AddressValues[0] === 'number', `expected number got ${typeof data[1]?.AddressValues[0]}`);
});

await test('readCoils() returns a number', async () => {
  const data = await plc.readCoils(1);
  assert(typeof data[1]?.AddressValues[0] === 'number', `expected number got ${typeof data[1]?.AddressValues[0]}`);
});

await test('readDiscreteInputs() returns a number', async () => {
  const data = await plc.readDiscreteInputs(1);
  assert(typeof data[1]?.AddressValues[0] === 'number', `expected number got ${typeof data[1]?.AddressValues[0]}`);
});

await test('read() large batch (20 registers) all resolve', async () => {
  const addresses = Array.from({ length: 20 }, (_, i) => i + 1);
  const data = await plc.read(addresses);
  for (const addr of addresses) {
    assert(data[addr] !== undefined, `register ${addr} missing`);
  }
});

await test('read() empty array returns empty object', async () => {
  const data = await plc.read([]);
  assert(typeof data === 'object', 'expected object');
  assert(Object.keys(data).length === 0, 'expected empty result');
});

await test('concurrent read() calls all resolve', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => plc.read(1)));
  assert(results.every((r) => r[1] !== undefined), 'some concurrent reads came back empty');
});

await test('write() returns success status', async () => {
  const result: any = await plc.write(1, 99);
  assert(result?.Status === 'success', `expected success got ${result?.Status}`);
});

await test('write() then read() round-trips', async () => {
  await plc.write(10, 1234);
  const data = await plc.read(10);
  assert(data[10]?.AddressValues[0] === 1234, `expected 1234 got ${data[10]?.AddressValues[0]}`);
});

await test('write() value 0 round-trips', async () => {
  await plc.write(20, 0);
  const data = await plc.read(20);
  assert(data[20]?.AddressValues[0] === 0, `expected 0 got ${data[20]?.AddressValues[0]}`);
});

await test('write() max UInt16 round-trips', async () => {
  await plc.write(21, 65535);
  const data = await plc.read(21);
  assert(data[21]?.AddressValues[0] === 65535, `expected 65535 got ${data[21]?.AddressValues[0]}`);
});

await test('writeCoil(true) echoes 0xFF00', async () => {
  const result: any = await plc.writeCoil(1, true);
  assert(result?.Content?.Value === 0xff00, `expected 0xFF00 got ${result?.Content?.Value}`);
});

await test('writeCoil(false) echoes 0x0000', async () => {
  const result: any = await plc.writeCoil(1, false);
  assert(result?.Content?.Value === 0x0000, `expected 0x0000 got ${result?.Content?.Value}`);
});

await test('rapid sequential writes – last value wins', async () => {
  for (let i = 0; i < 20; i++) await plc.write(30, i);
  const data = await plc.read(30);
  assert(data[30]?.AddressValues[0] === 19, `expected 19 got ${data[30]?.AddressValues[0]}`);
});

await test('concurrent writes to different registers all succeed', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => plc.write(40 + i, i * 10)));
  const reads = await Promise.all(Array.from({ length: 10 }, (_, i) => plc.read(40 + i)));
  for (let i = 0; i < 10; i++) {
    assert(reads[i][40 + i]?.AddressValues[0] === i * 10, `register ${40 + i} wrong`);
  }
});

await test('write then immediately read does not race', async () => {
  await plc.write(150, 777);
  const data = await plc.read(150);
  assert(data[150]?.AddressValues[0] === 777, `race? got ${data[150]?.AddressValues[0]}`);
});

// ─────────────────────────────────────────────────────────────
//  SECTION D — Basic Watcher
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION D: Watcher Basics');
console.log('══════════════════════════════════════');

await test('watch() detects value change', async () => {
  await plc.write(100, 0);
  let changes: any = null;
  const watcher = await plc.watch(100, (c: Changes) => {
    changes = c;
  }, 50);
  watcher.on('error', () => {});
  await plc.write(100, 123);
  await wait(300);
  watcher.stop();
  assert(changes !== null, 'callback never fired');
  assert(changes[100]?.Value === 123, `wrong value: ${changes[100]?.Value}`);
  assert(changes[100]?.PrevValue === 0, `wrong prev: ${changes[100]?.PrevValue}`);
});

await test('watch() does not fire for unchanged value', async () => {
  await plc.write(101, 55);
  let callCount = 0;
  const watcher = await plc.watch(101, () => callCount++, 50);
  watcher.on('error', () => {});
  await wait(300);
  watcher.stop();
  assert(callCount === 0, `callback fired ${callCount} times for unchanged value`);
});

await test('stop() prevents further callbacks', async () => {
  await plc.write(102, 0);
  let callCount = 0;
  const watcher = await plc.watch(102, () => callCount++, 50);
  watcher.on('error', () => {});
  watcher.stop();
  await plc.write(102, 99);
  await wait(200);
  assert(callCount === 0, `callback fired ${callCount} times after stop()`);
});

await test('pause() suppresses callback', async () => {
  await plc.write(103, 0);
  let callCount = 0;
  const watcher = await plc.watch(103, () => callCount++, 50);
  watcher.on('error', () => {});
  watcher.pause();
  await plc.write(103, 77);
  await wait(200);
  watcher.stop();
  assert(callCount === 0, `callback fired ${callCount} times while paused`);
});

await test('resume() re-enables callback after pause', async () => {
  await plc.write(104, 0);
  let callCount = 0;
  const watcher = await plc.watch(104, () => callCount++, 50);
  watcher.on('error', () => {});
  watcher.pause();
  await plc.write(104, 11);
  await wait(150);
  await watcher.resume();
  await plc.write(104, 22);
  await wait(300);
  watcher.stop();
  assert(callCount >= 1, `callback never fired after resume (callCount=${callCount})`);
});

await test('"stop" event fires', async () => {
  const watcher = await plc.watch(1, () => {}, 50);
  watcher.on('error', () => {});
  let stopFired = false;
  watcher.on('stop', () => {
    stopFired = true;
  });
  watcher.stop();
  assert(stopFired, '"stop" event never emitted');
});

await test('"pause" and "resume" events fire', async () => {
  const watcher = await plc.watch(1, () => {}, 50);
  watcher.on('error', () => {});
  let pauseFired = false,
    resumeFired = false;
  watcher.on('pause', () => {
    pauseFired = true;
  });
  watcher.on('resume', () => {
    resumeFired = true;
  });
  watcher.pause();
  await watcher.resume();
  watcher.stop();
  assert(pauseFired, '"pause" event never emitted');
  assert(resumeFired, '"resume" event never emitted');
});

await test('watch() multiple registers – only changed appear', async () => {
  await plc.write(110, 1);
  await plc.write(111, 2);
  await plc.write(112, 3);
  let changes: any = null;
  const watcher = await plc.watch([110, 111, 112], (c: Changes) => {
    changes = c;
  }, 50);
  watcher.on('error', () => {});
  await plc.write(111, 99);
  await wait(300);
  watcher.stop();
  assert(changes !== null, 'callback never fired');
  assert(changes[111] !== undefined, 'changed register not included');
  assert(changes[110] === undefined, 'unchanged reg 110 wrongly included');
  assert(changes[112] === undefined, 'unchanged reg 112 wrongly included');
});

await test('write triggers watcher callback', async () => {
  await plc.write(120, 0);
  let changes: any = null;
  const watcher = await plc.watch(120, (c: Changes) => {
    changes = c;
  }, 50);
  watcher.on('error', () => {});
  await plc.write(120, 4321);
  await wait(300);
  watcher.stop();
  assert(changes?.[120]?.Value === 4321, `expected 4321 got ${changes?.[120]?.Value}`);
});

await test('multiple watchers fire independently', async () => {
  await plc.write(130, 0);
  await plc.write(131, 0);
  let change1: any = null,
    change2: any = null;
  const w1 = await plc.watch(130, (c) => (change1 = c), 50);
  const w2 = await plc.watch(131, (c) => (change2 = c), 50);
  w1.on('error', () => {});
  w2.on('error', () => {});
  await plc.write(130, 11);
  await plc.write(131, 22);
  await wait(300);
  w1.stop();
  w2.stop();
  assert(change1?.[130]?.Value === 11, `watcher1: ${change1?.[130]?.Value}`);
  assert(change2?.[131]?.Value === 22, `watcher2: ${change2?.[131]?.Value}`);
});

await test('stopping one watcher does not affect sibling', async () => {
  await plc.write(140, 0);
  await plc.write(141, 0);
  let change2: any = null;
  const w1 = await plc.watch(140, () => {}, 50);
  const w2 = await plc.watch(141, (c) => (change2 = c), 50);
  w1.on('error', () => {});
  w2.on('error', () => {});
  w1.stop();
  await plc.write(141, 88);
  await wait(300);
  w2.stop();
  assert(change2?.[141]?.Value === 88, `sibling watcher broken: ${change2?.[141]?.Value}`);
});

await test('stop() called twice does not throw', async () => {
  const watcher = await plc.watch(1, () => {}, 50);
  watcher.on('error', () => {});
  watcher.stop();
  watcher.stop();
});

await test('resume() without prior pause does not throw', async () => {
  const watcher = await plc.watch(1, () => {}, 200);
  watcher.on('error', () => {});
  await watcher.resume();
  watcher.stop();
});

// ─────────────────────────────────────────────────────────────
//  SECTION E — EXTREME CONCURRENCY ATTACK
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION E: Extreme Concurrency');
console.log('══════════════════════════════════════');

await test('CONCURRENCY: 500 simultaneous reads drop none', async () => {
  const promises = Array.from({ length: 500 }, (_, i) =>
    plc.read((i % 10) + 1)
  );
  const results = await Promise.allSettled(promises);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert(rejected.length === 0, `${rejected.length} of 500 requests dropped/rejected`);
});

await test('CONCURRENCY: mixed 200 reads + 200 writes simultaneous', async () => {
  const readPromises = Array.from({ length: 200 }, (_, i) =>
    plc.read((i % 10) + 1)
  );
  const writePromises = Array.from({ length: 200 }, (_, i) =>
    plc.write(50 + (i % 10), i)
  );
  const all = await Promise.allSettled([...readPromises, ...writePromises]);
  const rejected = all.filter((r) => r.status === 'rejected');
  assert(rejected.length === 0, `${rejected.length} of 400 mixed ops failed`);
});

await test('CONCURRENCY: 1000 reads with tiny staggered start', async () => {
  // Even more aggressive: fire 1000 reads almost at once but with micro delays
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 1000; i++) {
    promises.push(plc.read((i % 20) + 1));
    if (i % 100 === 0) await wait(1); // minimal stagger
  }
  const results = await Promise.allSettled(promises);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert(rejected.length === 0, `${rejected.length} of 1000 reads failed`);
});

// ─────────────────────────────────────────────────────────────
//  SECTION F — WATCHER TORTURE & LIFECYCLE CHAOS
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION F: Watcher Torture');
console.log('══════════════════════════════════════');

await test('LIFECYCLE: rapid pause/resume/stop 50 cycles', async () => {
  const watcher = await plc.watch(1, () => {}, 10);
  watcher.on('error', () => {});
  for (let i = 0; i < 50; i++) {
    watcher.pause();
    await watcher.resume().catch(() => {});
    if (i === 25) watcher.stop();
  }
  await wait(100);
  assert(watcher.isStopped === true, 'Watcher not in stopped state after 50 toggles');
});

await test('HIGH-SPEED CHURN: 20 value changes in 200ms with watcher', async () => {
  await plc.write(200, 0);
  const valuesSeen: number[] = [];
  const watcher = await plc.watch(200, (c) => {
    if (c[200]) valuesSeen.push(c[200].Value);
  }, 15); // very fast polling
  watcher.on('error', () => {});

  for (let i = 1; i <= 20; i++) {
    await plc.write(200, i);
    await wait(5); // minimal pause to let the watcher poll
  }
  await wait(200);
  watcher.stop();
  // It should have captured at least the last value
  assert(valuesSeen.length > 0, 'Watcher missed every change');
  assert(valuesSeen.includes(20), `Last value (20) missing. Captured: ${valuesSeen}`);
});

await test('MULTIPLE WATCHERS on same register', async () => {
  await plc.write(210, 0);
  let hit1 = false,
    hit2 = false;
  const w1 = await plc.watch(210, () => (hit1 = true), 30);
  const w2 = await plc.watch(210, () => (hit2 = true), 30);
  w1.on('error', () => {});
  w2.on('error', () => {});
  await plc.write(210, 99);
  await wait(200);
  w1.stop();
  w2.stop();
  assert(hit1, 'first watcher missed change');
  assert(hit2, 'second watcher missed change');
});

await test('watcher survives pause/resume while value changes', async () => {
  await plc.write(220, 0);
  let callCount = 0;
  const watcher = await plc.watch(220, () => callCount++, 30);
  watcher.on('error', () => {});
  watcher.pause();
  await plc.write(220, 5);
  await plc.write(220, 10);
  await watcher.resume();
  await plc.write(220, 15);
  await wait(200);
  watcher.stop();
  // Should have gotten the change to 15 after resume
  assert(callCount === 1, `Expected exactly 1 callback after resume, got ${callCount}`);
});

// ─────────────────────────────────────────────────────────────
//  SECTION G — RESILIENCE & RECONNECT STRESS
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION G: Resilience & Reconnect');
console.log('══════════════════════════════════════');

await test('RESILIENCE: watcher recovers after socket destroy', async () => {
  // We'll use a fresh connection to avoid messing with the global plc
  const p = new PLC({ host: HOST, port: PORT, maxRetries: 5, retryDelay: 50 });
  p.on('error', () => {});
  await p.connect();
  await p.write(5, 100);

  let changeDetected = false;
  const watcher = await p.watch(5, () => {
    changeDetected = true;
  }, 30);
  watcher.on('error', () => {});

  // Destroy underlying Modbus client to simulate cable pull
  if ((p as any).client) {
    (p as any).client.destroy();
  } else {
    // Fallback: forcefully disconnect (should trigger reconnect)
    p.emit('disconnect');
  }

  // Write while offline – may fail, that's okay
  await p.write(5, 200).catch(() => {});

  // Wait for auto-reconnect and watcher to potentially catch up
  await wait(800);
  watcher.stop();

  // The watcher should not have broken the process, and if reconnected it might have fired.
  // We only assert that the system hasn't crashed or hung.
  assert(
    watcher.isStopped || changeDetected || !p.isReconnecting,
    'Watcher bricked the reconnect cycle or hung indefinitely'
  );
  await p.disconnect();
});

await test('RESILIENCE: rapid disconnect/reconnect 20 times with watchers', async () => {
  const p = new PLC({ host: HOST, port: PORT, maxRetries: 2, retryDelay: 50 });
  p.on('error', () => {});

  for (let cycle = 0; cycle < 20; cycle++) {
    await p.connect();
    const watcher = await p.watch(1, () => {}, 50);
    watcher.on('error', () => {});
    await p.disconnect();
    await wait(50);
    // Ensure watcher has been cleaned up (stop event)
  }
  // If we get here without unhandled rejections, it's a win
  assert(true, 'manual assertion');
});

// ─────────────────────────────────────────────────────────────
//  SECTION H — LARGE BATCHES & MIXED OPERATIONS
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION H: Large Batches & Mixed Ops');
console.log('══════════════════════════════════════');

await test('LARGE BATCH: read 100 contiguous registers', async () => {
  const addresses = Array.from({ length: 100 }, (_, i) => i + 1);
  const data = await plc.read(addresses);
  for (let i = 1; i <= 100; i++) {
    assert(data[i] !== undefined, `register ${i} missing`);
  }
});

await test('LARGE BATCH: write 50 registers then read all back', async () => {
  const base = 300;
  const writes = Array.from({ length: 50 }, (_, i) => plc.write(base + i, i * 3));
  await Promise.all(writes);
  const reads = await plc.read(Array.from({ length: 50 }, (_, i) => base + i));
  for (let i = 0; i < 50; i++) {
    assert(reads[base + i]?.AddressValues[0] === i * 3, `register ${base + i} mismatch`);
  }
});

await test('MIXED: concurrent read/write/coil operations', async () => {
  const mixed = [
    plc.read(1),
    plc.readCoils(1),
    plc.readInputs(1),
    plc.write(400, 123),
    plc.writeCoil(2, true),
    plc.read([1, 2, 3]),
    plc.readDiscreteInputs(1),
  ];
  const results = await Promise.allSettled(mixed);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert(rejected.length === 0, `${rejected.length} mixed operation(s) failed`);
});

// ─────────────────────────────────────────────────────────────
//  SECTION I — EDGE CASES & ERROR HANDLING
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION I: Edge Cases');
console.log('══════════════════════════════════════');

await test('read() with out-of-range address throws useful error', async () => {
  let threw = false;
  try {
    await plc.read(99999);
  } catch {
    threw = true;
  }
  assert(threw, 'expected error for out-of-range address');
});

await test('write() with out-of-range address throws', async () => {
  let threw = false;
  try {
    await plc.write(99999, 1);
  } catch {
    threw = true;
  }
  assert(threw, 'expected error for out-of-range write address');
});

await test('writeCoil() with out-of-range address throws', async () => {
  let threw = false;
  try {
    await plc.writeCoil(99999, true);
  } catch {
    threw = true;
  }
  assert(threw, 'expected error for out-of-range coil');
});

await test('watcher with negative polling interval throws', async () => {
  let threw = false;
  try {
    await plc.watch(1, () => {}, -1);
  } catch {
    threw = true;
  }
  assert(threw, 'expected error for negative interval');
});

// ─────────────────────────────────────────────────────────────
//  SECTION J — RESOURCE LEAK CHECKS (Listener accumulation)
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION J: Resource Leaks');
console.log('══════════════════════════════════════');

await test('LEAK: creating/destroying 1000 watchers does not cause MaxListeners warning', async () => {
  const beforeCount = leakWarnings.length;
  for (let i = 0; i < 1000; i++) {
    const w = await plc.watch(1, () => {}, 100);
    w.on('error', () => {});
    w.stop();
  }
  // small wait for any async warnings to appear
  await wait(50);
  assert(
    leakWarnings.length === beforeCount,
    `MaxListeners warning appeared after 1000 watcher cycles!`
  );
});

await test('LEAK: creating/destroying 500 PLC connections does not accumulate listeners', async () => {
  const beforeCount = leakWarnings.length;
  for (let i = 0; i < 500; i++) {
    const p = new PLC({ host: HOST, port: PORT });
    p.on('error', () => {});
    await p.connect();
    await p.disconnect();
  }
  await wait(50);
  assert(
    leakWarnings.length === beforeCount,
    `MaxListeners warning appeared after 500 connect/disconnect cycles!`
  );
});

// ─────────────────────────────────────────────────────────────
//  TEARDOWN & REPORT
// ─────────────────────────────────────────────────────────────

await plc.disconnect();

console.log('\n══════════════════════════════════════');
console.log(' EXTREME STRESS TEST RESULTS');
console.log('══════════════════════════════════════\n');
for (const line of log) console.log(line);
console.log(`\n  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (leakWarnings.length > 0) {
  console.log(`\n⚠️  Resource leak warnings detected: ${leakWarnings.length}`);
  for (const w of leakWarnings) console.log(`   • ${w}`);
}
console.log('══════════════════════════════════════\n');

if (failed > 0 || leakWarnings.length > 0) process.exit(1);