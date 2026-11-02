import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { DigestNight, ReadNight } from '../src/digest/types.js';

vi.mock('../src/digest/reader.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/digest/reader.js')>(),
  readNight: vi.fn<ReadNight>(),
}));

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'json-test-runs',
};

describe('digest JSON', () => {
  beforeEach(() => {
    vi.mocked(readNight).mockReset();
  });

  it('returns the full reader result without changing row order or null owners', async () => {
    const digest: DigestNight = {
      night: '2026-10-28',
      rows: [
        {
          job: 'Z-job',
          owner: null,
          runs: 2,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'try again',
          firstAt: '2026-10-28T01:00:00+01:00',
          lastAt: '2026-10-28T01:01:00+01:00',
          failed: false,
        },
        {
          job: 'a-job',
          owner: 'reader',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: null,
          firstAt: '2026-10-28T02:00:00+01:00',
          lastAt: '2026-10-28T02:00:00+01:00',
          failed: true,
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 1 },
    };
    vi.mocked(readNight).mockReturnValue(digest);

    const res = await createApp(config).request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, digest.night);
  });

  it.each(['2026-1-02', 'not-a-night', '2026-10-28.jsonl'])(
    'rejects invalid night %s before reading',
    async (night) => {
      const res = await createApp(config).request(`/api/digest/${night}`);

      expect(res.status).toBe(400);
      expect(readNight).not.toHaveBeenCalled();
    },
  );

  it('passes operational reader errors to the application error handler', async () => {
    const error = new Error('permission denied');
    vi.mocked(readNight).mockImplementation(() => {
      throw error;
    });
    const app = createApp(config);
    const onError = vi.fn((_error: Error) => new Response('reader failed', { status: 500 }));
    app.onError(onError);

    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(500);
    expect(onError.mock.calls[0]?.[0]).toBe(error);
  });
});
