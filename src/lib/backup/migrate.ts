import { backupV1Schema, checkCaps, type BackupError, type BackupV1 } from './schema';
import { findUnsafeStructure } from './parse';

// The version hook (R7). Pure: no fs, network or db. Returns codes only; the UI builds the
// message ("This backup was made by a newer Cellar. Upgrade this instance first.").

export type MigrateResult =
  | { ok: true; doc: BackupV1 }
  | {
      ok: false;
      code: 'backup_version_unsupported' | 'backup_invalid';
      /** The version found in the file: a number, boolean or null as-is; 'string', 'array' or 'object' by kind. */
      version?: unknown;
      errors?: BackupError[];
    };

const MAX_REPORTED_ERRORS = 20;

/** The found version, safe to echo. A string version (like '1') is reported as 'string'. */
function describeVersion(v: unknown): unknown {
  // Attacker text is never echoed: only numbers and booleans pass through, the rest by kind.
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  return Array.isArray(v) ? 'array' : typeof v;
}

function parseV1(raw: unknown): MigrateResult {
  // Order matters: length caps first (they read `.length` only), then the structural walk,
  // which is linear in the input and must never see a list past its cap.
  const capErrors = checkCaps(raw);
  if (capErrors.length > 0)
    return { ok: false, code: 'backup_invalid', errors: capErrors.slice(0, MAX_REPORTED_ERRORS) };
  const unsafe = findUnsafeStructure(raw);
  if (unsafe) return { ok: false, code: 'backup_invalid', errors: [{ path: '', code: unsafe }] };
  const parsed = backupV1Schema.safeParse(raw);
  if (parsed.success) return { ok: true, doc: parsed.data };
  return {
    ok: false,
    code: 'backup_invalid',
    errors: parsed.error.issues.slice(0, MAX_REPORTED_ERRORS).map((i) => ({
      path: i.path.map(String).join('.'),
      code: i.code === 'custom' ? i.message : i.code,
    })),
  };
}

/**
 * Turn any parsed backup into the current document shape (v1) or a typed failure.
 *
 * Adding v2 later: add `backupV2Schema` and a `parseV2`, make v2 the current type, and chain
 * the older versions through it so every reader step stays small and testable:
 *
 *   case 1: { const r = parseV1(raw); return r.ok ? { ok: true, doc: upgradeV1ToV2(r.doc) } : r; }
 *   case 2: return parseV2(raw);
 *
 * `upgradeV1ToV2` is a pure function over validated data. Versions above the newest known
 * one stay in `default`: a newer Cellar wrote them, this instance must be upgraded first.
 */
export function migrateBackup(raw: unknown): MigrateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'backup_invalid', errors: [{ path: '', code: 'not_an_object' }] };
  }
  if (!Object.hasOwn(raw, 'version')) {
    return { ok: false, code: 'backup_invalid', errors: [{ path: 'version', code: 'required' }] };
  }
  const version = (raw as { version: unknown }).version;
  switch (version) {
    case 1:
      return parseV1(raw);
    default:
      // Not 1: a newer number, a string like '1', null, a float. All are "not a version we read".
      return { ok: false, code: 'backup_version_unsupported', version: describeVersion(version) };
  }
}
