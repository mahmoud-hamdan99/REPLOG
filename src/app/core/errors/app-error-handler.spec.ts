import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18n } from '../i18n/i18n.service';
import { ToastService } from '../toast/toast.service';
import { AppError, storageError, validationError } from './app-error';
import { AppErrorHandler } from './app-error-handler';
import { DiagnosticsService } from './diagnostics.service';

/**
 * What a user actually meets when something fails.
 *
 * Two promises, neither of which had a test. Every failure reaches the
 * diagnostics log, because that buffer is the whole of this app's error
 * reporting — there is no telemetry, so a log that silently missed a kind
 * would leave a user with nothing to paste into a bug report. And a
 * validation error does *not* raise a toast, because it belongs on the field
 * that produced it; a toast saying "weight is out of range" floating over a
 * form that looks fine is worse than no message.
 */
describe('AppErrorHandler', () => {
  let recorded: { kind: string; message: string; detail?: string | undefined }[];
  let toasted: string[];

  beforeEach(() => {
    TestBed.resetTestingModule();
    recorded = [];
    toasted = [];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: DiagnosticsService,
          useValue: { record: (entry: (typeof recorded)[number]) => recorded.push(entry) },
        },
        { provide: ToastService, useValue: { error: (message: string) => toasted.push(message) } },
        // Returns the key, so the assertions are about which message was
        // chosen rather than about the wording of a translation.
        { provide: I18n, useValue: { t: (key: string) => key } },
      ],
    });
  });

  const handle = (thrown: unknown) => TestBed.inject(AppErrorHandler).handleError(thrown);

  it.each(['storage', 'migration', 'notFound', 'unexpected'] as const)(
    'records a %s error and tells the user something went wrong',
    (kind) => {
      handle(new AppError(kind, `a ${kind} failure`));

      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.kind).toBe(kind);
      expect(toasted).toEqual(['state.error.title']);
    },
  );

  it('records a validation error but leaves the message to the form', () => {
    handle(validationError('Weight is out of range', { messageKey: 'body.error.range' }));

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe('validation');
    expect(toasted).toEqual([]);
  });

  it('prefers the error own message key over the generic one', () => {
    handle(storageError('Storage is full', { messageKey: 'data.storage.full' }));
    expect(toasted).toEqual(['data.storage.full']);
  });

  it('normalises anything thrown, including what is not an Error', () => {
    handle('a bare string');
    handle(new DOMException('no room', 'QuotaExceededError'));

    expect(recorded.map((entry) => entry.kind)).toEqual(['unexpected', 'storage']);
    // Both still reach the user: an unrecognised failure is still a failure.
    expect(toasted).toHaveLength(2);
  });

  it('keeps the technical detail out of the toast', () => {
    handle(new AppError('unexpected', 'readable', { detail: 'IDBTransaction: AbortError at 0x4' }));

    expect(recorded[0]?.detail).toContain('IDBTransaction');
    expect(toasted[0] ?? '').not.toContain('IDBTransaction');
  });
});
