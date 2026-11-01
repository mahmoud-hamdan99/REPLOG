import { Component, computed, input } from '@angular/core';

/**
 * Circular progress, used by the rest timer and the consistency tile.
 *
 * Presentational by default (`aria-hidden`): the number inside is the
 * accessible content, and the rest timer announces completion through a live
 * region rather than through this element. Pass `labelText` to make it a
 * standalone meter.
 */
@Component({
  selector: 'rl-progress-ring',
  styleUrl: './progress-ring.css',
  host: {
    '[attr.role]': 'labelText() ? "meter" : null',
    '[attr.aria-hidden]': 'labelText() ? null : "true"',
    '[attr.aria-valuenow]': 'labelText() ? percent() : null',
    '[attr.aria-valuemin]': 'labelText() ? 0 : null',
    '[attr.aria-valuemax]': 'labelText() ? 100 : null',
    '[attr.aria-label]': 'labelText()',
  },
  template: `
    <svg class="ring" [attr.viewBox]="viewBox()" aria-hidden="true">
      <circle
        class="ring__track"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        [attr.stroke-width]="stroke()"
      />
      <circle
        class="ring__fill"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        [attr.stroke-width]="stroke()"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="offset()"
      />
    </svg>
    <div class="ring__content"><ng-content /></div>
  `,
})
export class ProgressRing {
  /** Completion from 0 to 1. Clamped. */
  readonly value = input.required<number>();
  readonly size = input(96);
  readonly stroke = input(6);
  /** Already-translated accessible label; omit for a decorative ring. */
  readonly labelText = input<string | undefined>(undefined);

  protected readonly clamped = computed(() => Math.min(1, Math.max(0, this.value())));
  protected readonly percent = computed(() => Math.round(this.clamped() * 100));
  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => (this.size() - this.stroke()) / 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly offset = computed(() => this.circumference() * (1 - this.clamped()));
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
}
