import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { ToastService } from '../../core/toast/toast.service';
import { FILE_IO } from '../../data/platform';
import type { Backup } from '../../domain/backup/envelope';
import type { Problem } from '../../domain/backup/validate';
import type { Finding } from '../../domain/integrity/checks';
import { RECOVERY_WINDOW_DAYS } from '../../domain/models/entity';
import { BACKUP_STORE_NAMES, type EntityStoreName } from '../../domain/models/stores';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Dialog } from '../../shared/ui/dialog';
import { SectionHeader } from '../../shared/ui/section-header';
import { RecordsStore } from '../records/records.store';
import { BackupStore } from './backup.store';
import { IntegrityStore } from './integrity.store';

/**
 * Settings → Data & backup.
 *
 * Every guard in DATABASE_SPEC section 9.3 that belongs to this screen lives
 * here rather than in the stores, because a guard is a conversation with a
 * person and the stores have no one to talk to. Replace mode and Reset both
 * require typing a word, and both offer an export first — not as a courtesy
 * but because they are the two operations in the app that genuinely cannot be
 * undone.
 *
 * The import is deliberately three steps with the user in control of each:
 * pick a file, read what it contains, then choose what to do with it. A
 * one-tap "restore" would be faster and would mean someone finding out what
 * was in the file by watching it overwrite their training history.
 */
@Component({
  selector: 'rl-data-page',
  styleUrl: './data.page.css',
  imports: [AppHeader, Badge, Button, Card, Dialog, RouterLink, SectionHeader],
  template: `
    <rl-app-header titleKey="page.data.title" [showBack]="true" />

    <div class="page">
      <!-- Export -->
      <rl-card>
        <rl-section-header titleKey="data.export.title" />
        <p class="t-body">{{ i18n.t('data.export.body') }}</p>

        <label class="toggle">
          <input
            class="toggle__input"
            type="checkbox"
            [checked]="includePhotos()"
            (change)="includePhotos.set($any($event.target).checked)"
          />
          <span class="t-body">{{ i18n.t('data.export.photos') }}</span>
        </label>
        <p class="t-caption hint">{{ i18n.t('data.export.photosNote') }}</p>

        @if (sizeLabel(); as size) {
          <p class="t-caption hint">{{ i18n.t('data.export.size', { size }) }}</p>
        }

        <rl-button
          variant="primary"
          [full]="true"
          [busy]="backup.isBusy()"
          [disabled]="backup.isBusy()"
          (click)="runExport()"
        >
          {{ i18n.t('data.export.action') }}
        </rl-button>
      </rl-card>

      <!-- CSV, for everywhere that is not this app -->
      <rl-card>
        <rl-section-header titleKey="data.csv.title" />
        <p class="t-caption hint">{{ i18n.t('data.csv.body') }}</p>

        <label class="field">
          <span class="t-label">{{ i18n.t('data.csv.choose') }}</span>
          <select
            class="field__input t-body"
            [value]="csvStore()"
            (change)="csvStore.set($any($event.target).value)"
          >
            @for (name of csvStores; track name) {
              <option [value]="name">{{ i18n.t('store.' + name) }}</option>
            }
          </select>
        </label>

        <rl-button variant="secondary" [full]="true" (click)="exportCsv()">
          {{ i18n.t('data.csv.action') }}
        </rl-button>
      </rl-card>

      <!-- Import -->
      <rl-card>
        <rl-section-header titleKey="data.import.title" />

        @if (report(); as found) {
          @if (found.backup) {
            <h3 class="t-h3">{{ i18n.t('data.import.review') }}</h3>
            <p class="t-body">
              {{ i18n.t('data.import.records', { count: recordCount() }) }}
              @if (found.photoCount > 0) {
                · {{ i18n.t('data.import.photos', { count: found.photoCount }) }}
              }
            </p>
          }

          @for (problem of found.problems; track $index) {
            <p class="t-caption problem" [class.problem--blocking]="problem.blocking">
              <rl-badge [kind]="problem.blocking ? 'neutral' : 'estimate'">
                {{ problem.blocking ? '!' : '?' }}
              </rl-badge>
              {{ describe(problem) }}
            </p>
          }

          @if (found.importable) {
            <div class="choices">
              <rl-button variant="primary" [full]="true" (click)="apply('merge')">
                {{ i18n.t('data.import.merge') }}
              </rl-button>
              <p class="t-caption hint">{{ i18n.t('data.import.mergeNote') }}</p>

              <rl-button variant="danger" [full]="true" (click)="replaceOpen.set(true)">
                {{ i18n.t('data.import.replace') }}
              </rl-button>
              <p class="t-caption hint">{{ i18n.t('data.import.replaceNote') }}</p>
            </div>
          }

          <rl-button variant="ghost" [full]="true" (click)="clearReport()">
            {{ i18n.t('data.import.cancel') }}
          </rl-button>
        } @else {
          <rl-button variant="secondary" [full]="true" (click)="pickFile()">
            {{ i18n.t('data.import.action') }}
          </rl-button>
        }
      </rl-card>

      <!-- Recently deleted -->
      <rl-card>
        <rl-section-header titleKey="deleted.title" />
        <p class="t-caption hint">{{ i18n.t('deleted.body', { count: recoveryWindowDays }) }}</p>
        <rl-button variant="secondary" [full]="true" routerLink="/settings/deleted">
          {{ i18n.t('deleted.title') }}
        </rl-button>
      </rl-card>

      <!-- Storage -->
      <rl-card>
        <rl-section-header titleKey="data.storage.title" />

        @if (storageLabel(); as label) {
          <p class="t-stat-sm">{{ label }}</p>
        } @else {
          <p class="t-body">{{ i18n.t('data.storage.unknown') }}</p>
        }

        <!-- Said plainly, because on iOS the answer is always "best effort"
             and implying permanence would be the dishonest option. -->
        <p class="t-caption hint">
          {{
            integrity.storage()?.persisted
              ? i18n.t('data.storage.persisted')
              : i18n.t('data.storage.besteffort')
          }}
        </p>

        @if (integrity.isAtQuota()) {
          <p class="t-body warn">{{ i18n.t('data.storage.full') }}</p>
        } @else if (integrity.isNearQuota()) {
          <p class="t-body warn">{{ i18n.t('data.storage.near') }}</p>
        }

        @if (integrity.isNearQuota()) {
          <a class="link t-label" routerLink="/photos">{{ i18n.t('data.storage.photos') }}</a>
        }

        @if (!integrity.storage()?.persisted) {
          <rl-button variant="ghost" [full]="true" (click)="askPersistence()">
            {{ i18n.t('data.storage.request') }}
          </rl-button>
        }
      </rl-card>

      <!-- Integrity -->
      <rl-card>
        <rl-section-header titleKey="data.integrity.title" />

        @if (integrity.findings(); as findings) {
          @if (findings.length === 0) {
            <p class="t-body">{{ i18n.t('data.integrity.healthy') }}</p>
          } @else {
            <p class="t-caption hint">{{ i18n.t('data.integrity.exportFirst') }}</p>
            @for (finding of findings; track finding.kind) {
              <div class="finding">
                <span class="t-body">{{ describeFinding(finding) }}</span>
                @if (finding.reclaimableBytes) {
                  <span class="t-caption">{{ bytes(finding.reclaimableBytes) }}</span>
                }
                @if (finding.kind !== 'schema-mismatch') {
                  <rl-button variant="secondary" size="sm" (click)="repair(finding)">
                    {{ i18n.t('data.integrity.repair') }}
                  </rl-button>
                }
              </div>
            }
          }
        }

        <rl-button
          variant="secondary"
          [full]="true"
          [busy]="integrity.isRunning()"
          (click)="runCheck()"
        >
          {{ i18n.t('data.integrity.action') }}
        </rl-button>
      </rl-card>

      <!-- Where data lives -->
      <rl-card>
        <rl-section-header titleKey="data.about.title" />
        <p class="t-body">{{ i18n.t('data.about.body') }}</p>
        <p class="t-caption hint">{{ lastExportLabel() }}</p>
      </rl-card>

      <!-- Reset -->
      <rl-card class="danger">
        <rl-section-header titleKey="data.reset.title" />
        <p class="t-body">{{ i18n.t('data.reset.body') }}</p>
        <rl-button variant="danger" [full]="true" (click)="resetOpen.set(true)">
          {{ i18n.t('data.reset.action') }}
        </rl-button>
      </rl-card>
    </div>

    <!-- Replace needs the word typed, and offers an export on the way. -->
    <rl-dialog
      [(open)]="replaceOpen"
      titleKey="data.import.replaceConfirm"
      bodyKey="data.import.replaceBody"
      confirmKey="data.import.replace"
      [typedConfirmPhrase]="i18n.t('dialog.phrase.replace')"
      [destructive]="true"
      (confirmed)="apply('replace')"
    />

    <rl-dialog
      [(open)]="resetOpen"
      titleKey="data.reset.confirm"
      bodyKey="data.reset.confirmBody"
      confirmKey="data.reset.action"
      [typedConfirmPhrase]="i18n.t('dialog.phrase.delete')"
      [destructive]="true"
      (confirmed)="runReset()"
    />
  `,
})
export class DataPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly backup = inject(BackupStore);
  protected readonly integrity = inject(IntegrityStore);
  private readonly records = inject(RecordsStore);
  private readonly files = inject(FILE_IO);
  private readonly toasts = inject(ToastService);

  protected readonly includePhotos = signal(false);
  protected readonly replaceOpen = signal(false);
  protected readonly resetOpen = signal(false);

  private readonly estimate = signal<{ records: number; photoBytes: number } | null>(null);
  private readonly lastExport = signal<string | null>(null);

  protected readonly report = this.backup.report;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.estimate.set(await this.backup.sizeEstimate());
    await this.integrity.refreshStorage();
  }

  // -------------------------------------------------------------- exporting

  protected readonly sizeLabel = computed(() => {
    const estimate = this.estimate();
    return estimate === null
      ? ''
      : this.bytes(this.backup.projectedSize(estimate, this.includePhotos()));
  });

  protected async runExport(): Promise<void> {
    try {
      await this.backup.exportAll({
        includePhotos: this.includePhotos(),
        includeDeleted: false,
      });
      this.lastExport.set(new Date().toISOString());
      this.toasts.success(this.i18n.t('data.export.done'));
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    }
  }

  protected lastExportLabel(): string {
    const when = this.lastExport();
    return when === null
      ? this.i18n.t('data.export.never')
      : this.i18n.t('data.export.last', { when: this.format.weekdayDate(when) });
  }

  // -------------------------------------------------------------- importing

  /** Every store a spreadsheet makes sense of; photos are metadata only. */
  protected readonly recoveryWindowDays = RECOVERY_WINDOW_DAYS;

  /** Every store a spreadsheet makes sense of; photos are metadata only. */
  protected readonly csvStores = BACKUP_STORE_NAMES;
  protected readonly csvStore = signal<EntityStoreName>('setLogs');

  protected async exportCsv(): Promise<void> {
    try {
      const count = await this.backup.exportStoreCsv(this.csvStore());
      this.toasts.success(this.i18n.t('data.csv.done', { count }));
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    }
  }

  protected async pickFile(): Promise<void> {
    const picked = await this.files.pickText('application/json,.json');
    if (picked === null) return;
    await this.backup.inspect(picked.text);
  }

  protected readonly recordCount = computed(() =>
    Object.values(this.report()?.counts ?? {}).reduce((total, count) => total + count, 0),
  );

  protected describe(problem: Problem): string {
    return this.i18n.t(problem.messageKey, {
      ...(problem.params ?? {}),
      ...(problem.store === undefined ? {} : { store: this.i18n.t(`store.${problem.store}`) }),
      ...(problem.count === undefined ? {} : { count: problem.count }),
    });
  }

  protected async apply(mode: 'merge' | 'replace'): Promise<void> {
    const found = this.report()?.backup;
    if (!found) return;

    try {
      if (mode === 'replace') {
        // The pre-flight export DATABASE_SPEC section 9.2 requires, taken
        // automatically rather than offered as a checkbox. Replace is the one
        // operation that deletes data the user did not pick; a backup they
        // forgot to tick is not a backup, and the cost of taking one they did
        // not need is a file in their downloads folder.
        await this.backup.exportAll({ includePhotos: true, includeDeleted: false });
        this.toasts.success(this.i18n.t('data.import.preflightDone'));
      }

      const outcome = await this.backup.apply(found as Backup, mode, async () => {
        // Rebuilt from the set logs rather than taken from the file, so an
        // edited backup cannot inject records nobody earned.
        await this.records.rebuild();
      });

      if (outcome.failedAfter !== undefined) {
        this.toasts.error(this.describe(outcome.problems[0] as Problem));
        return;
      }

      this.toasts.success(
        this.i18n.t('data.import.done', { added: outcome.added, updated: outcome.updated }),
      );
      this.clearReport();
      await this.load();
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    }
  }

  protected clearReport(): void {
    this.backup.clearReport();
  }

  // ------------------------------------------------------------- integrity

  protected async runCheck(): Promise<void> {
    await this.integrity.check();
  }

  protected describeFinding(finding: Finding): string {
    return this.i18n.t(`integrity.${finding.kind}`, { count: finding.count });
  }

  protected async repair(finding: Finding): Promise<void> {
    await this.integrity.repair(finding, () => this.records.rebuild());
  }

  // --------------------------------------------------------------- storage

  protected readonly storageLabel = computed(() => {
    const storage = this.integrity.storage();
    if (storage?.usageBytes == null || storage.quotaBytes == null) return '';
    return this.i18n.t('data.storage.used', {
      used: this.bytes(storage.usageBytes),
      total: this.bytes(storage.quotaBytes),
    });
  });

  protected async askPersistence(): Promise<void> {
    await this.integrity.requestPersistence();
  }

  // ----------------------------------------------------------------- reset

  protected async runReset(): Promise<void> {
    await this.backup.resetAll();
    this.toasts.success(this.i18n.t('data.reset.done'));
    await this.load();
  }

  /** Bytes in the units a person reads, in their own numerals. */
  protected bytes(value: number): string {
    const units = ['B', 'kB', 'MB', 'GB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${this.i18n.formatNumber(Math.round(size * 10) / 10)} ${units[unit]}`;
  }
}
