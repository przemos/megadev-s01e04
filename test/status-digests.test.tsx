import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { nightsOnDisk, readStatus } from '../src/status.js';

describe('status board digest summaries', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(process.cwd(), '.status-board-fixtures-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function config() {
    return {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  }

  it('counts all valid events, not final job statuses, and links every night newest first', async () => {
    const event = (status: string) => JSON.stringify({
      at: '2026-10-29T01:00:00+01:00', job: 'recovered', owner: null, status,
    });
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      event('fail'), event('retry'), event('retry'), event('ok'), event('ok'),
      '{broken', event('unknown'), '',
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'not a run log');
    writeFileSync(join(runsDir, 'latest.jsonl'), '');

    expect(readStatus(config()).nights).toEqual([
      { night: '2026-10-28', counts: { ok: 2, retry: 2, fail: 1 } },
      { night: '2026-10-27', counts: { ok: 0, retry: 0, fail: 0 } },
    ]);

    const response = await createApp(config()).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · 2 ok / 2 retry / 1 fail events');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · 0 ok / 0 retry / 0 fail events');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('notes.txt');
    expect(html).not.toContain('/digest/latest');
  });

  it('shows the empty message for an empty or missing runs directory', async () => {
    for (const directory of [runsDir, join(runsDir, 'missing')]) {
      const response = await createApp({ ...config(), runsDir: directory }).request('/');
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('nothing in runs/');
    }
  });

  it('propagates operational directory errors instead of showing an empty board', () => {
    const file = join(runsDir, 'not-a-directory');
    writeFileSync(file, '');
    expect(() => nightsOnDisk(file)).toThrow();
    expect(() => readStatus({ ...config(), runsDir: file })).toThrow();
  });

  it('propagates errors reading a listed night instead of hiding it', () => {
    mkdirSync(join(runsDir, '2026-10-28.jsonl'));
    expect(() => readStatus(config())).toThrow();
  });
});
