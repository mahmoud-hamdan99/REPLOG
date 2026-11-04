import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, maxLength } from '@angular/forms/signals';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { ToastService } from '../../core/toast/toast.service';
import { CLOCK } from '../../data/clock';
import { PROFILE_REPO } from '../../data/tokens';
import { PROFILE_ID } from '../../domain/models/system';
import type { ExperienceLevel, Sex, TrainingGoal } from '../../domain/models/enums';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { MeasurementField } from '../../shared/ui/measurement-field';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';

const NAME_LIMIT = 60;

/**
 * Profile.
 *
 * Every field is optional and the screen says so at the top, because a
 * profile form that looks mandatory is the first thing that makes a training
 * app feel like a sign-up. Nothing here is required to log a set, and nothing
 * here is used for anything the user has not asked for: no inferred calorie
 * targets, no age-adjusted "recommendations".
 *
 * Height goes through `rl-measurement-field` rather than a plain input,
 * because that component is the only place in the app allowed to convert
 * units, and it reads and writes the user's own numerals in both directions.
 */
@Component({
  selector: 'rl-profile-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Button, Card, FormField, MeasurementField, Segmented],
  template: `
    <rl-app-header titleKey="settings.profile.title" [showBack]="true" />

    <div class="page">
      <p class="t-caption group__note">{{ i18n.t('profile.allOptional') }}</p>

      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <label class="field">
              <span class="t-label">{{ i18n.t('profile.name') }}</span>
              <input
                class="field__input t-body"
                type="text"
                autocomplete="name"
                [placeholder]="i18n.t('profile.namePlaceholder')"
                [formField]="profileForm.displayName"
              />
            </label>
          </div>

          <div class="group__control">
            <label class="field">
              <span class="t-label">{{ i18n.t('profile.birthDate') }}</span>
              <!-- Bounded by the native max attribute, so the picker itself
                   cannot offer a future date. See UI_UX_SPEC section 6.3. -->
              <input
                class="field__input t-body"
                type="date"
                [max]="today()"
                [formField]="profileForm.birthDate"
              />
            </label>
          </div>

          <div class="group__control">
            <rl-measurement-field
              [label]="i18n.t('profile.height')"
              unitType="length"
              [value]="heightCm()"
              (valueChange)="heightCm.set($event)"
            />
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="sex"
              labelKey="profile.sex"
              [options]="sexOptions"
              [value]="sex()"
              (valueChange)="sex.set($event)"
            />
            <p class="t-caption toggle__hint">{{ i18n.t('profile.sexHint') }}</p>
          </div>
        </rl-card>
      </section>

      <section class="group">
        <rl-card [inset]="false">
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="goal"
              labelKey="profile.goal"
              [options]="goalOptions"
              [value]="goal()"
              (valueChange)="goal.set($event)"
            />
          </div>
          <div class="group__control">
            <rl-segmented
              [showLabel]="true"
              name="experience"
              labelKey="profile.experience"
              [options]="experienceOptions"
              [value]="experience()"
              (valueChange)="experience.set($event)"
            />
          </div>
        </rl-card>
      </section>

      <rl-button
        variant="primary"
        [full]="true"
        [disabled]="!canSave()"
        [busy]="isSaving()"
        (click)="save()"
      >
        {{ i18n.t('common.save') }}
      </rl-button>
    </div>
  `,
})
export class ProfilePage {
  protected readonly i18n = inject(I18n);
  private readonly repo = inject(PROFILE_REPO);
  private readonly toasts = inject(ToastService);
  private readonly clock = inject(CLOCK);

  /**
   * Signal Forms for the two text fields, with the name length bounded.
   *
   * The model holds empty strings rather than nulls because that is what a
   * native input has when it is empty; the nulls the database wants are made
   * on the way out, in `save`. Keeping the conversion at the boundary means
   * the form never has to represent "empty" twice.
   */
  private readonly model = signal({ displayName: '', birthDate: '' });

  protected readonly profileForm = form(this.model, (path) => {
    maxLength(path.displayName, NAME_LIMIT);
  });

  protected readonly heightCm = signal<number | null>(null);
  protected readonly sex = signal<Sex>('unspecified');
  protected readonly goal = signal<TrainingGoal | ''>('');
  protected readonly experience = signal<ExperienceLevel | ''>('');

  private readonly saving = signal(false);
  protected readonly isSaving = this.saving.asReadonly();

  protected readonly canSave = computed(() => this.profileForm().valid() && !this.saving());

  protected readonly sexOptions: readonly SegmentedOption<Sex>[] = [
    { value: 'male', labelKey: 'sex.male' },
    { value: 'female', labelKey: 'sex.female' },
    { value: 'unspecified', labelKey: 'sex.unspecified' },
  ];

  /** Blank first, so "no answer" is a visible choice and not just the default. */
  protected readonly goalOptions: readonly SegmentedOption<TrainingGoal | ''>[] = [
    { value: '', labelKey: 'profile.empty' },
    { value: 'strength', labelKey: 'goal.strength' },
    { value: 'hypertrophy', labelKey: 'goal.hypertrophy' },
    { value: 'general', labelKey: 'goal.general' },
  ];

  protected readonly experienceOptions: readonly SegmentedOption<ExperienceLevel | ''>[] = [
    { value: '', labelKey: 'profile.empty' },
    { value: 'beginner', labelKey: 'experience.beginner' },
    { value: 'intermediate', labelKey: 'experience.intermediate' },
    { value: 'advanced', labelKey: 'experience.advanced' },
  ];

  constructor() {
    void this.load();
  }

  protected today(): string {
    return new Date(this.clock.now()).toISOString().slice(0, 10);
  }

  private async load(): Promise<void> {
    const existing = await this.repo.get(PROFILE_ID);
    if (!existing) return;

    this.model.set({
      displayName: existing.displayName ?? '',
      birthDate: existing.birthDate ?? '',
    });
    this.heightCm.set(existing.heightCm);
    this.sex.set(existing.sex);
    this.goal.set(existing.goal ?? '');
    this.experience.set(existing.experienceLevel ?? '');
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const { displayName, birthDate } = this.model();
      // Blank means "not set", which is null in the database. An empty string
      // would be a value the user never typed.
      await this.repo.put({
        id: PROFILE_ID,
        displayName: blankToNull(displayName),
        birthDate: blankToNull(birthDate),
        sex: this.sex(),
        heightCm: this.heightCm(),
        goal: this.goal() === '' ? null : (this.goal() as TrainingGoal),
        experienceLevel: this.experience() === '' ? null : (this.experience() as ExperienceLevel),
        avatarBlobId: null,
      } as never);

      this.toasts.success(this.i18n.t('profile.saved'));
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    } finally {
      this.saving.set(false);
    }
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
