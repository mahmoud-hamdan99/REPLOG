/**
 * The schema version this build expects the database to be at.
 *
 * In `data/` rather than beside the IndexedDB schema because the integrity
 * check needs it and features may not reach into `infrastructure/`. The
 * schema imports this constant, so bumping it in one place still bumps it
 * everywhere; what moved is only which layer owns the fact.
 *
 * Bump for any store or index change, and add a matching migration.
 * Forward-only: see infrastructure/idb/migrations/index.ts.
 */
export const EXPECTED_SCHEMA_VERSION = 1;
