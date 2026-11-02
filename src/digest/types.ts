export type DigestStatus = 'ok' | 'retry' | 'fail';

/**
 * One job's valid events, ordered by timestamp (file order breaks ties).
 * Timestamp strings retain their original offsets.
 */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including an explicit null. */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  /** Number of events whose status is retry. */
  retries: number;
  lastStatus: DigestStatus;
  /** Most recent error string, retained after recovery; null if none occurred. */
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  /** True if any event failed, even when the latest event succeeded. */
  failed: boolean;
};

/** Counts of valid events, not jobs or their final statuses. */
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type DigestNight = {
  night: string;
  /** One row per job, ascending by case-sensitive string comparison. */
  rows: DigestRow[];
  /** Nonblank lines containing invalid JSON or an invalid event record. */
  badLines: number;
  counts: DigestCounts;
};

/**
 * Synchronously reads runsDir/<night>.jsonl; night is YYYY-MM-DD.
 * The implementation will export readNight from src/digest/reader.ts.
 *
 * A valid record is an object with a nonempty job, a valid ISO 8601 timestamp
 * with an explicit offset in at, a DigestStatus status, and a string or null
 * owner. Optional error must be a string; additional fields are ignored.
 * Invalid records are skipped and counted in badLines; blank lines are ignored.
 * Events are ordered by instant, not by their timestamp strings.
 *
 * An empty file returns empty rows, zero badLines and zero event counts.
 * Only a missing file (ENOENT) returns null. Other filesystem errors propagate.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
