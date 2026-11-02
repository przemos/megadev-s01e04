import type { DigestNight } from '../digest/types.js';

export function Digest({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>
        events: {digest.counts.ok} ok · {digest.counts.retry} retry · {digest.counts.fail} fail
      </p>
      <p class={digest.badLines > 0 ? 'warn' : 'mute'}>bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first time</th>
              <th scope="col">last time</th>
              <th scope="col">any failure</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <th scope="row">{row.job}</th>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>
                  {row.retries}{row.retries >= 3 ? ' · high retries' : ''}
                </td>
                <td>{row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td><time datetime={row.firstAt}>{row.firstAt}</time></td>
                <td><time datetime={row.lastAt}>{row.lastAt}</time></td>
                <td class={row.failed ? 'warn' : undefined}>{row.failed ? 'failed' : 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
