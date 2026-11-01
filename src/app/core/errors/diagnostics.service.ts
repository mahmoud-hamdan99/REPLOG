import { computed, inject, Service, signal } from '@angular/core';
import { CLOCK } from '../../data/clock';
import type { AppError } from './app-error';

export interface DiagnosticEntry {
  at: string;
  kind: AppError['kind'] | 'info';
  message: string;
  detail?: string | undefined;
}

const CAPACITY = 100;

/**
 * In-memory ring buffer of recent errors, surfaced in Settings → About →
 * Diagnostics with copy-to-clipboard.
 *
 * In memory on purpose: there is no telemetry, nothing is uploaded, and nothing
 * is persisted. A user reporting a problem can copy the log and paste it
 * themselves. Capacity is bounded so a repeating failure cannot grow without
 * limit during a long session.
 */
@Service()
export class DiagnosticsService {
  private readonly clock = inject(CLOCK);
  private readonly _entries = signal<readonly DiagnosticEntry[]>([]);

  readonly entries = this._entries.asReadonly();
  readonly count = computed(() => this._entries().length);

  record(entry: Omit<DiagnosticEntry, 'at'>): void {
    const full: DiagnosticEntry = { ...entry, at: this.clock.nowIso() };
    this._entries.update((current) => {
      const next = [...current, full];
      return next.length > CAPACITY ? next.slice(next.length - CAPACITY) : next;
    });
  }

  clear(): void {
    this._entries.set([]);
  }

  /** Plain-text rendering for the clipboard. */
  asText(): string {
    return this._entries()
      .map((e) => `${e.at} [${e.kind}] ${e.message}${e.detail ? `\n  ${e.detail}` : ''}`)
      .join('\n');
  }
}
