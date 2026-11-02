import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Event = {
  at: string;
  instant: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isCalendarDate(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/**
 * Whether a route parameter is a real YYYY-MM-DD calendar date and safe filename.
 * readNight throws RangeError for invalid nights before accessing the filesystem.
 */
export function isValidNight(night: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(night)
    && isCalendarDate(Number(night.slice(0, 4)), Number(night.slice(5, 7)), Number(night.slice(8, 10)));
}

function timestampInstant(at: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(at);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction, zone, sign, zoneHour, zoneMinute] = match;
  if (!isCalendarDate(Number(year), Number(month), Number(day))
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== 'Z' && (Number(zoneHour) > 23 || Number(zoneMinute ?? 0) > 59))) {
    return null;
  }
  const offset = zone === 'Z' ? 'Z' : `${sign}${zoneHour}:${zoneMinute ?? '00'}`;
  const instant = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ''}${offset}`);
  return Number.isFinite(instant) ? instant : null;
}

function parseEvent(value: unknown): Event | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('at' in value) || typeof value.at !== 'string'
    || !('job' in value) || typeof value.job !== 'string' || value.job.trim().length === 0
    || !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')
    || !('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')
    || ('error' in value && typeof value.error !== 'string')) {
    return null;
  }
  const instant = timestampInstant(value.at);
  if (instant === null) return null;
  const error = 'error' in value ? value.error : undefined;
  return {
    at: value.at,
    instant,
    job: value.job,
    status: value.status,
    owner: value.owner,
    ...(typeof error === 'string' ? { error } : {}),
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isValidNight(night)) throw new RangeError('Night must be a valid YYYY-MM-DD date');
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  let badLines = 0;
  const events: Event[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const event = parseEvent(value);
    if (event) events.push(event);
    else badLines++;
  }

  events.sort((a, b) => {
    const difference = a.instant - b.instant;
    if (difference) return difference;
    // Date.parse truncates submilliseconds; compare remaining precision before tying.
    const aFraction = /\.(\d+)/.exec(a.at)?.[1] ?? '';
    const bFraction = /\.(\d+)/.exec(b.at)?.[1] ?? '';
    const precision = Math.max(aFraction.length, bFraction.length);
    const left = aFraction.padEnd(precision, '0');
    const right = bFraction.padEnd(precision, '0');
    // Stable sorting leaves equal instants in file order.
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const counts = { ok: 0, retry: 0, fail: 0 };
  const jobs = new Map<string, DigestRow>();
  for (const event of events) {
    counts[event.status]++;
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
        failed: false,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.failed = true;
    if (event.error !== undefined) row.lastError = event.error;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
  }
  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
