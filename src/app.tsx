import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { isValidNight, readNight } from './digest/reader.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    if (!isValidNight(night)) {
      return c.json({ error: 'Invalid night; expected YYYY-MM-DD' }, 400);
    }

    const digest = readNight(config.runsDir, night);
    if (digest === null) return c.notFound();

    return c.json(digest);
  });

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    if (!isValidNight(night)) {
      return c.text('invalid night: expected YYYY-MM-DD', 400);
    }

    const digest = readNight(config.runsDir, night);
    if (digest === null) return c.text('night not found', 404);

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <Digest digest={digest} />
      </Layout>,
    );
  });

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}
