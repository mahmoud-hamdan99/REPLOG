import { Component, inject, input, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { Badge } from './badge';

/**
 * A suggestion for the next set.
 *
 * Three rules, all from PRODUCT_SPEC section 4.5, and all visible in the
 * markup rather than enforced somewhere else:
 *
 *   - it is **ghost text**, styled apart from logged values, so it never reads
 *     as something that happened
 *   - it carries its **reason**, because a number with no argument behind it
 *     is just an instruction
 *   - it is **accepted by a tap**. This component emits; it does not write,
 *     and nothing reaches a set until the user asks for it
 *
 * The estimate badge is not decoration. Every projected value in the app
 * carries it, so "calculated" and "recorded" never look alike.
 */
@Component({
  selector: 'rl-suggestion-hint',
  styleUrl: './suggestion-hint.css',
  imports: [Badge],
  template: `
    <div class="hint">
      <div class="hint__head">
        <rl-badge kind="estimate">{{ i18n.t('suggest.title') }}</rl-badge>
        <span class="hint__value t-body-strong">{{ valueText() }}</span>
      </div>

      <p class="hint__reason t-caption">{{ reasonText() }}</p>

      <button type="button" class="hint__apply" (click)="accepted.emit()">
        {{ i18n.t('suggest.apply') }}
      </button>
    </div>
  `,
})
export class SuggestionHint {
  protected readonly i18n = inject(I18n);

  /** Already formatted by the caller: "102.5 kg × 8". */
  readonly valueText = input.required<string>();
  /** Already translated, with its numbers interpolated. */
  readonly reasonText = input.required<string>();

  readonly accepted = output<void>();
}
