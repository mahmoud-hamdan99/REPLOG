import { InjectionToken } from '@angular/core';

/**
 * Identifier source.
 *
 * Repositories assign an id when none is supplied, but some operations need
 * ids *before* the write: duplicating a plan has to link the copied routines
 * to the copied plan, and the active workout has to reference set logs it is
 * about to create. Exposing the generator as a contract keeps those callers
 * out of the infrastructure layer and lets a test make ids deterministic.
 */
export interface IdFactory {
  newId(): string;
}

export const ID_FACTORY = new InjectionToken<IdFactory>('ID_FACTORY');
