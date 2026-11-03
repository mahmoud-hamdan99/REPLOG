import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

/**
 * One tile in the photo grid.
 *
 * It is handed a URL and never makes one. Creating an object URL here would
 * mean revoking it on destroy, on input change, on list reorder and on delete,
 * and the first of those missed leaks a photo's worth of memory with nothing
 * on screen to show for it. The store owns the lifecycle
 * (UI_UX_SPEC section 6.2) and this renders what it is given.
 *
 * `url` being null is the ordinary loading state, not a failure: the store
 * starts the read when the tile first asks. A decode that genuinely failed
 * shows a tile that says so and offers removal, rather than a silent gap that
 * reads as a deleted photo.
 */
@Component({
  selector: 'rl-photo-thumb',
  styleUrl: './photo-thumb.css',
  host: {
    '[class.pt--selected]': 'selected()',
    '[class.pt--blurred]': 'isHidden()',
  },
  template: `
    <button
      type="button"
      class="pt__button"
      [attr.aria-label]="label()"
      [attr.aria-pressed]="selectable() ? selected() : null"
      (click)="onClick()"
    >
      @if (url(); as source) {
        <img
          class="pt__img"
          [src]="source"
          [alt]="alt()"
          decoding="async"
          loading="lazy"
          (error)="broken.set(true)"
        />
      } @else if (broken()) {
        <span class="pt__broken t-caption">{{ i18n.t('photos.broken') }}</span>
      } @else {
        <span class="pt__placeholder" aria-hidden="true"></span>
      }

      @if (isHidden()) {
        <span class="pt__veil t-caption">{{ i18n.t('photos.tapToReveal') }}</span>
      }

      @if (selected()) {
        <span class="pt__check" aria-hidden="true">&#10003;</span>
      }
    </button>
  `,
})
export class PhotoThumb {
  protected readonly i18n = inject(I18n);

  /** Object URL, or null while the store is reading the blob. */
  readonly url = input<string | null>(null);
  /** Already-translated description — pose and date, not "photo". */
  readonly alt = input('');
  readonly selectable = input(false);
  readonly selected = model(false);
  /** Whether the privacy blur applies to this tile. */
  readonly blurred = input(false);

  readonly activated = output<void>();

  /** Set once an <img> reports a decode failure, so the tile can say so. */
  protected readonly broken = signal(false);

  /** Revealed by a tap, for as long as the tile is on screen. */
  private readonly revealed = signal(false);

  protected readonly isHidden = computed(() => this.blurred() && !this.revealed());

  protected readonly label = computed(() =>
    this.isHidden() ? this.i18n.t('photos.tapToReveal') : this.alt(),
  );

  protected onClick(): void {
    // The first tap on a blurred tile reveals it and does nothing else: a tap
    // that both revealed and opened would show the photo full-screen to
    // someone who only wanted to check which one it was.
    if (this.isHidden()) {
      this.revealed.set(true);
      return;
    }

    if (this.selectable()) {
      this.selected.set(!this.selected());
      return;
    }

    this.activated.emit();
  }
}
