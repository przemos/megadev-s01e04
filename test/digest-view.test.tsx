import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestNight, DigestRow } from '../src/digest/types.js';
import { Digest } from '../src/views/digest.js';
import { Layout } from '../src/views/layout.js';

const row: DigestRow = {
  job: 'alpha',
  owner: null,
  runs: 5,
  retries: 3,
  lastStatus: 'ok',
  lastError: 'failed <upstream>',
  firstAt: '2026-10-28T01:00:00+02:00',
  lastAt: '2026-10-28T01:30:00+01:00',
  failed: true,
};

async function render(digest: DigestNight) {
  const app = new Hono();
  app.get('/', (c) => c.html(
    <Layout title="digest" lane={{ id: 'test-lane', marker: 'test-marker' }}>
      <Digest digest={digest} />
    </Layout>,
  ));
  const response = await app.request('/');
  expect(response.status).toBe(200);
  return response.text();
}

describe('digest view', () => {
  it('renders all fields, event counts, bad lines, and the existing lane layout', async () => {
    const html = await render({
      night: '2026-10-28',
      rows: [row],
      badLines: 1,
      counts: { ok: 1, retry: 3, fail: 1 },
    });

    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('test-lane');
    expect(html).toContain('test-marker');
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
    expect(html).toContain('events: 1 ok · 3 retry · 1 fail');
    expect(html).toContain('<p class="warn">bad lines: 1</p>');
    expect(html).toContain('<th scope="row">alpha</th><td>—</td><td>5</td>');
    expect(html).toContain('<td class="warn">3 · high retries</td>');
    expect(html).toContain('<td>ok</td>');
    expect(html).toContain('failed &lt;upstream&gt;');
    expect(html).toContain(`<time datetime="${row.firstAt}">${row.firstAt}</time>`);
    expect(html).toContain(`<time datetime="${row.lastAt}">${row.lastAt}</time>`);
    expect(html).toContain('<td class="warn">failed</td>');
  });

  it('retains reader order and leaves low retries and nonfailures unmarked', async () => {
    const html = await render({
      night: '2026-10-28',
      rows: [
        { ...row, job: 'Zulu', owner: 'team <one>', retries: 2, failed: false, lastError: null },
        { ...row, job: 'alpha' },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 5, fail: 1 },
    });

    expect(html.indexOf('>Zulu</th>')).toBeLessThan(html.indexOf('>alpha</th>'));
    expect(html).toContain('<td>team &lt;one&gt;</td>');
    expect(html).toContain('<td>2</td><td>ok</td><td>—</td>');
    expect(html).toContain('<td>none</td>');
    expect(html).toContain('<p class="mute">bad lines: 0</p>');
  });

  it('renders an empty night without hiding skipped lines', async () => {
    const html = await render({
      night: '2026-10-29',
      rows: [],
      badLines: 2,
      counts: { ok: 0, retry: 0, fail: 0 },
    });

    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 2');
    expect(html).toContain('events: 0 ok · 0 retry · 0 fail');
    expect(html).not.toContain('<table>');
  });
});
