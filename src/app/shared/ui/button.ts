import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Wraps a real `<button>` so assistive technology and keyboard behaviour come
 * from the platform rather than from ARIA patched onto a div.
 *
 * Sizes map to the touch-target rules in docs/UI_UX_SPEC.md section 3.7:
 * sm 36 / md 44 (the minimum) / lg 52.
 */
@Component({
  selector: 'rl-button',
  styleUrl: './button.css',
  template: `
    <button
      [attr.type]="type()"
      [disabled]="disabled() || busy()"
      [class]="classes()"
      [attr.aria-busy]="busy() ? 'true' : null"
    >
      <ng-content />
    </button>
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly full = input(false);
  readonly disabled = input(false);
  readonly busy = input(false);
  readonly type = input<'button' | 'submit'>('button');

  protected readonly classes = computed(
    () => `btn btn--${this.variant()} btn--${this.size()}` + (this.full() ? ' btn--full' : ''),
  );
}
