import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidNight, readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = join(process.cwd(), `.reader-test-${randomUUID()}`);
  mkdirSync(dir);
  scratchDirs.push(dir);
  return dir;
}

function fixture(lines: unknown[]): string {
  const dir = scratchDir();
  writeFileSync(join(dir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  return dir;
}

function event(overrides: Record<string, unknown> = {}) {
  return { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides };
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the original sample without modifying it: five jobs and one bad line', () => {
    const digest = readNight('runs', night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00', failed: false,
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', failed: false,
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok',
          lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00', failed: false,
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail',
          lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00', failed: true,
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00', failed: false,
        },
      ],
    });
  });

  it('orders events by instant, retains offsets and errors after recovery, and uses the latest owner', () => {
    const dir = fixture([
      event({ at: '2026-10-29T01:00:00+02:00', owner: null }),
      event({ at: '2026-10-28T23:30:00+01:00', status: 'retry', error: 'latest error' }),
      event({ at: '2026-10-28T22:00:00Z', status: 'fail', error: 'earlier error' }),
    ]);
    expect(readNight(dir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: 'latest error', firstAt: '2026-10-28T22:00:00Z',
        lastAt: '2026-10-29T01:00:00+02:00', failed: true,
      }],
    });
  });

  it('breaks equal-instant ties in file order and preserves an empty error', () => {
    const dir = fixture([
      event({ at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first' }),
      event({ at: '2026-10-28T22:00:00Z', status: 'retry', error: '' }),
      event({ at: '2026-10-28T23:00:00+01:00', owner: null }),
    ]);
    expect(readNight(dir, night)?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: '',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T23:00:00+01:00', failed: true,
    });
  });

  it('orders fractional timestamps more precise than JavaScript milliseconds', () => {
    const dir = fixture([
      event({ at: '2026-10-28T22:00:00.1239Z', owner: null }),
      event({ at: '2026-10-28T23:00:00.123100+01:00', status: 'fail', error: 'earlier' }),
      event({ at: '2026-10-28T22:00:00.1231Z', status: 'retry', error: 'tied later in file' }),
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      owner: null, firstAt: '2026-10-28T23:00:00.123100+01:00',
      lastAt: '2026-10-28T22:00:00.1239Z', lastStatus: 'ok',
      lastError: 'tied later in file', failed: true,
    });
  });

  it('sorts jobs by case-sensitive string comparison and handles object-like job names', () => {
    const jobs = ['z', 'a', '__proto__', 'constructor', 'Z', 'A'];
    const dir = fixture(jobs.map((job) => event({ job, extra: 'ignored' })));
    expect(readNight(dir, night)?.rows.map((row) => row.job)).toEqual([
      'A', 'Z', '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it('retains the most recent error even when it belongs to a successful event', () => {
    const dir = fixture([
      event({ at: '2026-10-28T23:02:00+01:00', error: 'latest diagnostic' }),
      event({ at: '2026-10-28T23:01:00+01:00', status: 'fail', error: 'old failure' }),
    ]);
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      lastStatus: 'ok', lastError: 'latest diagnostic', failed: true,
    });
  });

  it('counts malformed JSON and invalid records once each, ignoring blank lines', () => {
    const invalid = [
      null, [], 'text', 1, true, {},
      event({ at: null }), event({ at: 'yesterday' }), event({ at: '2026-10-28T23:00:00' }),
      event({ at: '2026-02-30T23:00:00Z' }), event({ at: '2026-10-28T25:00:00Z' }),
      event({ at: '2026-10-28T23:60:00Z' }), event({ at: '2026-10-28T23:00:60Z' }),
      event({ at: '2026-10-28T23:00:00+24:00' }), event({ at: '2026-10-28T23:00:00+01:60' }),
      event({ job: '' }), event({ job: '  ' }), event({ job: 1 }),
      event({ status: 'unknown' }), event({ status: null }),
      event({ owner: false }), event({ owner: 1 }), event({ error: null }), event({ error: {} }),
      ...['at', 'job', 'status', 'owner'].map((key) => {
        const record: Record<string, unknown> = event();
        delete record[key];
        return record;
      }),
    ];
    const dir = scratchDir();
    writeFileSync(join(dir, `${night}.jsonl`),
      `\r\n  \t\r\n{broken}\r\n${[...invalid, event({ owner: null })].map((line) => JSON.stringify(line)).join('\r\n')}\r\n`);
    const digest = readNight(dir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].owner).toBeNull();
  });

  it('accepts leap dates, fractional seconds, and ISO explicit offset forms without rewriting them', () => {
    const timestamps = [
      '2024-02-29T01:00:00.123Z', '2024-02-29T02:00:00+0100',
      '2024-02-29T03:00:00+01', '2024-02-29T03:00:00-01:30',
    ];
    const dir = fixture(timestamps.map((at, index) => event({ at, job: String(index) })));
    const digest = readNight(dir, night);
    expect(digest?.badLines).toBe(0);
    expect(digest?.rows.map((row) => row.firstAt)).toEqual(timestamps);
  });

  it.each(['', ' \r\n\t\n'])('returns an empty digest for an empty or blank file (%j)', (contents) => {
    const dir = scratchDir();
    writeFileSync(join(dir, `${night}.jsonl`), contents);
    expect(readNight(dir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null only when the file or its parent is missing', () => {
    const dir = scratchDir();
    expect(readNight(dir, night)).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
  });

  it('propagates filesystem errors other than ENOENT', () => {
    const dir = scratchDir();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    const notDirectory = join(dir, 'file');
    writeFileSync(notDirectory, '');
    expect(() => readNight(notDirectory, night)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
  });

  it.each([
    '../2026-10-28', '../../outside', '/2026-10-28', '2026-10-28/..',
    '2026-10-28\\..', '2026-10-28.jsonl', '2026-1-01', '2026-10-28\n',
    '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00',
  ])('rejects invalid night %j before attempting a read', (invalid) => {
    expect(isValidNight(invalid)).toBe(false);
    expect(() => readNight(join(scratchDir(), 'missing'), invalid)).toThrow(RangeError);
  });

  it.each(['2026-10-28', '2024-02-29', '2000-02-29'])('accepts valid filename date %s', (valid) => {
    expect(isValidNight(valid)).toBe(true);
  });
});
