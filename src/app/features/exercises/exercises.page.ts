import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import {
  EQUIPMENT,
  EXERCISE_TYPES,
  MUSCLE_FILTERS,
  MUSCLE_ROLLUP,
} from '../../domain/models/enums';
import type { Equipment, ExerciseType, MuscleFilter } from '../../domain/models/enums';
import type { Exercise } from '../../domain/models/exercise';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { Sheet } from '../../shared/ui/sheet';
import { Skeleton } from '../../shared/ui/skeleton';
import { ExerciseLibraryStore } from './exercise-library.store';

/**
 * The exercise library.
 *
 * Search and filtering run synchronously over the resident catalog, so results
 * update on the keystroke rather than after a round trip to IndexedDB.
 */
@Component({
  selector: 'rl-exercises-page',
  styleUrl: './exercises.page.css',
  imports: [AppHeader, Badge, Button, Card, Chip, EmptyState, Icon, RouterLink, Sheet, Skeleton],
  template: `
    <rl-app-header titleKey="page.exercises.title">
      <rl-button size="sm" variant="ghost" (click)="newExercise()">
        {{ i18n.t('exercises.new') }}
      </rl-button>
    </rl-app-header>

    <div class="page">
      <label class="search">
        <span class="sr-only">{{ i18n.t('exercises.search.placeholder') }}</span>
        <input
          class="search__input"
          type="search"
          autocomplete="off"
          [attr.placeholder]="i18n.t('exercises.search.placeholder')"
          [value]="store.filters().query"
          (input)="store.setQuery($any($event.target).value)"
        />
      </label>

      <div class="chips" role="group" [attr.aria-label]="i18n.t('exercises.filters.all')">
        <rl-chip [selected]="store.filters().muscle === null" (toggled)="store.setMuscle(null)">
          {{ i18n.t('exercises.filters.all') }}
        </rl-chip>
        @for (muscle of muscles; track muscle) {
          <rl-chip
            [selected]="store.filters().muscle === muscle"
            (toggled)="store.setMuscle(store.filters().muscle === muscle ? null : muscle)"
          >
            {{ i18n.t('muscle.' + muscle) }}
          </rl-chip>
        }
      </div>

      <div class="chips">
        <rl-chip
          [selected]="store.filters().equipment.length > 0"
          (toggled)="equipmentOpen.set(true)"
        >
          {{ i18n.t('exercises.filters.equipment') }}
        </rl-chip>
        <rl-chip [selected]="store.filters().types.length > 0" (toggled)="typeOpen.set(true)">
          {{ i18n.t('exercises.filters.type') }}
        </rl-chip>
        <rl-chip
          [selected]="store.filters().favoritesOnly"
          (toggled)="store.patchFilters({ favoritesOnly: !store.filters().favoritesOnly })"
        >
          {{ i18n.t('exercises.filters.favorites') }}
        </rl-chip>
        <rl-chip
          [selected]="store.filters().customOnly"
          (toggled)="store.patchFilters({ customOnly: !store.filters().customOnly })"
        >
          {{ i18n.t('exercises.filters.mine') }}
        </rl-chip>
        @if (store.hasActiveFilters()) {
          <rl-chip variant="removable" (toggled)="store.clearFilters()">
            {{ i18n.t('exercises.filters.clear') }}
          </rl-chip>
        }
      </div>

      @if (store.isLoading()) {
        <p class="t-caption results" aria-live="polite">
          {{ store.isSeeding() ? i18n.t('exercises.preparing') : i18n.t('common.loading') }}
        </p>
        <div class="skeletons">
          @for (row of skeletonRows; track row) {
            <rl-skeleton shape="line" />
          }
        </div>
      } @else if (store.error()) {
        <rl-empty-state
          titleKey="state.error.title"
          bodyKey="state.error.body"
          actionKey="common.retry"
          (actioned)="reload()"
        />
      } @else if (store.resultCount() === 0) {
        <rl-empty-state
          titleKey="exercises.empty.noMatch.title"
          bodyKey="exercises.empty.noMatch.body"
          actionKey="exercises.filters.clear"
          (actioned)="store.clearFilters()"
        />
      } @else {
        <p class="t-caption results" aria-live="polite">
          {{ i18n.t('count.exercises', { count: store.resultCount() }) }}
        </p>

        <rl-card [inset]="false">
          <ul class="list">
            @for (exercise of store.results(); track exercise.id) {
              <li class="row">
                <a class="row__main" [routerLink]="['/exercises', exercise.id]">
                  <span class="row__name">{{ name(exercise) }}</span>
                  <span class="t-caption row__meta">{{ meta(exercise) }}</span>
                </a>
                @if (exercise.isCustom === 1) {
                  <rl-badge kind="neutral">{{ i18n.t('exercises.filters.mine') }}</rl-badge>
                }
                <button
                  type="button"
                  class="row__fav"
                  [class.row__fav--on]="exercise.isFavorite"
                  [attr.aria-pressed]="exercise.isFavorite"
                  [attr.aria-label]="
                    i18n.t(
                      exercise.isFavorite
                        ? 'exercises.action.unfavorite'
                        : 'exercises.action.favorite'
                    )
                  "
                  (click)="store.toggleFavorite(exercise.id)"
                >
                  <rl-icon name="check" />
                </button>
              </li>
            }
          </ul>
        </rl-card>
      }
    </div>

    <rl-sheet [(open)]="equipmentOpen" labelKey="exercises.filters.equipment">
      <h2 class="t-h2 sheet__title">{{ i18n.t('exercises.filters.equipment') }}</h2>
      <div class="chips chips--wrap">
        @for (item of equipment; track item) {
          <rl-chip
            [selected]="store.filters().equipment.includes(item)"
            (toggled)="store.toggleEquipment(item)"
          >
            {{ i18n.t('equipment.' + item) }}
          </rl-chip>
        }
      </div>
      <rl-button variant="primary" [full]="true" (click)="equipmentOpen.set(false)">
        {{ i18n.t('common.close') }}
      </rl-button>
    </rl-sheet>

    <rl-sheet [(open)]="typeOpen" labelKey="exercises.filters.type">
      <h2 class="t-h2 sheet__title">{{ i18n.t('exercises.filters.type') }}</h2>
      <div class="chips chips--wrap">
        @for (item of types; track item) {
          <rl-chip
            [selected]="store.filters().types.includes(item)"
            (toggled)="store.toggleType(item)"
          >
            {{ i18n.t('exerciseType.' + item) }}
          </rl-chip>
        }
      </div>
      <rl-button variant="primary" [full]="true" (click)="typeOpen.set(false)">
        {{ i18n.t('common.close') }}
      </rl-button>
    </rl-sheet>
  `,
})
export class ExercisesPage {
  protected readonly store = inject(ExerciseLibraryStore);
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  protected readonly muscles: readonly MuscleFilter[] = MUSCLE_FILTERS;
  protected readonly equipment: readonly Equipment[] = EQUIPMENT;
  protected readonly types: readonly ExerciseType[] = EXERCISE_TYPES;
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  protected readonly equipmentOpen = signal(false);
  protected readonly typeOpen = signal(false);

  /** Arabic names are only shown when the app is in Arabic. */
  private readonly isArabic = computed(() => this.i18n.locale() === 'ar');

  constructor() {
    void this.store.load();
  }

  protected name(exercise: Exercise): string {
    return this.isArabic() ? exercise.nameAr : exercise.nameEn;
  }

  /** "Chest · Barbell" — the two things that identify a variation at a glance. */
  protected meta(exercise: Exercise): string {
    const muscle = exercise.primaryMuscles[0];
    const parts = [
      muscle ? this.i18n.t(`muscle.${MUSCLE_ROLLUP[muscle]}`) : '',
      this.i18n.t(`equipment.${exercise.equipment}`),
    ];
    return parts.filter(Boolean).join(' · ');
  }

  protected reload(): void {
    void this.store.load({ force: true });
  }

  protected newExercise(): void {
    void this.router.navigate(['/exercises/new']);
  }
}
