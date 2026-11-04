import { describe, expect, it } from 'vitest';

import {
  AppError,
  migrationError,
  notFoundError,
  storageError,
  toAppError,
  validationError,
} from './app-error';

/**
 * The error taxonomy, branch by branch.
 *
 * ARCHITECTURE §12.1 says every failure a user can meet maps to one of five
 * kinds, and that each kind deserves a different response. That promise is
 * only worth anything if the mapping is right, and nothing tested it: a
 * quota error that arrived as `unexpected` would be a toast saying "something
 * went wrong" where the user should have been offered a backup.
 */
describe('toAppError', () => {
  it('passes an AppError through untouched', () => {
    const original = storageError('Storage is full', { detail: 'kept' });
    expect(toAppError(original)).toBe(original);
  });

  // Both names, because the two engines this app targets disagree. Safari
  // and Chromium throw QuotaExceededError; Firefox has historically thrown
  // NS_ERROR_DOM_QUOTA_REACHED, and a user whose phone is full should not
  // depend on which browser they opened it in.
  it.each(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'])(
    'maps %s to a storage error that does not offer a retry',
    (name) => {
      const error = toAppError(new DOMException('no room', name));
      expect(error.kind).toBe('storage');
      // Retrying a write into a full disk fails the same way, so the UI must
      // not invite it: the way out is deleting something or exporting.
      expect(error.retryable).toBe(false);
      expect(error.detail).toContain(name);
    },
  );

  it.each(['AbortError', 'InvalidStateError'])('maps %s to a retryable storage error', (name) => {
    const error = toAppError(new DOMException('interrupted', name));
    expect(error.kind).toBe('storage');
    // The opposite case: a transaction cut short by a backgrounded tab
    // usually succeeds on a second attempt.
    expect(error.retryable).toBe(true);
  });

  it('leaves an unrelated DOMException unclassified rather than guessing', () => {
    const error = toAppError(new DOMException('something else', 'SyntaxError'));
    expect(error.kind).toBe('unexpected');
  });

  it('keeps the stack of a plain Error as the diagnostic detail', () => {
    const thrown = new Error('boom');
    const error = toAppError(thrown);
    expect(error.kind).toBe('unexpected');
    expect(error.message).toBe('boom');
    expect(error.detail).toContain('boom');
    expect(error.cause).toBe(thrown);
  });

  it('survives something thrown that is not an Error at all', () => {
    expect(toAppError('a string').detail).toBe('a string');
    expect(toAppError({ a: 1 }).detail).toBe('{"a":1}');
    expect(toAppError(undefined).kind).toBe('unexpected');
  });

  it('survives a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // The point is that normalising an error never throws a second error.
    expect(() => toAppError(circular)).not.toThrow();
    expect(toAppError(circular).kind).toBe('unexpected');
  });
});

describe('the five kinds', () => {
  it('each carries its own retry default', () => {
    // Storage is the only kind where trying again is a sensible offer by
    // default; the others need the caller to say so.
    expect(storageError('x').retryable).toBe(true);
    expect(migrationError('x').retryable).toBe(false);
    expect(validationError('x').retryable).toBe(false);
    expect(notFoundError('x').retryable).toBe(false);
    expect(new AppError('unexpected', 'x').retryable).toBe(false);
  });

  it('carries a message key through to whatever renders it', () => {
    const error = validationError('Out of range', { messageKey: 'body.error.range' });
    expect(error.messageKey).toBe('body.error.range');
  });

  it('is a real Error, so a stack and an instanceof both work', () => {
    const error = notFoundError('gone');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AppError');
  });
});
