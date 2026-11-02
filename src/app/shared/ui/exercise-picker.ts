import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { Sheet } from './sheet';

export interface PickerItem {
  id: string;
  /** Already resolved to the reading language by the caller. */
  name: string;
  /** Equipment, muscle — whatever distinguishes two similar names. */
  detail: string | null;
}

/**
 * Exercise picker, shared by the planner, the tracker and the replace flow.
 *
 * Deliberately dumb: it takes a resolved list and emits ids. Reaching into the
 * library store from `shared/` would invert the dependency rule
 * (docs/ARCHITECTURE.md section 3) — and the three callers want three different
 * sources anyway, one of them filtered to a single muscle group.
 *
 * The search box is two-way bound rather than filtering internally, so the
 * caller's own ranked search is what the user sees. The library's relevance
 * ranking is not something to reimplement here.
 */
@Component({
  selector: 'rl-exercise-picker',
  styleUrl: './exercise-picker.css',
  imports: [Button, EmptyState, Sheet],
  template: `
    <rl-sheet [(open)]="open" size="full" [labelKey]="titleKey()">
      <h2 class="t-h2 pick__title">{{ i18n.t(titleKey()) }}</h2>

      <input
        class="pick__search"
        type="search"
        autocomplete="off"
        [attr.aria-label]="i18n.t('exercises.search.placeholder')"
        [attr.placeholder]="i18n.t('exercises.search.placeholder')"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />

      @if (loading()) {
        <!-- "Nothing matches" would be a lie while the catalog is still
             loading, and on a first run that takes a few seconds. -->
        <p class="pick__loading t-body" role="status">{{ i18n.t('state.loading.label') }}</p>
      } @else if (items().length === 0) {
        <rl-empty-state titleKey="picker.none" bodyKey="exercises.search.placeholder" />
      } @else {
        <ul class="pick__list" role="listbox" [attr.aria-multiselectable]="multiple()">
          @for (item of items(); track item.id) {
            <li>
              <button
                type="button"
                class="pick__item"
                role="option"
                [class.pick__item--on]="selected().has(item.id)"
                [attr.aria-selected]="selected().has(item.id)"
                (click)="toggle(item.id)"
              >
                <span class="pick__name t-body-strong">{{ item.name }}</span>
                @if (item.detail) {
                  <span class="t-caption">{{ item.detail }}</span>
                }
                @if (selected().has(item.id)) {
                  <span class="pick__tick" aria-hidden="true">&#10003;</span>
                }
              </button>
            </li>
          }
        </ul>
      }

      <div class="pick__actions">
        <rl-button
          variant="primary"
          [full]="true"
          [disabled]="selected().size === 0"
          (click)="confirm()"
        >
          {{
            multiple() ? i18n.t('picker.add', { count: selected().size }) : i18n.t('picker.replace')
          }}
        </rl-button>
      </div>
    </rl-sheet>
  `,
})
export class ExercisePicker {
  protected readonly i18n = inject(I18n);

  readonly open = model(false);
  readonly query = model('');
  readonly titleKey = input('picker.title');
  readonly items = input.required<readonly PickerItem[]>();
  /** Single-select is the replace flow: one tap replaces the selection. */
  readonly multiple = input(true);
  /** The caller's source is still loading, so an empty list means nothing yet. */
  readonly loading = input(false);

  readonly picked = output<string[]>();

  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly count = computed(() => this.selected().size);

  /** Clears the selection and the query, so a reopened sheet starts clean. */
  reset(): void {
    this.selected.set(new Set());
    this.query.set('');
  }

  protected toggle(id: string): void {
    this.selected.update((current) => {
      if (!this.multiple()) {
        return current.has(id) ? new Set() : new Set([id]);
      }
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected confirm(): void {
    const ids = [...this.selected()];
    if (ids.length === 0) return;
    this.picked.emit(ids);
    this.open.set(false);
    this.reset();
  }
}
