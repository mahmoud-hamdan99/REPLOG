import { Component, computed, input } from '@angular/core';

export type IconName = 'home' | 'plans' | 'train' | 'progress' | 'more' | 'chevron' | 'check';

/**
 * Inline SVG icon set.
 *
 * Inline rather than a sprite or icon font so icons inherit `currentColor` and
 * theme automatically, and so there is no extra request to block first paint.
 * Emoji are not used as UI icons: inconsistent rendering across platforms, no
 * theming, and poor RTL behaviour.
 */
@Component({
  selector: 'rl-icon',
  styleUrl: './icon.css',
  host: { '[class.icon--directional]': 'directional()' },
  template: `
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path [attr.d]="path()" [attr.fill]="filled() ? 'currentColor' : 'none'" />
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly filled = input(false);

  /** Directional icons mirror in RTL; glyphs like a check or a timer do not. */
  protected readonly directional = computed(() => this.name() === 'chevron');

  protected readonly path = computed(() => PATHS[this.name()]);
}

const PATHS: Record<IconName, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  plans: 'M4 6h12M4 12h16M4 18h9M18.5 15.5v5M16 18h5',
  train: 'M9 6.5v11l9-5.5z',
  progress: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
  check: 'M5 13l4.5 4.5L19 7',
};
