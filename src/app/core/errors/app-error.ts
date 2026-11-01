/**
 * Error taxonomy. See docs/ARCHITECTURE.md section 12.1.
 *
 * Every failure the user can encounter maps to one of these kinds, because each
 * kind deserves a different response: a quota error should offer a backup, a
 * migration error should offer an export and nothing else, a validation error
 * belongs on a form field.
 */
export type AppErrorKind =
  /** Quota exceeded, blocked upgrade, aborted transaction. Offer retry + backup. */
  | 'storage'
  /** A database upgrade failed. Safe mode: export only, no writes. */
  | 'migration'
  /** Bad input, from a form or an import file. Show it on the field. */
  | 'validation'
  /** A referenced record is gone. Render a graceful empty state. */
  | 'notFound'
  /** Anything unclassified. Toast with copyable detail. */
  | 'unexpected';

export interface AppErrorOptions {
  cause?: unknown;
  /** Technical detail for the diagnostics log. Never shown as the main message. */
  detail?: string;
  /** Whether offering "Try again" makes sense. */
  retryable?: boolean;
  /** Translation key for the user-facing message, if one exists. */
  messageKey?: string;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail: string | undefined;
  readonly retryable: boolean;
  readonly messageKey: string | undefined;

  constructor(kind: AppErrorKind, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.detail = options.detail;
    this.retryable = options.retryable ?? kind === 'storage';
    this.messageKey = options.messageKey;
  }
}

export const storageError = (message: string, options?: AppErrorOptions): AppError =>
  new AppError('storage', message, options);

export const migrationError = (message: string, options?: AppErrorOptions): AppError =>
  new AppError('migration', message, options);

export const validationError = (message: string, options?: AppErrorOptions): AppError =>
  new AppError('validation', message, options);

export const notFoundError = (message: string, options?: AppErrorOptions): AppError =>
  new AppError('notFound', message, options);

/**
 * Normalises anything thrown into an `AppError`.
 *
 * Browser storage errors are recognised by name because that is the only
 * reliable signal: `QuotaExceededError` is a DOMException, not a typed class we
 * can instanceof against across engines.
 */
export function toAppError(thrown: unknown): AppError {
  if (thrown instanceof AppError) {
    return thrown;
  }

  if (thrown instanceof DOMException) {
    const quotaNames = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];
    if (quotaNames.includes(thrown.name)) {
      return storageError('Storage is full', {
        cause: thrown,
        detail: `${thrown.name}: ${thrown.message}`,
        retryable: false,
      });
    }
    if (thrown.name === 'AbortError' || thrown.name === 'InvalidStateError') {
      return storageError('A database operation was interrupted', {
        cause: thrown,
        detail: `${thrown.name}: ${thrown.message}`,
      });
    }
  }

  if (thrown instanceof Error) {
    return new AppError('unexpected', thrown.message, {
      cause: thrown,
      detail: thrown.stack ?? thrown.message,
    });
  }

  return new AppError('unexpected', 'An unexpected error occurred', {
    detail: safeStringify(thrown),
  });
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
