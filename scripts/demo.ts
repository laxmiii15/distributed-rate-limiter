/**
 * Proves the three things that matter about this limiter:
 *
 *   1. ATOMIC under concurrency — fire 20 requests at once, exactly `limit`
 *      get through. No race lets a 6th slip past.
 *   2. TOKEN BUCKET refills — exhaust it, wait, watch capacity come back.
 *   3. DISTRIBUTED — the same limit is enforced across TWO app instances
 *      sharing one Redis (the reason this lives in Redis, not in memory).
 *
 * Run Redis + one instance for tests 1-2. For test 3, start a second instance:
 *     PORT=3001 npm run start:prod
 *
 *   npm run demo
 */
const A = process.env.BASE_URL ?? 'http://localhost:3000';
const B = process.env.BASE_URL_2 ?? 'http://localhost:3001';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function hit(base: string, path: string, key: string): Promise<number> {
  const res = await fetch(`${base}${path}`, { headers: { 'x-api-key': key } });
  return res.status;
}

interface Tally {
  ok: number;
  limited: number;
  other: number;
}

function tally(codes: number[]): Tally {
  return {
    ok: codes.filter((c) => c === 200).length,
    limited: codes.filter((c) => c === 429).length,
    other: codes.filter((c) => c !== 200 && c !== 429).length,
  };
}

function line(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}  ${label} — ${detail}`);
}

async function reachable(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function testAtomic(): Promise<void> {
  console.log('\n1) Atomicity — 20 simultaneous requests, limit is 5/10s\n');
  const key = `sw-${Date.now()}`;
  const codes = await Promise.all(
    Array.from({ length: 20 }, () => hit(A, '/sliding', key)),
  );
  const t = tally(codes);
  line(
    'sliding-window',
    t.ok === 5 && t.limited === 15,
    `${t.ok} allowed (expected 5), ${t.limited} rejected with 429`,
  );
}

async function testRefill(): Promise<void> {
  console.log('\n2) Token bucket — capacity 10, refills 1 token/sec\n');
  const key = `tb-${Date.now()}`;

  const first = tally(
    await Promise.all(Array.from({ length: 15 }, () => hit(A, '/bucket', key))),
  );
  line(
    'initial burst',
    first.ok === 10,
    `${first.ok} allowed (expected 10 — full bucket), ${first.limited} rejected`,
  );

  console.log('     …waiting 3s for refill…');
  await sleep(3100);

  const after = tally(
    await Promise.all(Array.from({ length: 10 }, () => hit(A, '/bucket', key))),
  );
  line(
    'after refill',
    after.ok >= 2 && after.ok <= 4,
    `${after.ok} allowed (expected ~3 refilled tokens)`,
  );
}

async function testDistributed(): Promise<void> {
  console.log('\n3) Distributed — one limit across TWO instances\n');
  if (!(await reachable(B))) {
    console.log(
      `  ⏭️  SKIP — no second instance at ${B}.\n` +
        `      Start one with:  PORT=3001 npm run start:prod`,
    );
    return;
  }

  const key = `dist-${Date.now()}`;
  // Alternate the same caller across both instances, all at once.
  const targets = Array.from({ length: 20 }, (_, i) => (i % 2 ? B : A));
  const codes = await Promise.all(targets.map((base) => hit(base, '/sliding', key)));
  const t = tally(codes);
  line(
    'shared bucket',
    t.ok === 5,
    `${t.ok} allowed across both instances (expected 5 — limit is global, not per-instance)`,
  );
}

async function main(): Promise<void> {
  if (!(await reachable(A))) {
    console.error(`No app at ${A}. Start it: npm run start:prod`);
    process.exit(1);
  }
  console.log('Rate limiter demo');
  await testAtomic();
  await testRefill();
  await testDistributed();
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
