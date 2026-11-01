import { Component, computed, input } from '@angular/core';

/**
 * Surface container. `accentEdge` marks the one card that currently matters —
 * the active exercise in the workout tracker.
 */
@Component({
  selector: 'rl-card',
  styleUrl: './card.css',
  host: { '[class]': 'classes()' },
  template: '<ng-content />',
})
export class Card {
  readonly accentEdge = input(false);
  readonly inset = input(true);

  protected readonly classes = computed(
    () =>
      'card' + (this.accentEdge() ? ' card--accent' : '') + (this.inset() ? ' card--inset' : ''),
  );
}
