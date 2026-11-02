import { inject, Service } from '@angular/core';
import { CLOCK } from '../../data/clock';
import { createUuidV7, type RandomSource } from '../../domain/ids/uuidv7';

/**
 * Cryptographic randomness where available.
 *
 * Ids are not secrets, but `Math.random` is a poor entropy source and these
 * values may have to be unique across devices once sync exists, so the better
 * source is used when the platform offers it.
 */
const cryptoRandom: RandomSource = () => {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 0x100000000;
  }
  return Math.random();
};

/**
 * The envelope values every write needs: current time, a fresh id, and the
 * device that is writing.
 *
 * Isolated here so the repository has no opinion about where they come from,
 * and so a test can drive them deterministically.
 */
@Service()
export class IdbEnvironment {
  private readonly clock = inject(CLOCK);
  private readonly generateId = createUuidV7(cryptoRandom);

  /**
   * Replaced during startup with the persisted device id. Until then writes are
   * attributed to 'unknown', which is harmless: `origin` is only a conflict
   * hint for a future sync, never an identity or an access check.
   */
  private deviceId = 'unknown';

  nowIso(): string {
    return this.clock.nowIso();
  }

  newId(): string {
    return this.generateId(this.clock.now());
  }

  origin(): string {
    return this.deviceId;
  }

  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId;
  }
}
