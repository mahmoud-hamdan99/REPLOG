import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import type { Weekday } from '../../domain/models/enums';
import type { Routine } from '../../domain/models/training';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { SectionHeader } from '../../shared/ui/section-header';
import { PlannerStore } from './planner.store';

/**
 * One plan: its workout days and the week they sit in.
 *
 * The weekday strip is the fastest way to see a training week, so it leads.
 * It starts on the user's configured first day of the week rather than
 * assuming Monday.
 */
@Component({
  selector: 'rl-plan-detail-page',
  styleUrl: './plan-detail.page.css',
  imports: [AppHeader, Button, Card, EmptyState, RouterLink, SectionHeader],
  template: `
    <rl-app-header titleKey="page.plans.title" [showBack]="true" />

    @if (!plan()) {
      <div class="page">
        <rl-empty-state titleKey="page.notFound.title" bodyKey="state.empty.body" />
      </div>
    } @else {
      <div class="page">
        <label class="field">
          <span class="t-label">{{ i18n.t('planner.plan.name') }}</span>
          <input
            class="field__input"
            type="text"
            [value]="plan()!.name"
            (change)="rename($any($event.target).value)"
          />
        </label>

        <rl-section-header titleKey="planner.plan.week" />
        <rl-card class="week">
          @for (day of orderedWeek(); track day) {
            <div class="week__day">
              <span class="t-micro week__label">{{ i18n.t('weekday.' + day) }}</span>
              @for (routine of store.routinesOnWeekday(day); track routine.id) {
                <a class="week__chip" [routerLink]="['/plans', planId(), 'routines', routine.id]">
                  {{ routine.name }}
                </a>
              }
              @if (store.routinesOnWeekday(day).length === 0) {
                <span class="week__rest" aria-hidden="true">·</span>
              }
            </div>
          }
        </rl-card>

        <rl-section-header titleKey="planner.plan.routines" />
        @if (routines().length === 0) {
          <rl-empty-state
            titleKey="planner.plan.empty.title"
            bodyKey="planner.plan.empty.body"
            actionKey="planner.routine.new"
            (actioned)="addRoutine()"
          />
        } @else {
          @for (routine of routines(); track routine.id) {
            <rl-card class="routine">
              <a class="routine__head" [routerLink]="['/plans', planId(), 'routines', routine.id]">
                <span class="t-h3">{{ routine.name }}</span>
                <span class="t-caption">{{ summary(routine) }}</span>
              </a>
            </rl-card>
          }
          <rl-button variant="secondary" [full]="true" (click)="addRoutine()">
            {{ i18n.t('planner.routine.new') }}
          </rl-button>
        }

        <p class="t-caption note">{{ i18n.t('planner.routine.historyNote') }}</p>
      </div>
    }
  `,
})
export class PlanDetailPage {
  protected readonly store = inject(PlannerStore);
  protected readonly i18n = inject(I18n);
  private readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);

  readonly planId = input.required<string>();

  protected readonly plan = computed(() => this.store.planById(this.planId()));
  protected readonly routines = computed(() => this.store.routinesForPlan(this.planId()));

  /** The week rotated to start on the user's configured first day. */
  protected readonly orderedWeek = computed<Weekday[]>(() => {
    const start = this.settings.prefs().weekStartsOn;
    return Array.from({ length: 7 }, (_, i) => ((start + i) % 7) as Weekday);
  });

  constructor() {
    void this.store.load();
  }

  protected summary(routine: Routine): string {
    const { exercises, sets, minutes } = this.store.summaryFor(routine);
    const parts = [this.i18n.t('planner.routine.summary', { exercises, sets })];
    if (minutes > 0) {
      parts.push(this.i18n.t('planner.routine.estimate', { minutes }));
    }
    return this.i18n.join(parts);
  }

  protected async rename(name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed) {
      await this.store.updatePlan(this.planId(), { name: trimmed });
    }
  }

  protected async addRoutine(): Promise<void> {
    const routine = await this.store.createRoutine({
      planId: this.planId(),
      name: this.i18n.t('planner.routine.new'),
    });
    await this.router.navigate(['/plans', this.planId(), 'routines', routine.id]);
  }
}
