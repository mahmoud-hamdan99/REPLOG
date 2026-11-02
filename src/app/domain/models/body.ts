import type { Entity, Flag } from './entity';
import type { MeasurementUnitType, Pose, RecordSource } from './enums';

/**
 * Body measurements. Every field is nullable because partial entries are the
 * normal case: most days a user only weighs themselves. Charts plot the
 * non-null points and leave real gaps.
 */
export interface Measurement extends Entity {
  /** Local calendar day. Several entries per day are allowed. */
  measuredAt: string;
  /** Actual entry instant, for ordering within a day. */
  recordedAt: string;
  weightKg: number | null;
  /** Indexable mirror of `weightKg !== null`. See `Flag` in entity.ts. */
  hasWeight: Flag;
  bodyFatPct: number | null;
  heightCm: number | null;
  neckCm: number | null;
  shouldersCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  /**
   * Not in the PRODUCT_SPEC list, but it is the one standard circumference
   * users expect beside the waist; omitting it would force everyone into a
   * custom measurement. Optional like every other field.
   */
  hipsCm: number | null;
  bicepsLeftCm: number | null;
  bicepsRightCm: number | null;
  forearmLeftCm: number | null;
  forearmRightCm: number | null;
  thighLeftCm: number | null;
  thighRightCm: number | null;
  calfLeftCm: number | null;
  calfRightCm: number | null;
  /** Keyed by `CustomMeasurementDef.id`. */
  custom: Record<string, number>;
  notes: string | null;
  source: RecordSource;
}

export interface CustomMeasurementDef extends Entity {
  label: string;
  /** Decides the canonical unit and the display conversion. */
  unitType: MeasurementUnitType;
  orderIndex: number;
  /** Archiving keeps historical values readable. Indexed with orderIndex. */
  isArchived: Flag;
}

/**
 * Progress photo metadata.
 *
 * Deliberately separate from the pixels so a gallery can list hundreds of
 * photos without materialising a single blob.
 */
export interface Photo extends Entity {
  /** Local calendar day, prefilled from EXIF where present. */
  takenAt: string;
  recordedAt: string;
  pose: Pose;
  fullBlobId: string;
  thumbBlobId: string;
  /** Full-size pixels, so the gallery can lay out without decoding. */
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  /** Snapshotted for the compare view caption. */
  weightKg: number | null;
  measurementId: string | null;
  notes: string | null;
  isFavorite: boolean;
}

/**
 * Pixel storage. Not an `Entity`: blobs are content-addressed by the metadata
 * record that owns them, are never soft-deleted, and carry no sync envelope.
 *
 * Stored as an `ArrayBuffer` with its media type alongside, rather than as a
 * `Blob`. iOS Safari — the primary target — has a long history of failing to
 * persist Blobs in IndexedDB, and losing a progress photo is not a recoverable
 * error. An ArrayBuffer is a plain structured-cloneable value that every engine
 * round-trips reliably. The store's API still speaks `Blob`, so callers are
 * unaffected.
 *
 * `byteSize` is denormalised so the storage meter can sum sizes from an index
 * without deserialising a single image.
 */
export interface PhotoBlob {
  id: string;
  data: ArrayBuffer;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}
