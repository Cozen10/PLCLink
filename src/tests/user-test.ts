/**
 * ============================================================
 *  STRESS TEST — PLC Library (user perspective)
 *  Target: real Modbus slave on 127.0.0.1:502
 * ============================================================
 *
 *  HOW TO RUN:
 *    npx tsx user-test.ts
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

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
type Changes = Record<number, { PrevValue: number; Value: number }>;

// ─────────────────────────────────────────────────────────────
//  Single shared PLC connection for the whole test run
// ─────────────────────────────────────────────────────────────

console.log(`\nConnecting to Modbus slave at ${HOST}:${PORT}...`);
const plc = new PLC({ host: HOST, port: PORT });
plc.on('error', () => {}); // suppress unhandled error crashes
await plc.connect();
console.log('Connected. Running tests...\n');

// ─────────────────────────────────────────────────────────────
//  SECTION 1 — Connecting
// ─────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════');
console.log(' SECTION 1: Connecting');
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
    p.on('connect', () => { fired = true; });
    await p.connect();
    assert(fired, '"connect" event never fired');
    await p.disconnect();
});

await test('read() before connect() throws with helpful message', async () => {
    const p = new PLC({ host: HOST, port: PORT });
    let message = '';
    try { await p.read(1); } catch (e: any) { message = e.message; }
    assert(message.includes('connect()'), `unhelpful error: "${message}"`);
});

await test('watch() before connect() throws', async () => {
    const p = new PLC({ host: HOST, port: PORT });
    let threw = false;
    try { await p.watch(1, () => {}); } catch { threw = true; }
    assert(threw, 'expected error before connect');
});

await test('write() before connect() throws', async () => {
    const p = new PLC({ host: HOST, port: PORT });
    let threw = false;
    try { await p.write(1, 1); } catch { threw = true; }
    assert(threw, 'expected error before connect');
});

// ─────────────────────────────────────────────────────────────
//  SECTION 2 — Disconnecting
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION 2: Disconnecting');
console.log('══════════════════════════════════════');

await test('disconnect() emits "disconnect" event', async () => {
    const p = new PLC({ host: HOST, port: PORT });
    p.on('error', () => {});
    await p.connect();
    let fired = false;
    p.on('disconnect', () => { fired = true; });
    await p.disconnect();
    assert(fired, '"disconnect" event never fired');
});

await test('disconnect() prevents auto-reconnect from triggering', async () => {
    const p = new PLC({ host: HOST, port: PORT });
    p.on('error', () => {});
    await p.connect();
    await p.disconnect();
    await wait(300);
    assert(!p.isReconnecting, 'auto-reconnect started after intentional disconnect');
});

// ─────────────────────────────────────────────────────────────
//  SECTION 3 — Reading
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION 3: Reading');
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
    assert(data[1] !== undefined, 'string address not resolved as number key');
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
        assert(data[addr] !== undefined, `register ${addr} missing from result`);
    }
});

await test('read() empty array returns empty object', async () => {
    const data = await plc.read([]);
    assert(typeof data === 'object', 'expected object');
    assert(Object.keys(data).length === 0, 'expected empty result');
});

await test('concurrent read() calls all resolve', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => plc.read(1)));
    assert(results.every(r => r[1] !== undefined), 'some concurrent reads came back empty');
});

// ─────────────────────────────────────────────────────────────
//  SECTION 4 — Writing
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION 4: Writing');
console.log('══════════════════════════════════════');

await test('write() returns success status', async () => {
    const result: any = await plc.write(1, 99);
    assert(result?.Status === 'success', `expected success got ${result?.Status}`);
});

await test('write() then read() round-trips correctly', async () => {
    await plc.write(10, 1234);
    const data = await plc.read(10);
    assert(data[10]?.AddressValues[0] === 1234, `expected 1234 got ${data[10]?.AddressValues[0]}`);
});

await test('write() value 0 round-trips correctly', async () => {
    await plc.write(20, 0);
    const data = await plc.read(20);
    assert(data[20]?.AddressValues[0] === 0, `expected 0 got ${data[20]?.AddressValues[0]}`);
});

await test('write() max UInt16 (65535) round-trips correctly', async () => {
    await plc.write(21, 65535);
    const data = await plc.read(21);
    assert(data[21]?.AddressValues[0] === 65535, `expected 65535 got ${data[21]?.AddressValues[0]}`);
});

await test('writeCoil(true) echoes 0xFF00 in response', async () => {
    const result: any = await plc.writeCoil(1, true);
    assert(result?.Content?.Value === 0xFF00, `expected 0xFF00 got ${result?.Content?.Value}`);
});

await test('writeCoil(false) echoes 0x0000 in response', async () => {
    const result: any = await plc.writeCoil(1, false);
    assert(result?.Content?.Value === 0x0000, `expected 0x0000 got ${result?.Content?.Value}`);
});

await test('rapid sequential writes — last value wins', async () => {
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
    assert(data[150]?.AddressValues[0] === 777, `race condition? got ${data[150]?.AddressValues[0]}`);
});

// ─────────────────────────────────────────────────────────────
//  SECTION 5 — Watcher
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION 5: Watcher');
console.log('══════════════════════════════════════');

await test('watch() detects a value change and fires callback', async () => {
    await plc.write(100, 0);
    let changes: any = null;
    const watcher = await plc.watch(100, (c: Changes) => { changes = c; }, 50);
    watcher.on('error', () => {});

    await plc.write(100, 123);
    await wait(300);
    watcher.stop();

    assert(changes !== null, 'callback never fired');
    assert(changes[100]?.Value === 123, `wrong value: ${changes[100]?.Value}`);
    assert(changes[100]?.PrevValue === 0, `wrong prev: ${changes[100]?.PrevValue}`);
});

await test('watch() callback does NOT fire when value stays the same', async () => {
    await plc.write(101, 55);
    let callCount = 0;
    const watcher = await plc.watch(101, () => callCount++, 50);
    watcher.on('error', () => {});

    await wait(300);
    watcher.stop();

    assert(callCount === 0, `callback fired ${callCount} times for unchanged value`);
});

await test('watcher.stop() prevents any further callbacks', async () => {
    await plc.write(102, 0);
    let callCount = 0;
    const watcher = await plc.watch(102, () => callCount++, 50);
    watcher.on('error', () => {});
    watcher.stop();

    await plc.write(102, 99);
    await wait(300);

    assert(callCount === 0, `callback fired ${callCount} times after stop()`);
});

await test('watcher.pause() suppresses callback', async () => {
    await plc.write(103, 0);
    let callCount = 0;
    const watcher = await plc.watch(103, () => callCount++, 50);
    watcher.on('error', () => {});
    watcher.pause();

    await plc.write(103, 77);
    await wait(300);
    watcher.stop();

    assert(callCount === 0, `callback fired ${callCount} times while paused`);
});

await test('watcher.resume() re-enables callback after pause', async () => {
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

await test('"stop" event fires when watcher.stop() is called', async () => {
    const watcher = await plc.watch(1, () => {}, 50);
    watcher.on('error', () => {});
    let stopFired = false;
    watcher.on('stop', () => { stopFired = true; });
    watcher.stop();
    assert(stopFired, '"stop" event never emitted');
});

await test('"pause" and "resume" events fire correctly', async () => {
    const watcher = await plc.watch(1, () => {}, 50);
    watcher.on('error', () => {});
    let pauseFired = false, resumeFired = false;
    watcher.on('pause',  () => { pauseFired  = true; });
    watcher.on('resume', () => { resumeFired = true; });

    watcher.pause();
    await watcher.resume();
    watcher.stop();

    assert(pauseFired,  '"pause" event never emitted');
    assert(resumeFired, '"resume" event never emitted');
});

await test('watch() multiple registers — only changed ones appear in callback', async () => {
    await plc.write(110, 1); await plc.write(111, 2); await plc.write(112, 3);
    let changes: any = null;
    const watcher = await plc.watch([110, 111, 112], (c: Changes) => { changes = c; }, 50);
    watcher.on('error', () => {});

    await plc.write(111, 99);
    await wait(300);
    watcher.stop();

    assert(changes !== null, 'callback never fired');
    assert(changes[111] !== undefined, 'changed register not in callback');
    assert(changes[110] === undefined, 'unchanged reg 110 wrongly included');
    assert(changes[112] === undefined, 'unchanged reg 112 wrongly included');
});

await test('write() + watch() together: write triggers watcher callback', async () => {
    await plc.write(120, 0);
    let changes: any = null;
    const watcher = await plc.watch(120, (c: Changes) => { changes = c; }, 50);
    watcher.on('error', () => {});

    await plc.write(120, 4321);
    await wait(300);
    watcher.stop();

    assert(changes?.[120]?.Value === 4321, `expected 4321 got ${changes?.[120]?.Value}`);
});

await test('multiple watchers both fire independently', async () => {
    await plc.write(130, 0); await plc.write(131, 0);
    let change1: any = null, change2: any = null;
    const w1 = await plc.watch(130, (c: Changes) => { change1 = c; }, 50);
    const w2 = await plc.watch(131, (c: Changes) => { change2 = c; }, 50);
    w1.on('error', () => {}); w2.on('error', () => {});

    await plc.write(130, 11);
    await plc.write(131, 22);
    await wait(300);
    w1.stop(); w2.stop();

    assert(change1?.[130]?.Value === 11, `watcher1: ${change1?.[130]?.Value}`);
    assert(change2?.[131]?.Value === 22, `watcher2: ${change2?.[131]?.Value}`);
});

await test('stopping one watcher does not affect a sibling watcher', async () => {
    await plc.write(140, 0); await plc.write(141, 0);
    let change2: any = null;
    const w1 = await plc.watch(140, () => {}, 50);
    const w2 = await plc.watch(141, (c: Changes) => { change2 = c; }, 50);
    w1.on('error', () => {}); w2.on('error', () => {});

    w1.stop();
    await plc.write(141, 88);
    await wait(300);
    w2.stop();

    assert(change2?.[141]?.Value === 88, `sibling watcher broken: ${change2?.[141]?.Value}`);
});

await test('watcher.stop() called twice does not throw', async () => {
    const watcher = await plc.watch(1, () => {}, 50);
    watcher.on('error', () => {});
    watcher.stop();
    watcher.stop();
});

await test('watcher.resume() without prior pause does not throw', async () => {
    const watcher = await plc.watch(1, () => {}, 200);
    watcher.on('error', () => {});
    await watcher.resume();
    watcher.stop();
});

// ─────────────────────────────────────────────────────────────
//  SECTION 6 — Known bugs
// ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log(' SECTION 6: Known bugs');
console.log('══════════════════════════════════════');

await test('BUG: RetryDelay assigned from maxRetries instead of retryDelay', () => {
    const p = new PLC({ host: HOST, maxRetries: 3, retryDelay: 9000 });
    assert(p.RetryDelay !== 9000, 'Bug fixed — RetryDelay now correctly uses retryDelay 🎉');
});

// ─────────────────────────────────────────────────────────────
//  TEARDOWN & REPORT
// ─────────────────────────────────────────────────────────────

await plc.disconnect();

console.log('\n══════════════════════════════════════');
console.log(' RESULTS');
console.log('══════════════════════════════════════\n');
for (const line of log) console.log(line);
console.log(`\n  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('══════════════════════════════════════\n');

if (failed > 0) process.exit(1);