import { DisplayFormat } from '../../core/format/display-format.service';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import type { SetLog } from '../../domain/models/workout';
import { Badge } from './badge';

/** Horizontal travel, in px, that counts as a deliberate swipe. */
const SWIPE_THRESHOLD = 72;

/**
 * One logged set.
 *
 * The most-used control in the app: on a good day it is tapped two hundred
 * times. So the targets are 48 px, the values are tabular, and the confirm
 * button is the largest thing in the row.
 *
 * `isCommitted` comes from the record's own `isCompleted`, which the store only
 * flips inside `onCommit` — so a solid tick always means the row is on disk,
 * never that a write is in flight.
 */
@Component({
  selector: 'rl-set-row',
  styleUrl: './set-row.css',
  imports: [Badge],
  template: `
    <div
      class="row"
      [class.row--done]="set().isCompleted"
      [class.row--current]="isCurrent()"
      [class.row--warmup]="isWarmup()"
      [style.grid-template-columns]="columns()"
      [style.translate]="offset() === 0 ? null : offset() + 'px'"
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="reset()"
    >
      <button
        type="button"
        class="row__badge"
        [attr.aria-label]="badgeLabel()"
        [disabled]="readOnly()"
        (click)="opened.emit()"
      >
        @if (isWarmup()) {
          <rl-badge kind="warmup">{{ i18n.t('tracker.set.warmup') }}</rl-badge>
        } @else {
          <span class="t-label">{{ i18n.formatNumber(workingIndex()) }}</span>
        }
      </button>

      @if (showPrevious()) {
        <span class="row__prev t-caption">{{ previousText() || '—' }}</span>
      }

      @if (showWeight()) {
        <button
          type="button"
          class="row__field"
          [class.row__field--empty]="set().weightKg === null"
          [attr.aria-label]="
            i18n.t('tracker.set.editWeight', {
              index: label(),
              value: format.mass(set().weightKg),
            })
          "
          [disabled]="readOnly()"
          (click)="editWeight.emit()"
        >
          {{ format.mass(set().weightKg) }}
        </button>
      }

      <button
        type="button"
        class="row__field"
        [class.row__field--empty]="set().reps === null"
        [attr.aria-label]="
          i18n.t('tracker.set.editReps', { index: label(), value: format.number(set().reps) })
        "
        [disabled]="readOnly()"
        (click)="editReps.emit()"
      >
        {{ format.number(set().reps) }}
      </button>

      @if (showConfirm()) {
        <button
          type="button"
          class="row__check"
          [class.row__check--on]="set().isCompleted"
          [attr.aria-pressed]="set().isCompleted"
          [attr.aria-label]="
            set().isCompleted
              ? i18n.t('tracker.set.unconfirm', { index: label() })
              : i18n.t('tracker.set.confirm', { index: label() })
          "
          [disabled]="readOnly()"
          (click)="toggled.emit()"
        >
          <span aria-hidden="true">{{ set().isCompleted ? '✓' : '○' }}</span>
        </button>
      }
    </div>

    @if (isAdvanced() && set().isCompleted) {
      <p class="row__extra t-caption">
        @if (set().rpe !== null) {
          <span>{{ i18n.t('tracker.rpe') }} {{ format.number(set().rpe) }}</span>
        }
        @if (set().rir !== null) {
          <span>{{ i18n.t('tracker.rir') }} {{ format.number(set().rir) }}</span>
        }
        @if (set().restTakenSec !== null) {
          <span>{{ i18n.t('tracker.rest.title') }} {{ format.clock(set().restTakenSec!) }}</span>
        }
        @if (set().notes) {
          <span>{{ set().notes }}</span>
        }
      </p>
    }
  `,
})
export class SetRow {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);

  readonly set = input.required<SetLog>();
  /** Position among working sets, 1-based; warm-ups show a badge instead. */
  readonly workingIndex = input.required<number>();
  readonly isCurrent = input(false);
  readonly isAdvanced = input(false);
  readonly showWeight = input(true);
  /**
   * Whether to show the previous-performance column.
   *
   * False where there is nothing to compare against. A history detail is a
   * record of what happened, and a column of dashes beside it is noise.
   */
  readonly showPrevious = input(true);
  /** False where every row is confirmed by definition, as in history. */
  readonly showConfirm = input(true);
  readonly readOnly = input(false);
  /** Already-translated previous-performance text for this row. */
  readonly previousText = input<string>('');

  readonly toggled = output<void>();
  readonly editWeight = output<void>();
  readonly editReps = output<void>();
  readonly deleted = output<void>();
  /** The accessible route to everything the swipe and the badge expose. */
  readonly opened = output<void>();

  protected readonly offset = signal(0);
  protected readonly isWarmup = computed(() => this.set().setType === 'warmup');

  /**
   * The grid, built from the columns that are actually rendered.
   *
   * A style binding rather than a modifier class per combination: there are
   * three independent toggles, and eight classes would be harder to read than
   * one expression that says what it means. The flexible column moves onto the
   * fields when there is no previous-performance column to take up the slack.
   */
  protected readonly columns = computed(() => {
    const previous = this.showPrevious();
    const flexible = previous ? '68px' : 'minmax(68px, 1fr)';

    return [
      '44px',
      ...(previous ? ['1fr'] : []),
      ...(this.showWeight() ? [flexible] : []),
      previous ? '56px' : flexible,
      ...(this.showConfirm() ? ['52px'] : []),
    ].join(' ');
  });

  /** For the aria labels: warm-ups are not numbered among working sets. */
  protected readonly label = computed(() =>
    this.isWarmup()
      ? this.i18n.t('tracker.set.warmupLabel')
      : this.i18n.formatNumber(this.workingIndex()),
  );

  /**
   * The badge's name, carrying the character printed on it.
   *
   * WCAG 2.5.3: a control's accessible name has to contain its visible label,
   * so somebody using voice control can say what they can see. This button
   * shows "W" or a set number and used to be named "Set type", which matched
   * nothing on screen — axe reports it as label-content-name-mismatch, and it
   * also meant a screen reader never read the number out, because the
   * aria-label replaced the content rather than describing it.
   */
  protected readonly badgeLabel = computed(() =>
    this.i18n.t('tracker.set.typeOf', {
      label: this.isWarmup() ? this.i18n.t('tracker.set.warmup') : this.label(),
    }),
  );

  private startX = 0;
  private startY = 0;
  private tracking = false;

  /**
   * Swipe to delete, with the undo toast as the safety net.
   *
   * Direction-aware: the row is dragged toward the inline start, which is left
   * in English and right in Arabic. Hard-coding "left" would make the gesture
   * run the wrong way in RTL.
   */
  private get sign(): number {
    return this.i18n.direction() === 'rtl' ? 1 : -1;
  }

  protected onDown(event: PointerEvent): void {
    if (this.readOnly()) return;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.tracking = true;
  }

  protected onMove(event: PointerEvent): void {
    if (!this.tracking) return;

    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;

    // A mostly-vertical drag is a scroll, and stealing it would make the list
    // feel broken. Only a clearly horizontal one moves the row.
    if (Math.abs(dx) < Math.abs(dy) * 2) {
      this.offset.set(0);
      return;
    }

    const travel = dx * this.sign;
    this.offset.set(travel > 0 ? dx : 0);
  }

  protected onUp(event: PointerEvent): void {
    if (!this.tracking) return;
    const travel = (event.clientX - this.startX) * this.sign;
    this.reset();

    if (travel >= SWIPE_THRESHOLD) {
      this.deleted.emit();
    }
  }

  protected reset(): void {
    this.tracking = false;
    this.offset.set(0);
  }
}
