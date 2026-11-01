import { Component, inject, input, output } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

/** Eyebrow section heading with an optional trailing action. */
@Component({
  selector: 'rl-section-header',
  styleUrl: './section-header.css',
  template: `
    <h2 class="t-micro section__title">{{ i18n.t(titleKey()) }}</h2>
    @if (actionKey()) {
      <button type="button" class="section__action" (click)="actioned.emit()">
        {{ i18n.t(actionKey()!) }}
      </button>
    }
  `,
})
export class SectionHeader {
  protected readonly i18n = inject(I18n);

  readonly titleKey = input.required<string>();
  readonly actionKey = input<string | undefined>(undefined);
  readonly actioned = output<void>();
}
