import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import { MUSCLE_ROLLUP } from '../../domain/models/enums';
import { toDisplayMass } from '../../domain/units/convert';
import type { Exercise } from '../../domain/models/exercise';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { ListRow } from '../../shared/ui/list-row';
import { SectionHeader } from '../../shared/ui/section-header';
import { ExerciseLibraryStore } from './exercise-library.store';

/**
 * One exercise in full.
 *
 * Instructions are absent for most of the catalog, so the empty case is a
 * first-class state rather than a blank panel: the library ships breadth first
 * and grows its written content over time.
 */
@Component({
  selector: 'rl-exercise-detail-page',
  styleUrl: './exercise-detail.page.css',
  imports: [AppHeader, Badge, Button, Card, Dialog, EmptyState, ListRow, SectionHeader],
  template: `
    <rl-app-header titleKey="page.exercises.title" [showBack]="true" />

    @if (store.isLoading()) {
      <div class="page">
        <p class="t-caption">{{ i18n.t('common.loading') }}</p>
      </div>
    } @else if (!exercise()) {
      <div class="page">
        <rl-empty-state titleKey="page.notFound.title" bodyKey="state.empty.body" />
      </div>
    } @else {
      <div class="page">
        <h2 class="t-h1 detail__name">{{ displayName() }}</h2>
        <p class="t-body detail__alt">{{ alternateName() }}</p>

        <div class="detail__badges">
          @if (exercise()!.isCustom === 1) {
            <rl-badge kind="neutral">{{ i18n.t('exercises.detail.custom') }}</rl-badge>
          }
          @if (exercise()!.isArchived === 1) {
            <rl-badge kind="warmup">{{ i18n.t('exercises.action.archive') }}</rl-badge>
          }
        </div>

        @if (exercise()!.userEdited) {
          <rl-card class="detail__notice">
            <p class="t-body-strong">{{ i18n.t('exercises.detail.edited') }}</p>
            <p class="t-caption">{{ i18n.t('exercises.detail.editedBody') }}</p>
          </rl-card>
        }

        <rl-card [inset]="false" class="detail__facts">
          <rl-list-row
            labelKey="exercises.detail.primary"
            [valueText]="muscleList(exercise()!.primaryMuscles)"
            [interactive]="false"
          />
          @if (exercise()!.secondaryMuscles.length > 0) {
            <rl-list-row
              labelKey="exercises.detail.secondary"
              [valueText]="muscleList(exercise()!.secondaryMuscles)"
              [interactive]="false"
            />
          }
          <rl-list-row
            labelKey="exercises.detail.equipment"
            [valueText]="i18n.t('equipment.' + exercise()!.equipment)"
            [interactive]="false"
          />
          <rl-list-row
            labelKey="exercises.detail.type"
            [valueText]="i18n.t('exerciseType.' + exercise()!.exerciseType)"
            [interactive]="false"
          />
          <rl-list-row
            labelKey="exercises.detail.mechanics"
            [valueText]="i18n.t('mechanics.' + exercise()!.mechanics)"
            [interactive]="false"
          />
          <rl-list-row
            labelKey="exercises.form.laterality"
            [valueText]="i18n.t('laterality.' + exercise()!.laterality)"
            [interactive]="false"
          />
          <rl-list-row
            labelKey="exercises.form.loadType"
            [valueText]="i18n.t('loadType.' + exercise()!.loadType)"
            [interactive]="false"
          />
          <rl-list-row
            labelKey="exercises.detail.increment"
            [valueText]="incrementText()"
            [interactive]="false"
          />
        </rl-card>

        <rl-section-header titleKey="exercises.detail.instructions" />
        @if (instructions().length > 0) {
          <rl-card>
            <ol class="steps">
              @for (step of instructions(); track $index) {
                <li class="t-body">{{ step }}</li>
              }
            </ol>
          </rl-card>
        } @else {
          <rl-card>
            <p class="t-body detail__muted">{{ i18n.t('exercises.detail.noInstructions') }}</p>
          </rl-card>
        }

        <div class="detail__actions">
          <rl-button variant="secondary" [full]="true" (click)="toggleFavorite()">
            {{
              i18n.t(
                exercise()!.isFavorite ? 'exercises.action.unfavorite' : 'exercises.action.favorite'
              )
            }}
          </rl-button>
          <rl-button variant="secondary" [full]="true" (click)="edit()">
            {{ i18n.t('common.edit') }}
          </rl-button>
          @if (exercise()!.userEdited) {
            <rl-button variant="secondary" [full]="true" (click)="reset()">
              {{ i18n.t('exercises.action.reset') }}
            </rl-button>
          }
          <rl-button variant="secondary" [full]="true" (click)="toggleArchived()">
            {{
              i18n.t(
                exercise()!.isArchived === 1
                  ? 'exercises.action.unarchive'
                  : 'exercises.action.archive'
              )
            }}
          </rl-button>
          @if (exercise()!.isCustom === 1) {
            <rl-button variant="danger" [full]="true" (click)="confirmDelete.set(true)">
              {{ i18n.t('common.delete') }}
            </rl-button>
          }
        </div>
      </div>
    }

    <!--
      Specific, because it is irreversible from inside the app. This dialog
      used to read "Delete" over the words "Your exercise", which said nothing
      about what was about to happen: not that the library loses it, not that
      history keeps reading correctly, and not that Recently deleted does not
      cover exercises so there is no way back without an older backup.
    -->
    <rl-dialog
      [(open)]="confirmDelete"
      titleKey="exercises.deleteTitle"
      [bodyText]="deleteBody()"
      confirmKey="common.delete"
      [destructive]="true"
      (confirmed)="remove()"
    />
  `,
})
export class ExerciseDetailPage {
  protected readonly store = inject(ExerciseLibraryStore);
  protected readonly i18n = inject(I18n);
  private readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  /** Bound from the route by withComponentInputBinding(). */
  readonly exerciseId = input.required<string>();

  protected readonly confirmDelete = signal(false);

  protected readonly exercise = computed<Exercise | undefined>(() =>
    this.store.byId().get(this.exerciseId()),
  );

  private readonly isArabic = computed(() => this.i18n.locale() === 'ar');

  protected readonly displayName = computed(() => {
    const exercise = this.exercise();
    if (!exercise) return '';
    return this.isArabic() ? exercise.nameAr : exercise.nameEn;
  });

  /** The other language's name, so a user can confirm they found the right lift. */
  protected readonly alternateName = computed(() => {
    const exercise = this.exercise();
    if (!exercise) return '';
    return this.isArabic() ? exercise.nameEn : exercise.nameAr;
  });

  protected readonly instructions = computed(() => {
    const exercise = this.exercise();
    if (!exercise) return [];
    const preferred = this.isArabic() ? exercise.instructionsAr : exercise.instructionsEn;
    // Fall back to the other language rather than showing nothing: a step the
    // user can read in English beats no guidance at all.
    return preferred.length > 0
      ? preferred
      : this.isArabic()
        ? exercise.instructionsEn
        : exercise.instructionsAr;
  });

  /**
   * Shown in the user's own weight unit with a translated label.
   *
   * The increment is stored in kilograms like every other mass; converting at
   * the display edge is the entire point of canonical storage, and "kg" as a
   * hardcoded suffix would be both wrong for a pounds user and untranslated.
   */
  protected readonly incrementText = computed(() => {
    const exercise = this.exercise();
    if (!exercise) return '';

    const unit = this.settings.weightUnit();
    const value = toDisplayMass(exercise.weightIncrementKg, unit);
    return `${this.i18n.formatNumber(value)} ${this.i18n.t(`unit.short.${unit}`)}`;
  });

  constructor() {
    void this.store.load();

    effect(() => {
      // Deep-linked straight to a detail page: load, then confirm it exists.
      if (!this.store.isLoading() && this.store.all() !== null && !this.exercise()) {
        this.toasts.error(this.i18n.t('page.notFound.title'));
      }
    });
  }

  protected muscleList(muscles: readonly string[]): string {
    const seen = new Set<string>();
    for (const muscle of muscles) {
      const rolled = MUSCLE_ROLLUP[muscle as keyof typeof MUSCLE_ROLLUP];
      if (rolled) seen.add(rolled);
    }
    return this.i18n.join([...seen].map((filter) => this.i18n.t(`muscle.${filter}`)));
  }

  protected toggleFavorite(): void {
    void this.store.toggleFavorite(this.exerciseId());
  }

  protected toggleArchived(): void {
    const exercise = this.exercise();
    if (exercise) {
      void this.store.setArchived(exercise.id, exercise.isArchived === 0);
    }
  }

  protected edit(): void {
    void this.router.navigate(['/exercises', this.exerciseId(), 'edit']);
  }

  protected async reset(): Promise<void> {
    await this.store.resetToOriginal(this.exerciseId());
    this.toasts.success(this.i18n.t('exercises.action.reset'));
  }

  /** Names the exercise in the delete dialog, so the warning is about it. */
  protected readonly deleteBody = computed(() => {
    const exercise = this.store.byId().get(this.exerciseId());
    return this.i18n.t('exercises.deleteBody', {
      name: exercise === undefined ? '' : this.store.displayName(exercise),
    });
  });

  protected async remove(): Promise<void> {
    await this.store.removeCustom(this.exerciseId());
    await this.router.navigate(['/exercises']);
  }
}
