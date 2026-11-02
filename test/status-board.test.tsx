import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Status } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

const status: Status = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  lastBeat: null,
  nights: [
    { night: '2026-10-28', counts: { ok: 10, retry: 4, fail: 1 } },
    { night: '2026-10-27', counts: { ok: 0, retry: 0, fail: 0 } },
  ],
};

async function render(boardStatus: Status) {
  const app = new Hono();
  app.get('/', (c) => c.html(<StatusBoard status={boardStatus} />));
  return (await app.request('/')).text();
}

describe('status board view', () => {
  it('links every night and labels event counts, including zero counts', async () => {
    const html = await render(status);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · 10 ok / 4 retry / 1 fail events');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · 0 ok / 0 retry / 0 fail events');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).toContain('shim');
    expect(html).toContain('2026-10-29T14:06:00+01:00');
    expect(html).toContain('<span class="warn">none</span>');
  });

  it('preserves the empty-directory message without digest links', async () => {
    const html = await render({ ...status, nights: [] });
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });
});
