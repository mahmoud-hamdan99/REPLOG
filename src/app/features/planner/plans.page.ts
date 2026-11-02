import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/toast/toast.service';
import type { Plan } from '../../domain/models/training';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { SectionHeader } from '../../shared/ui/section-header';
import { PlannerStore } from './planner.store';

/** Plan list: the programs a user switches between. */
@Component({
  selector: 'rl-plans-page',
  styleUrl: './plans.page.css',
  imports: [AppHeader, Badge, Button, Card, EmptyState, Icon, RouterLink, SectionHeader],
  template: `
    <rl-app-header titleKey="page.plans.title">
      <rl-button size="sm" variant="ghost" (click)="createPlan()">
        {{ i18n.t('planner.new') }}
      </rl-button>
    </rl-app-header>

    <div class="page">
      @if (store.isLoading()) {
        <p class="t-caption">{{ i18n.t('common.loading') }}</p>
      } @else if (store.livePlans().length === 0 && store.archivedPlans().length === 0) {
        <rl-empty-state
          titleKey="planner.empty.title"
          bodyKey="planner.empty.body"
          actionKey="planner.new"
          (actioned)="createPlan()"
        />
      } @else {
        @for (plan of store.livePlans(); track plan.id; let i = $index) {
          <rl-card class="plan" [accentEdge]="plan.id === store.activePlanId()">
            <a class="plan__head" [routerLink]="['/plans', plan.id]">
              <span class="t-h3">{{ plan.name }}</span>
              @if (plan.id === store.activePlanId()) {
                <rl-badge kind="pr">{{ i18n.t('planner.active') }}</rl-badge>
              }
            </a>

            <p class="t-caption plan__meta">
              {{ i18n.t('count.workouts', { count: store.routinesForPlan(plan.id).length }) }}
            </p>

            <div class="plan__days" [attr.aria-label]="i18n.t('planner.plan.week')">
              @for (day of weekdays; track day) {
                <span class="plan__day" [class.plan__day--on]="hasRoutine(plan, day)">
                  {{ i18n.t('weekday.' + day) }}
                </span>
              }
            </div>

            <div class="plan__actions">
              @if (plan.id !== store.activePlanId()) {
                <rl-button size="sm" variant="secondary" (click)="setActive(plan.id)">
                  {{ i18n.t('planner.setActive') }}
                </rl-button>
              }
              <rl-button size="sm" variant="secondary" (click)="duplicate(plan)">
                {{ i18n.t('planner.duplicate') }}
              </rl-button>
              <rl-button size="sm" variant="secondary" (click)="archive(plan.id, true)">
                {{ i18n.t('planner.archive') }}
              </rl-button>
              @if (i > 0) {
                <button
                  type="button"
                  class="plan__move"
                  [attr.aria-label]="i18n.t('planner.exercise.moveUp')"
                  (click)="move(i, i - 1)"
                >
                  <rl-icon name="chevron" />
                </button>
              }
            </div>
          </rl-card>
        }

        @if (store.archivedPlans().length > 0) {
          <rl-section-header titleKey="planner.archived" />
          @for (plan of store.archivedPlans(); track plan.id) {
            <rl-card class="plan plan--archived">
              <a class="plan__head" [routerLink]="['/plans', plan.id]">
                <span class="t-h3">{{ plan.name }}</span>
              </a>
              <div class="plan__actions">
                <rl-button size="sm" variant="secondary" (click)="archive(plan.id, false)">
                  {{ i18n.t('planner.unarchive') }}
                </rl-button>
              </div>
            </rl-card>
          }
        }
      }
    </div>
  `,
})
export class PlansPage {
  protected readonly store = inject(PlannerStore);
  protected readonly i18n = inject(I18n);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly weekdays = [0, 1, 2, 3, 4, 5, 6] as const;
  protected readonly busy = signal(false);

  constructor() {
    void this.store.load();
  }

  /** Whether any routine in the plan claims this weekday. */
  protected hasRoutine(plan: Plan, weekday: number): boolean {
    return this.store
      .routinesForPlan(plan.id)
      .some((routine) => routine.weekdays.includes(weekday as never));
  }

  protected async createPlan(): Promise<void> {
    const plan = await this.store.createPlan(this.i18n.t('planner.new'));
    await this.router.navigate(['/plans', plan.id]);
  }

  protected async setActive(id: string): Promise<void> {
    await this.store.setActivePlan(id);
  }

  protected async duplicate(plan: Plan): Promise<void> {
    const copy = await this.store.duplicatePlanById(
      plan.id,
      this.i18n.t('planner.copySuffix', { name: plan.name }),
    );
    if (copy) {
      this.toasts.success(copy.name);
    }
  }

  protected async archive(id: string, archived: boolean): Promise<void> {
    await this.store.setPlanArchived(id, archived);
  }

  protected async move(fromIndex: number, toIndex: number): Promise<void> {
    await this.store.movePlan(fromIndex, toIndex);
  }
}
