import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+01:00';
const lastAt = '2026-10-28T01:04:00+01:00';
const routes = ['/digest', '/api/digest'];

function event(
  job: string,
  status: 'ok' | 'retry' | 'fail' = 'ok',
  owner: string | null = 'Ada',
  at = firstAt,
  error?: string,
) {
  return JSON.stringify({ job, status, owner, at, ...(error ? { error } : {}) });
}

function text(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

function tableRows(html: string) {
  const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  expect(tables).toHaveLength(1);
  return (tables[0]!.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [])
    .filter((row) => /<td\b/i.test(row))
    .map((markup) => ({
      markup,
      cells: (markup.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(text),
    }));
}

// Accept either visible labels or emphasis/styling, without prescribing CSS names.
function emphasis(markup: string) {
  return markup.match(
    /\b(?:class|style)\s*=\s*(?:"[^"]*"|'[^']*')|<(?:mark|strong|b)\b[^>]*>/gi,
  ) ?? [];
}

function expectMarked(markup: string, ordinary: string, label: RegExp) {
  const ordinaryEmphasis = new Set(emphasis(ordinary));
  const hasDistinctEmphasis = emphasis(markup).some((value) => !ordinaryEmphasis.has(value));
  expect(hasDistinctEmphasis || label.test(text(markup))).toBe(true);
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runsDir = mkdtempSync(join(process.cwd(), '.digest-route-tests-'));
    app = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
  });

  afterEach(() => {
    if (runsDir) rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  it('returns the full JSON digest with aggregated rows and event counts', async () => {
    writeNight([
      event('zeta'),
      event('Alpha', 'ok', null, lastAt),
      event('Alpha', 'fail', 'Ada', firstAt, 'connection reset'),
      event('Alpha', 'retry', null, '2026-10-28T01:01:00+01:00'),
    ]);

    const response = await app.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const expected: DigestNight = {
      night,
      rows: [
        {
          job: 'Alpha', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
          lastError: 'connection reset', firstAt, lastAt, failed: true,
        },
        {
          job: 'zeta', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt, lastAt: firstAt, failed: false,
        },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 1, fail: 1 },
    };
    expect(await response.json()).toEqual(expected);
  });

  it('serves HTML with the same case-sensitive sorted jobs as JSON, including null owners', async () => {
    writeNight([event('zeta'), event('alpha'), event('Alpha', 'ok', null)]);
    const [json, html] = await Promise.all([
      app.request(`/api/digest/${night}`),
      app.request(`/digest/${night}`),
    ]);
    expect(json.status).toBe(200);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toMatch(/text\/html/);
    const digest = await json.json() as DigestNight;
    expect(digest.rows.map((row) => row.job)).toEqual(['Alpha', 'alpha', 'zeta']);
    const rows = tableRows(await html.text());
    expect(rows).toHaveLength(digest.rows.length);
    expect(rows.map((row) => row.cells.find((cell) =>
      digest.rows.some((job) => job.job === cell),
    ))).toEqual(digest.rows.map((row) => row.job));
    const nullOwner = rows.find((row) => row.cells.includes('Alpha'));
    expect(nullOwner?.cells).toContain('—');
    expect(rows.find((row) => row.cells.includes('alpha'))?.cells).toContain('Ada');
  });

  it.each(routes)('%s returns 404 when the night file does not exist', async (route) => {
    expect((await app.request(`${route}/${night}`)).status).toBe(404);
  });

  it('returns an empty JSON digest for an empty file', async () => {
    writeNight([]);
    const response = await app.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('says nothing ran on the HTML page for an empty file', async () => {
    writeNight([]);
    const response = await app.request(`/digest/${night}`);
    expect(response.status).toBe(200);
    expect(text(await response.text())).toMatch(/nothing ran/i);
  });

  it('counts malformed records while preserving valid jobs in both representations', async () => {
    writeNight([
      event('zeta'),
      '{broken JSON',
      '',
      '  ',
      JSON.stringify({ job: 'invalid', at: firstAt, status: 'unknown', owner: null }),
      event('Alpha', 'ok', null),
    ]);
    const json = await app.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    const digest = await json.json() as DigestNight;
    expect(digest.badLines).toBe(2);
    expect(digest.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest.rows.map((row) => row.job)).toEqual(['Alpha', 'zeta']);

    const html = await app.request(`/digest/${night}`);
    expect(html.status).toBe(200);
    const rows = tableRows(await html.text());
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toContain('Alpha');
    expect(rows[1].cells).toContain('zeta');
  });

  it.each([3, 4])('marks %i retries and a recovered failure, not just the latest status', async (retries) => {
    writeNight([
      event('ordinary'),
      ...Array.from({ length: retries }, (_, minute) =>
        event('retried', 'retry', 'Ada', `2026-10-28T01:0${minute}:00+01:00`),
      ),
      event('retried', 'ok', 'Ada', lastAt),
      event('recovered', 'fail', 'Ada', firstAt, 'connection reset'),
      event('recovered', 'ok', 'Ada', lastAt),
    ]);
    const json = await app.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    const digest = await json.json() as DigestNight;
    expect(digest.rows.find((row) => row.job === 'retried')).toMatchObject({
      retries, lastStatus: 'ok', failed: false,
    });
    expect(digest.rows.find((row) => row.job === 'recovered')).toMatchObject({
      lastStatus: 'ok', failed: true, lastError: 'connection reset',
    });

    const html = await app.request(`/digest/${night}`);
    expect(html.status).toBe(200);
    const rows = tableRows(await html.text());
    const ordinary = rows.find((row) => row.cells.includes('ordinary'))!;
    const retried = rows.find((row) => row.cells.includes('retried'))!;
    const recovered = rows.find((row) => row.cells.includes('recovered'))!;
    expect(ordinary).toBeDefined();
    expect(retried).toBeDefined();
    expect(recovered).toBeDefined();
    expect(text(retried.markup)).toMatch(new RegExp(`\\b${retries}\\b`));
    expectMarked(retried.markup, ordinary.markup, /warning|excessive|[34]\s+retries|⚠|!/i);
    expectMarked(recovered.markup, ordinary.markup, /fail|⚠|!/i);
  });

  it.each(routes)('%s rejects unsafe night paths', async (route) => {
    writeNight([event('private-job')]);
    for (const unsafe of [
      'not-a-date', '%2e%2e%2f2026-10-28', '2026-10-28%2f..',
      '2026-10-28%5c..', '2026-10-28.jsonl', '2026-10-28%00',
    ]) {
      const response = await app.request(`${route}/${unsafe}`);
      expect([400, 404], unsafe).toContain(response.status);
    }
  });
});
