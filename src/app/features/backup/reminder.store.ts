import { computed, inject, Service, signal } from '@angular/core';
import { APP_META_STORE } from '../../data/app-meta';
import { CLOCK } from '../../data/clock';
import { WORKOUTS_REPO } from '../../data/tokens';
import { dueReminder, snoozedUntil, type Reminder } from '../../domain/backup/reminder';

/**
 * The backup reminder (DATABASE_SPEC section 9.4).
 *
 * A card on the dashboard, never a modal, and never on a device with no
 * training on it. The decision itself lives in `domain/backup/reminder.ts`;
 * this reads the three facts it needs and remembers the snooze.
 *
 * `lastBackupReminderAt` holds when the card was last dismissed rather than a
 * snooze deadline, because that is what the field is named and a field whose
 * name lies is how the next bug starts. The deadline is derived.
 */
@Service()
export class BackupReminderStore {
  private readonly meta = inject(APP_META_STORE);
  private readonly workouts = inject(WORKOUTS_REPO);
  private readonly clock = inject(CLOCK);

  private readonly _reminder = signal<Reminder | null>(null);
  private readonly _checked = signal(false);

  readonly reminder = this._reminder.asReadonly();
  readonly isVisible = computed(() => this._checked() && this._reminder() !== null);

  async check(): Promise<void> {
    const [lastExportAt, dismissedAt] = await Promise.all([
      this.meta.get('lastExportAt'),
      this.meta.get('lastBackupReminderAt'),
    ]);

    // One row, newest first, off the index history already pages on.
    const [latest] = await this.workouts.list({
      index: 'by_status_startedAt',
      range: { lower: ['completed', ''], upper: ['completed', '￿'] },
      direction: 'prev',
      limit: 1,
    });

    this._reminder.set(
      dueReminder({
        lastExportAt,
        lastWorkoutAt: latest?.startedAt ?? null,
        snoozedUntil: snoozedUntil(dismissedAt),
        nowMs: this.clock.now(),
      }),
    );
    this._checked.set(true);
  }

  /** Dismissing is snoozing: the card comes back in a week if nothing changes. */
  async snooze(): Promise<void> {
    await this.meta.set('lastBackupReminderAt', this.clock.nowIso());
    this._reminder.set(null);
  }
}
