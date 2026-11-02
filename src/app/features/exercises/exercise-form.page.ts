import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AppHeader } from '../../core/nav/app-header';
import { I18n } from '../../core/i18n/i18n.service';
import { ToastService } from '../../core/toast/toast.service';
import {
  EQUIPMENT,
  EXERCISE_TYPES,
  LATERALITIES,
  LOAD_TYPES,
  MECHANICS,
  MOVEMENT_PATTERNS,
  MUSCLE_FILTERS,
} from '../../domain/models/enums';
import type {
  Equipment,
  ExerciseType,
  Laterality,
  LoadType,
  Mechanics,
  MovementPattern,
  MuscleFilter,
  MuscleGroup,
} from '../../domain/models/enums';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ExerciseLibraryStore } from './exercise-library.store';

/**
 * Create or edit an exercise.
 *
 * Reactive forms rather than Signal Forms: the project prefers Signal Forms for
 * new work, but its API could not be established with confidence from the local
 * type definitions, and guessing at an unfamiliar form API is a poor trade
 * against the typed alternative the project explicitly sanctions as the
 * fallback. Worth revisiting once the API is settled.
 */
@Component({
  selector: 'rl-exercise-form-page',
  styleUrl: './exercise-form.page.css',
  imports: [AppHeader, Button, Card, ReactiveFormsModule],
  template: `
    <rl-app-header
      [titleKey]="isEditing() ? 'exercises.edit' : 'exercises.new'"
      [showBack]="true"
    />

    <form class="page" [formGroup]="form" (ngSubmit)="save()">
      <rl-card>
        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.nameEn') }}</span>
          <input class="field__input" type="text" formControlName="nameEn" autocomplete="off" />
          @if (showError('nameEn')) {
            <span class="field__error t-caption">{{ errorFor('nameEn') }}</span>
          }
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.nameAr') }}</span>
          <input
            class="field__input"
            type="text"
            formControlName="nameAr"
            autocomplete="off"
            dir="rtl"
          />
          @if (showError('nameAr')) {
            <span class="field__error t-caption">{{ errorFor('nameAr') }}</span>
          }
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.primary') }}</span>
          <select class="field__input" formControlName="primaryMuscle">
            @for (muscle of muscles; track muscle) {
              <option [value]="muscle">{{ i18n.t('muscle.' + muscle) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.equipment') }}</span>
          <select class="field__input" formControlName="equipment">
            @for (item of equipment; track item) {
              <option [value]="item">{{ i18n.t('equipment.' + item) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.type') }}</span>
          <select class="field__input" formControlName="exerciseType">
            @for (item of types; track item) {
              <option [value]="item">{{ i18n.t('exerciseType.' + item) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.pattern') }}</span>
          <select class="field__input" formControlName="movementPattern">
            @for (item of patterns; track item) {
              <option [value]="item">{{ item }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.mechanics') }}</span>
          <select class="field__input" formControlName="mechanics">
            @for (item of mechanics; track item) {
              <option [value]="item">{{ i18n.t('mechanics.' + item) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.laterality') }}</span>
          <select class="field__input" formControlName="laterality">
            @for (item of lateralities; track item) {
              <option [value]="item">{{ i18n.t('laterality.' + item) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.loadType') }}</span>
          <select class="field__input" formControlName="loadType">
            @for (item of loadTypes; track item) {
              <option [value]="item">{{ i18n.t('loadType.' + item) }}</option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('exercises.form.increment') }}</span>
          <input
            class="field__input"
            type="number"
            inputmode="decimal"
            step="0.25"
            min="0.25"
            formControlName="weightIncrementKg"
          />
          @if (showError('weightIncrementKg')) {
            <span class="field__error t-caption">{{ i18n.t('exercises.form.invalidNumber') }}</span>
          }
        </label>
      </rl-card>

      <div class="actions">
        <rl-button variant="secondary" [full]="true" (click)="cancel()">
          {{ i18n.t('common.cancel') }}
        </rl-button>
        <rl-button variant="primary" type="submit" [full]="true" [busy]="saving()">
          {{ i18n.t('common.save') }}
        </rl-button>
      </div>
    </form>
  `,
})
export class ExerciseFormPage {
  private readonly store = inject(ExerciseLibraryStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  protected readonly i18n = inject(I18n);

  /** Present when editing; absent when creating. */
  readonly exerciseId = input<string | undefined>(undefined);

  protected readonly muscles: readonly MuscleFilter[] = MUSCLE_FILTERS;
  protected readonly equipment: readonly Equipment[] = EQUIPMENT;
  protected readonly types: readonly ExerciseType[] = EXERCISE_TYPES;
  protected readonly patterns: readonly MovementPattern[] = MOVEMENT_PATTERNS;
  protected readonly mechanics: readonly Mechanics[] = MECHANICS;
  protected readonly lateralities: readonly Laterality[] = LATERALITIES;
  protected readonly loadTypes: readonly LoadType[] = LOAD_TYPES;

  protected readonly saving = signal(false);
  protected readonly isEditing = computed(() => this.exerciseId() !== undefined);

  protected readonly form = this.fb.nonNullable.group({
    nameEn: ['', [Validators.required, Validators.maxLength(80)]],
    nameAr: ['', [Validators.required, Validators.maxLength(80)]],
    primaryMuscle: ['chest' as MuscleFilter, Validators.required],
    equipment: ['barbell' as Equipment, Validators.required],
    exerciseType: ['strength' as ExerciseType, Validators.required],
    movementPattern: ['other' as MovementPattern, Validators.required],
    mechanics: ['compound' as Mechanics, Validators.required],
    laterality: ['bilateral' as Laterality, Validators.required],
    loadType: ['external' as LoadType, Validators.required],
    weightIncrementKg: [2.5, [Validators.required, Validators.min(0.25)]],
  });

  constructor() {
    void this.store.load();

    effect(() => {
      const id = this.exerciseId();
      if (!id) return;
      const existing = this.store.byId().get(id);
      if (!existing) return;

      this.form.patchValue({
        nameEn: existing.nameEn,
        nameAr: existing.nameAr,
        primaryMuscle: (existing.primaryMuscles[0] ?? 'chest') as MuscleFilter,
        equipment: existing.equipment,
        exerciseType: existing.exerciseType,
        movementPattern: existing.movementPattern,
        mechanics: existing.mechanics,
        laterality: existing.laterality,
        loadType: existing.loadType,
        weightIncrementKg: existing.weightIncrementKg,
      });
    });
  }

  protected showError(field: string): boolean {
    const control = this.form.get(field);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  protected errorFor(field: string): string {
    const control = this.form.get(field);
    if (control?.hasError('required')) return this.i18n.t('exercises.form.required');
    if (control?.hasError('maxlength')) return this.i18n.t('exercises.form.tooLong');
    return this.i18n.t('exercises.form.invalidNumber');
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const value = this.form.getRawValue();
    const id = this.exerciseId();

    try {
      if (id) {
        await this.store.update(id, {
          nameEn: value.nameEn.trim(),
          nameAr: value.nameAr.trim(),
          primaryMuscles: [value.primaryMuscle as MuscleGroup],
          equipment: value.equipment,
          exerciseType: value.exerciseType,
          movementPattern: value.movementPattern,
          mechanics: value.mechanics,
          laterality: value.laterality,
          loadType: value.loadType,
          weightIncrementKg: value.weightIncrementKg,
        });
        await this.router.navigate(['/exercises', id]);
      } else {
        const created = await this.store.createCustom({
          nameEn: value.nameEn.trim(),
          nameAr: value.nameAr.trim(),
          isArTranslated: true,
          aliases: [],
          primaryMuscles: [value.primaryMuscle as MuscleGroup],
          secondaryMuscles: [],
          equipment: value.equipment,
          exerciseType: value.exerciseType,
          movementPattern: value.movementPattern,
          mechanics: value.mechanics,
          force: null,
          laterality: value.laterality,
          loadType: value.loadType,
          instructionsEn: [],
          instructionsAr: [],
          cuesEn: [],
          cuesAr: [],
          illustration: null,
          defaultRestSec: null,
          weightIncrementKg: value.weightIncrementKg,
          isArchived: 0,
          isFavorite: false,
          notes: null,
        });
        await this.router.navigate(['/exercises', created.id]);
      }
      this.toasts.success(this.i18n.t('common.save'));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.router.navigate(['/exercises']);
  }
}
