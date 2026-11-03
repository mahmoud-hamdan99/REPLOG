import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { ToastService } from '../../core/toast/toast.service';
import { customDeltaFor, deltaFor } from '../../domain/body/compare';
import {
  MEASUREMENT_ROWS,
  recordedFields,
  sideOf,
  unitTypeOf,
  type MeasurementField,
} from '../../domain/body/fields';
import { checkField, checkValue } from '../../domain/body/validation';
import type { CustomMeasurementDef, Measurement } from '../../domain/models/body';
import type { MeasurementUnitType } from '../../domain/models/enums';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { MeasurementField as MeasurementFieldInput } from '../../shared/ui/measurement-field';
import { Sheet } from '../../shared/ui/sheet';
import { MeasurementsStore, type MeasurementDraft } from './measurements.store';

const UNIT_TYPES: readonly MeasurementUnitType[] = ['length', 'mass', 'percent', 'count'];

/**
 * Body measurements.
 *
 * The screen is shaped by one fact: **a partial entry is the normal case.**
 * Most days someone only weighs themselves. So body weight is first and
 * focused, everything else is behind one disclosure, Save is live as soon as
 * any field has a value, and the list shows only what was actually recorded —
 * a row of blanks would make a normal entry look like a failed one.
 *
 * Out-of-range values are questioned rather than clamped
 * (DATABASE_SPEC section 10): the sheet asks "is 650 kg right?" and saves what
 * the user says, because silently replacing their number with a nicer one is
 * fabrication.
 */
@Component({
  selector: 'rl-body-page',
  styleUrl: './body.page.css',
  imports: [
    AppHeader,
    Badge,
    Button,
    Card,
    Chip,
    Dialog,
    EmptyState,
    MeasurementFieldInput,
    // The one structural directive here: a field row is rendered in two
    // places and there is no native control flow for reusing a template.
    NgTemplateOutlet,
    Sheet,
  ],
  template: `
    <rl-app-header titleKey="page.body.title">
      <button
        type="button"
        class="hdr-action"
        [attr.aria-label]="i18n.t('body.custom.title')"
        (click)="customOpen.set(true)"
      >
        <span aria-hidden="true">&#9881;</span>
      </button>
    </rl-app-header>

    <div class="page">
      @if (store.isLoading()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (store.error(); as error) {
        <rl-empty-state titleKey="state.error.title" bodyKey="state.error.body" />
        <p class="t-caption">{{ error }}</p>
      } @else if ((store.entries() ?? []).length === 0) {
        <rl-empty-state
          titleKey="body.empty.title"
          bodyKey="body.empty.body"
          actionKey="body.empty.action"
          (actioned)="openNew()"
        />
      } @else {
        <div class="top">
          <rl-button variant="primary" (click)="openNew()">{{ i18n.t('body.add') }}</rl-button>
          <rl-button variant="secondary" (click)="compareOpen.set(true)">
            {{ i18n.t('body.compare.open') }}
          </rl-button>
        </div>

        @for (entry of store.entries() ?? []; track entry.id) {
          <rl-card class="entry">
            <div class="entry__head">
              <button type="button" class="entry__open" (click)="openEdit(entry)">
                <span class="t-body-strong">{{ format.weekdayDay(entry.measuredAt) }}</span>
              </button>
              @if (entry.weightKg !== null) {
                <rl-badge kind="count">
                  {{ format.byUnitType('mass', entry.weightKg) }}
                </rl-badge>
              }
            </div>

            <!-- Only what was recorded. Blanks for everything else would make
                 a normal partial entry read as an incomplete one. -->
            <dl class="entry__values">
              @for (field of recorded(entry); track field) {
                <div class="entry__pair">
                  <dt class="t-caption">{{ fieldLabel(field) }}</dt>
                  <dd class="t-body">
                    {{ format.byUnitType(unitTypeOf(field), entry[field]) }}
                  </dd>
                </div>
              }
              @for (custom of recordedCustom(entry); track custom.id) {
                <div class="entry__pair">
                  <dt class="t-caption">{{ custom.label }}</dt>
                  <dd class="t-body">{{ custom.text }}</dd>
                </div>
              }
            </dl>

            @if (entry.notes) {
              <p class="t-caption entry__notes">{{ entry.notes }}</p>
            }
          </rl-card>
        }
      }
    </div>

    <!-- Entry sheet -->
    <rl-sheet [(open)]="sheetOpen" size="full" labelKey="body.add">
      <h2 class="t-h2 sheet__title">
        {{ editingId() === null ? i18n.t('body.add') : i18n.t('body.edit') }}
      </h2>
      <p class="t-caption">{{ i18n.t('body.allOptional') }}</p>

      <label class="field">
        <span class="t-label">{{ i18n.t('body.date') }}</span>
        <input
          class="field__input"
          type="date"
          [value]="draftDay()"
          (change)="draftDay.set($any($event.target).value)"
        />
      </label>

      @for (row of primaryRows; track row.group) {
        <ng-container *ngTemplateOutlet="fieldRow; context: { $implicit: row }" />
      }

      <button
        type="button"
        class="more"
        [attr.aria-expanded]="moreOpen()"
        (click)="moreOpen.set(!moreOpen())"
      >
        {{ i18n.t('body.more') }}
        <span aria-hidden="true">{{ moreOpen() ? '−' : '+' }}</span>
      </button>

      @if (moreOpen()) {
        @for (row of secondaryRows; track row.group) {
          <ng-container *ngTemplateOutlet="fieldRow; context: { $implicit: row }" />
        }

        @for (definition of store.definitions(); track definition.id) {
          <rl-measurement-field
            [label]="definition.label"
            [unitType]="definition.unitType"
            [value]="customValue(definition.id)"
            [previous]="customPrevious(definition.id)"
            [delta]="customDelta(definition.id)"
            (valueChange)="setCustom(definition.id, $event)"
          />
        }
      }

      <label class="field">
        <span class="t-label">{{ i18n.t('body.notes') }}</span>
        <textarea
          class="field__input"
          rows="2"
          [value]="draftNotes()"
          (input)="draftNotes.set($any($event.target).value)"
        ></textarea>
      </label>

      <div class="sheet-actions">
        @if (editingId() !== null) {
          <rl-button variant="danger" [full]="true" (click)="deleteOpen.set(true)">
            {{ i18n.t('body.delete') }}
          </rl-button>
        }
        <rl-button
          variant="primary"
          size="lg"
          [full]="true"
          [disabled]="!canSave()"
          (click)="save()"
        >
          {{ i18n.t('body.save') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- One row of the entry sheet: a single field, or a left/right pair. -->
    <ng-template #fieldRow let-row>
      @if (row.fields.length === 1) {
        <rl-measurement-field
          [label]="i18n.t('body.field.' + row.group)"
          [unitType]="row.unitType"
          [value]="valueFor(row.fields[0])"
          [previous]="previousFor(row.fields[0])"
          [delta]="deltaFor(row.fields[0])"
          (valueChange)="setValue(row.fields[0], $event)"
        />
      } @else {
        <div class="pair">
          @for (field of row.fields; track field) {
            <rl-measurement-field
              class="pair__half"
              [label]="i18n.t('body.field.' + row.group)"
              [sideLabel]="i18n.t('body.side.' + sideOf(field))"
              [unitType]="row.unitType"
              [value]="valueFor(field)"
              [previous]="previousFor(field)"
              [delta]="deltaFor(field)"
              (valueChange)="setValue(field, $event)"
            />
          }
        </div>
      }
    </ng-template>

    <!-- Custom measurement definitions -->
    <rl-sheet [(open)]="customOpen" size="full" labelKey="body.custom.title">
      <h2 class="t-h2 sheet__title">{{ i18n.t('body.custom.title') }}</h2>
      <p class="t-caption">{{ i18n.t('body.custom.archivedNote') }}</p>

      @for (definition of store.allDefinitions(); track definition.id) {
        <div class="def">
          <span class="t-body">{{ definition.label }}</span>
          <span class="t-caption">{{ i18n.t('unitType.' + definition.unitType) }}</span>
          @if (definition.isArchived === 1) {
            <rl-badge kind="neutral">{{ i18n.t('body.custom.archived') }}</rl-badge>
          }
          <rl-button
            variant="ghost"
            size="sm"
            (click)="store.archiveDefinition(definition.id, definition.isArchived === 0)"
          >
            {{
              definition.isArchived === 1
                ? i18n.t('body.custom.restore')
                : i18n.t('body.custom.archive')
            }}
          </rl-button>
        </div>
      }
      @if (store.allDefinitions().length === 0) {
        <p class="t-body">{{ i18n.t('body.custom.none') }}</p>
      }

      <label class="field">
        <span class="t-label">{{ i18n.t('body.custom.label') }}</span>
        <input
          class="field__input"
          type="text"
          [value]="newLabel()"
          (input)="newLabel.set($any($event.target).value)"
        />
      </label>

      <div class="field">
        <span class="t-label">{{ i18n.t('body.custom.unit') }}</span>
        <div class="chips">
          @for (unitType of unitTypes; track unitType) {
            <rl-chip [selected]="newUnitType() === unitType" (toggled)="newUnitType.set(unitType)">
              {{ i18n.t('unitType.' + unitType) }}
            </rl-chip>
          }
        </div>
      </div>

      <div class="sheet-actions">
        <rl-button
          variant="primary"
          [full]="true"
          [disabled]="newLabel().trim() === ''"
          (click)="addDefinition()"
        >
          {{ i18n.t('body.custom.add') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- Compare two dates -->
    <rl-sheet [(open)]="compareOpen" size="full" labelKey="body.compare.title">
      <h2 class="t-h2 sheet__title">{{ i18n.t('body.compare.title') }}</h2>

      <label class="field">
        <span class="t-label">{{ i18n.t('body.compare.from') }}</span>
        <select class="field__input" (change)="compareFrom.set($any($event.target).value)">
          <option value="">{{ i18n.t('body.compare.pick') }}</option>
          @for (entry of store.entries() ?? []; track entry.id) {
            <option [value]="entry.id" [selected]="compareFrom() === entry.id">
              {{ format.weekdayDay(entry.measuredAt) }}
            </option>
          }
        </select>
      </label>

      <label class="field">
        <span class="t-label">{{ i18n.t('body.compare.to') }}</span>
        <select class="field__input" (change)="compareTo.set($any($event.target).value)">
          <option value="">{{ i18n.t('body.compare.pick') }}</option>
          @for (entry of store.entries() ?? []; track entry.id) {
            <option [value]="entry.id" [selected]="compareTo() === entry.id">
              {{ format.weekdayDay(entry.measuredAt) }}
            </option>
          }
        </select>
      </label>

      @if (comparison().length === 0) {
        <p class="t-body">{{ i18n.t('body.compare.none') }}</p>
      } @else {
        @for (row of comparison(); track row.key) {
          <div class="cmp">
            <span class="t-body">
              {{ row.label ?? i18n.t('body.field.' + row.group) }}
              @if (row.side) {
                <span class="t-caption">{{ i18n.t('body.side.' + row.side) }}</span>
              }
            </span>
            @if (row.status === 'both') {
              <span class="cmp__values t-caption">
                <!-- Through i18n: the arrowhead has to turn around in Arabic,
                     and U+2192 is not a character bidi mirrors. -->
                {{ format.byUnitType(row.unitType, row.from) }}
                {{ i18n.t('common.arrow') }}
                {{ format.byUnitType(row.unitType, row.to) }}
              </span>
              <span class="cmp__delta">{{ format.delta(row.unitType, row.delta) }}</span>
            } @else {
              <!-- No delta where one side is missing: a gap stays a gap. -->
              <span class="cmp__missing t-caption">
                {{
                  row.status === 'missing-from'
                    ? i18n.t('body.compare.missingFrom')
                    : i18n.t('body.compare.missingTo')
                }}
              </span>
            }
          </div>
        }
      }
    </rl-sheet>

    <!-- Same-day duplicate -->
    <rl-dialog
      [(open)]="duplicateOpen"
      titleKey="body.duplicate.title"
      [bodyText]="duplicateBody()"
      confirmKey="body.duplicate.merge"
      cancelKey="body.duplicate.keep"
      (confirmed)="saveAndMerge()"
      (cancelled)="commit()"
    />

    <!-- Unusual value -->
    <rl-dialog
      [(open)]="confirmOpen"
      titleKey="body.confirm.title"
      [bodyText]="confirmBody()"
      confirmKey="body.confirm.yes"
      cancelKey="body.confirm.edit"
      (confirmed)="afterConfirm()"
    />

    <rl-dialog
      [(open)]="deleteOpen"
      titleKey="body.deleteTitle"
      [bodyText]="deleteBody()"
      confirmKey="body.delete"
      [destructive]="true"
      (confirmed)="remove()"
    />
  `,
})
export class BodyPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(MeasurementsStore);
  private readonly toasts = inject(ToastService);

  protected readonly unitTypes = UNIT_TYPES;
  protected readonly primaryRows = MEASUREMENT_ROWS.filter((row) => row.primary);
  protected readonly secondaryRows = MEASUREMENT_ROWS.filter((row) => !row.primary);

  protected readonly sheetOpen = signal(false);
  protected readonly customOpen = signal(false);
  protected readonly compareOpen = signal(false);
  protected readonly duplicateOpen = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly moreOpen = signal(false);

  protected readonly editingId = signal<string | null>(null);
  protected readonly draftDay = signal('');
  protected readonly draftNotes = signal('');
  private readonly draftValues = signal<Partial<Record<MeasurementField, number | null>>>({});
  private readonly draftCustom = signal<Record<string, number>>({});

  protected readonly newLabel = signal('');
  protected readonly newUnitType = signal<MeasurementUnitType>('length');

  protected readonly compareFrom = signal('');
  protected readonly compareTo = signal('');

  /** The value that triggered the "is this right?" question. */
  private readonly questioned = signal<{ label: string; value: string } | null>(null);

  protected readonly sideOf = sideOf;
  protected readonly unitTypeOf = unitTypeOf;
  protected readonly recorded = recordedFields;

  constructor() {
    void this.store.load();
  }

  // -------------------------------------------------------------------- list

  protected fieldLabel(field: MeasurementField): string {
    const row = MEASUREMENT_ROWS.find((candidate) => candidate.fields.includes(field));
    const base = this.i18n.t(`body.field.${row?.group ?? field}`);
    const side = sideOf(field);
    return side === null ? base : `${base} (${this.i18n.t(`body.side.${side}`)})`;
  }

  /** Custom values an entry carries, named through their definitions. */
  protected recordedCustom(entry: Measurement) {
    return Object.entries(entry.custom).flatMap(([id, value]) => {
      const definition = this.store.definitionById(id);
      if (!definition) return [];
      return [
        {
          id,
          label: definition.label,
          text: this.format.byUnitType(definition.unitType, value),
        },
      ];
    });
  }

  protected readonly comparison = computed(() =>
    this.compareFrom() === '' || this.compareTo() === ''
      ? []
      : this.store.comparison(this.compareFrom(), this.compareTo()),
  );

  // ------------------------------------------------------------------- sheet

  protected openNew(): void {
    this.editingId.set(null);
    this.draftDay.set(this.store.today());
    this.draftValues.set({});
    this.draftCustom.set({});
    this.draftNotes.set('');
    this.moreOpen.set(false);
    this.sheetOpen.set(true);
  }

  protected openEdit(entry: Measurement): void {
    this.editingId.set(entry.id);
    this.draftDay.set(entry.measuredAt);
    this.draftValues.set(
      Object.fromEntries(
        MEASUREMENT_ROWS.flatMap((row) => row.fields).map((field) => [field, entry[field]]),
      ),
    );
    this.draftCustom.set({ ...entry.custom });
    this.draftNotes.set(entry.notes ?? '');
    // Opened to whatever the entry already has, so an edit does not hide it.
    this.moreOpen.set(recordedFields(entry).some((field) => field !== 'weightKg'));
    this.sheetOpen.set(true);
  }

  protected valueFor(field: MeasurementField): number | null {
    return this.draftValues()[field] ?? null;
  }

  protected previousFor(field: MeasurementField): number | null {
    return this.store.previousFor(field, this.editingId() ?? undefined)?.[field] ?? null;
  }

  protected deltaFor(field: MeasurementField): number | null {
    return deltaFor(
      this.store.previousFor(field, this.editingId() ?? undefined),
      this.valueFor(field),
      field,
    );
  }

  protected setValue(field: MeasurementField, value: number | null): void {
    this.draftValues.update((values) => ({ ...values, [field]: value }));
  }

  protected customValue(definitionId: string): number | null {
    return this.draftCustom()[definitionId] ?? null;
  }

  protected customPrevious(definitionId: string): number | null {
    const previous = (this.store.entries() ?? []).find(
      (entry) => entry.id !== this.editingId() && entry.custom[definitionId] !== undefined,
    );
    return previous?.custom[definitionId] ?? null;
  }

  protected customDelta(definitionId: string): number | null {
    const previous = (this.store.entries() ?? []).find(
      (entry) => entry.id !== this.editingId() && entry.custom[definitionId] !== undefined,
    );
    return customDeltaFor(previous ?? null, this.customValue(definitionId), definitionId);
  }

  protected setCustom(definitionId: string, value: number | null): void {
    this.draftCustom.update((custom) => {
      const next = { ...custom };
      if (value === null) delete next[definitionId];
      else next[definitionId] = value;
      return next;
    });
  }

  /** Live as soon as anything has a value, as UI_UX_SPEC section 5.10 asks. */
  protected readonly canSave = computed(() => {
    const hasValue = Object.values(this.draftValues()).some((value) => value !== null);
    return hasValue || Object.keys(this.draftCustom()).length > 0;
  });

  // ------------------------------------------------------------------ saving

  /**
   * Checks before writing: question an unusual value, offer to merge a
   * duplicate day, then commit. Each step is a question the user answers;
   * nothing is altered on their behalf.
   */
  protected save(): void {
    const unusual = this.firstUnusual();
    if (unusual) {
      this.questioned.set(unusual);
      this.confirmOpen.set(true);
      return;
    }
    this.afterConfirm();
  }

  protected afterConfirm(): void {
    this.questioned.set(null);
    if (this.duplicates().length > 0) {
      this.duplicateOpen.set(true);
      return;
    }
    void this.commit();
  }

  /** Saves as a second entry for the day, which the schema allows. */
  protected async commit(): Promise<void> {
    try {
      await this.store.save(this.draft());
      this.sheetOpen.set(false);
      this.toasts.success(this.i18n.t('body.saved'));
    } catch (error) {
      this.toasts.error(this.messageFor(error));
    }
  }

  /** Saves, then folds the new entry into the one already on that day. */
  protected async saveAndMerge(): Promise<void> {
    const existing = this.duplicates()[0];
    if (!existing) return void this.commit();

    try {
      const saved = await this.store.save(this.draft());
      await this.store.merge(existing.id, saved.id);
      this.sheetOpen.set(false);
      this.toasts.success(this.i18n.t('body.merged'));
    } catch (error) {
      this.toasts.error(this.messageFor(error));
    }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    if (id === null) return;

    await this.store.remove(id);
    this.sheetOpen.set(false);
    this.toasts.undo(this.i18n.t('body.deleted'), () => void this.store.restore(id));
  }

  // ------------------------------------------------------------- definitions

  protected async addDefinition(): Promise<void> {
    try {
      await this.store.addDefinition(this.newLabel(), this.newUnitType());
      this.newLabel.set('');
    } catch (error) {
      this.toasts.error(this.messageFor(error));
    }
  }

  // ----------------------------------------------------------- dialog bodies

  protected confirmBody(): string {
    const question = this.questioned();
    return question === null
      ? ''
      : this.i18n.t('body.confirm.unusual', { label: question.label, value: question.value });
  }

  protected duplicateBody(): string {
    return this.i18n.t('body.duplicate.body', {
      date: this.format.weekdayDay(this.draftDay()),
    });
  }

  protected deleteBody(): string {
    const id = this.editingId();
    const entry = id === null ? undefined : this.store.byId(id);
    return this.i18n.t('body.deleteBody', {
      date: this.format.weekdayDay(entry?.measuredAt ?? this.draftDay()),
    });
  }

  // ----------------------------------------------------------------- private

  private draft(): MeasurementDraft {
    const notes = this.draftNotes().trim();
    return {
      ...(this.editingId() === null ? {} : { id: this.editingId() as string }),
      measuredAt: this.draftDay(),
      values: this.draftValues(),
      custom: this.draftCustom(),
      notes: notes === '' ? null : notes,
    };
  }

  private duplicates(): Measurement[] {
    return this.store.sameDay(this.draftDay(), this.editingId() ?? undefined);
  }

  /** The first value worth asking about, with the words to ask it. */
  private firstUnusual(): { label: string; value: string } | null {
    for (const [field, value] of Object.entries(this.draftValues())) {
      const key = field as MeasurementField;
      if (checkField(key, value ?? null).status === 'question') {
        return {
          label: this.fieldLabel(key),
          value: this.format.byUnitType(unitTypeOf(key), value ?? null),
        };
      }
    }

    for (const [id, value] of Object.entries(this.draftCustom())) {
      const definition: CustomMeasurementDef | undefined = this.store.definitionById(id);
      if (definition && checkValue(definition.unitType, value).status === 'question') {
        return {
          label: definition.label,
          value: this.format.byUnitType(definition.unitType, value),
        };
      }
    }

    return null;
  }

  /** Turns a validation error into words, falling back to a generic one. */
  private messageFor(error: unknown): string {
    const key =
      error !== null && typeof error === 'object' && 'messageKey' in error
        ? String((error as { messageKey?: string }).messageKey ?? '')
        : '';
    return key === '' ? this.i18n.t('state.error.title') : this.i18n.t(key, { min: 0, max: 0 });
  }
}
