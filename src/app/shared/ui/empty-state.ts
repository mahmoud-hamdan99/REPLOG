import { Component, inject, input, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { Button } from './button';

/**
 * Empty and error states.
 *
 * Every data surface must render one of these rather than nothing
 * (docs/UI_UX_SPEC.md section 11): an empty screen has to say what to do next,
 * and must never show a fabricated chart or a zero dressed up as progress.
 */
@Component({
  selector: 'rl-empty-state',
  styleUrl: './empty-state.css',
  imports: [Button],
  template: `
    <p class="t-h3 empty__title">{{ i18n.t(titleKey()) }}</p>
    @if (bodyKey()) {
      <p class="t-body empty__body">{{ i18n.t(bodyKey()!) }}</p>
    }
    @if (actionKey()) {
      <rl-button variant="primary" (click)="actioned.emit()">
        {{ i18n.t(actionKey()!) }}
      </rl-button>
    }
  `,
})
export class EmptyState {
  protected readonly i18n = inject(I18n);

  readonly titleKey = input.required<string>();
  readonly bodyKey = input<string | undefined>(undefined);
  readonly actionKey = input<string | undefined>(undefined);
  readonly actioned = output<void>();
}
