import {
  ENTITY_STORE_NAMES,
  type EntityStoreName,
  type StoreEntityMap,
} from '../domain/models/stores';

/**
 * The storage layer's view of the store list.
 *
 * The list itself lives in `domain/models/stores.ts`, because the backup
 * format needs it and `domain/` may not import from `data/`. Re-exported here
 * so storage code keeps importing it from the layer it belongs to.
 *
 * `appMeta` and `photoBlobs` are absent from the entity map on purpose:
 * neither holds `Entity` records. appMeta is a key/value table of app-local
 * pointers, and photoBlobs holds raw pixels. Both get their own narrow
 * accessors rather than being forced through a repository that would stamp
 * them with a sync envelope they have no use for.
 */
export type { EntityStoreName, StoreEntityMap };
export { ENTITY_STORE_NAMES };

export type StoreName = EntityStoreName | 'appMeta' | 'photoBlobs';

export const STORE_NAMES: readonly StoreName[] = [...ENTITY_STORE_NAMES, 'appMeta', 'photoBlobs'];
