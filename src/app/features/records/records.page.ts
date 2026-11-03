import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import type { PersonalRecord } from '../../domain/models/records';
import { Badge } from '../../shared/ui/badge';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { ProgressTabs } from '../../shared/ui/progress-tabs';
import { SectionHeader } from '../../shared/ui/section-header';
import { RecordsStore } from './records.store';

/**
 * Personal records.
 *
 * Three things this screen is careful about, each of them a promise
 * PRODUCT_SPEC makes and this is the surface that keeps:
 *
 *   - **scope is stated, not assumed.** Records are grouped per variant and
 *     the banner says why, because a reader who does not know that a dumbbell
 *     press is scored separately would read the list wrongly
 *   - **estimates are marked.** Every estimated one-rep max carries the `⌁`
 *     badge and names its formula; nothing calculated is allowed to look
 *     measured
 *   - **a first record says "First record"**, not "New record". There is a
 *     difference between starting and improving, and the table knows which
 *     one it is because `previousValue` is null
 *
 * Lives on `/progress` for now. Phase 10 turns that route into the analytics
 * hub with Records as one of its tabs; building a second route to be moved
 * then would be work done twice.
 */
@Component({
  selector: 'rl-records-page',
  styleUrl: './records.page.css',
  imports: [AppHeader, Badge, Card, EmptyState, ProgressTabs, SectionHeader],
  template: `
    <rl-app-header titleKey="page.records.title" />

    <div class="page">
      <rl-progress-tabs />

      @if (store.isLoading()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (store.error(); as error) {
        <rl-empty-state titleKey="state.error.title" bodyKey="state.error.body" />
        <p class="t-caption">{{ error }}</p>
      } @else if ((store.current() ?? []).length === 0) {
        <rl-empty-state
          titleKey="records.empty.title"
          bodyKey="records.empty.body"
          actionKey="records.empty.action"
          (actioned)="goToTrain()"
        />
      } @else {
        <p class="note t-caption">{{ i18n.t('records.scopeNote') }}</p>

        @if (store.recent().length > 0) {
          <rl-section-header titleKey="records.recent" />
          @for (record of store.recent(); track record.id) {
            <rl-card class="rec">
              <button type="button" class="rec__btn" (click)="open(record)">
                <span class="rec__head">
                  <span class="t-body-strong">{{ record.nameSnapshot }}</span>
                  <span class="t-caption">{{ format.shortDate(record.achievedAt) }}</span>
                </span>
                <span class="t-caption">{{ format.recordType(record) }}</span>
                <span class="rec__value">
                  <span class="t-stat-sm">{{ format.recordValue(record) }}</span>
                  @if (record.isEstimate) {
                    <rl-badge kind="estimate">{{ format.recordFormula(record) }}</rl-badge>
                  }
                  <rl-badge [kind]="record.previousValue === null ? 'count' : 'pr'">
                    {{ format.recordDelta(record) }}
                  </rl-badge>
                </span>
              </button>
            </rl-card>
          }
        }

        <rl-section-header titleKey="records.all" />
        @for (group of store.groups(); track group.variantKey) {
          <rl-card class="grp">
            <h3 class="t-body-strong grp__name">{{ group.nameSnapshot }}</h3>
            @for (record of group.records; track record.id) {
              <button type="button" class="grp__row" (click)="open(record)">
                <span class="t-caption">{{ format.recordType(record) }}</span>
                <span class="grp__value">
                  <span class="t-body-strong">{{ format.recordValue(record) }}</span>
                  @if (record.isEstimate) {
                    <rl-badge kind="estimate">{{ format.recordFormula(record) }}</rl-badge>
                  }
                </span>
              </button>
            }
          </rl-card>
        }

        <p class="note t-caption">{{ i18n.t('records.estimateNote') }}</p>
        <p class="note t-caption">{{ i18n.t('records.bodyweightNote') }}</p>
      }
    </div>
  `,
})
export class RecordsPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(RecordsStore);
  private readonly router = inject(Router);

  constructor() {
    void this.store.load();
  }

  /** Provenance: a record opens the workout that produced it. */
  protected open(record: PersonalRecord): void {
    void this.router.navigate(['/history', record.workoutId]);
  }

  protected goToTrain(): void {
    void this.router.navigate(['/train']);
  }
}
