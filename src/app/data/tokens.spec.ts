import { APP_META_STORE } from './app-meta';
import { CLOCK } from './clock';
import { DB_EVENTS } from './db-events';
import { PHOTO_BLOB_STORE } from './photo-blobs';
import { PREFS_STORE } from './prefs';
import { ENTITY_STORE_NAMES, STORE_NAMES } from './stores';
import { REPOSITORY_TOKENS } from './tokens';
import { UNIT_OF_WORK } from './unit-of-work';

/**
 * Injection tokens are compared by identity, so a copy-paste that reuses one
 * token for two stores would silently resolve the wrong repository — a bug
 * that surfaces as mysteriously missing data rather than as a type error.
 */
describe('data layer tokens', () => {
  it('declares a repository token for every entity store', () => {
    expect(Object.keys(REPOSITORY_TOKENS).sort()).toEqual([...ENTITY_STORE_NAMES].sort());
  });

  it('gives every repository a distinct token', () => {
    const tokens = Object.values(REPOSITORY_TOKENS);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('gives every service token a distinct identity', () => {
    const tokens = [
      APP_META_STORE,
      CLOCK,
      DB_EVENTS,
      PHOTO_BLOB_STORE,
      PREFS_STORE,
      UNIT_OF_WORK,
      ...Object.values(REPOSITORY_TOKENS),
    ];
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('covers the entity stores plus the two that are not entities', () => {
    // appMeta and photoBlobs hold no Entity records and get narrow accessors
    // instead of repositories.
    expect([...STORE_NAMES].sort()).toEqual(
      [...ENTITY_STORE_NAMES, 'appMeta', 'photoBlobs'].sort(),
    );
  });

  it('describes each token, so a DI failure names the missing provider', () => {
    for (const [store, token] of Object.entries(REPOSITORY_TOKENS)) {
      expect(String(token), `token for ${store}`).toContain('REPO');
    }
  });
});
