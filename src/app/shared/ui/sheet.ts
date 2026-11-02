import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';

/**
 * Bottom sheet.
 *
 * Built on the native `<dialog>` element with `showModal()`, which supplies the
 * focus trap, Escape-to-close, background inerting and a `::backdrop` — all
 * things a hand-rolled overlay tends to implement incompletely. The browser
 * floor for this project is iOS 17, where `<dialog>` is fully supported.
 */
@Component({
  selector: 'rl-sheet',
  styleUrl: './sheet.css',
  template: `
    <dialog
      #dialogRef
      class="sheet"
      [class.sheet--full]="size() === 'full'"
      [attr.aria-label]="label()"
      (cancel)="onCancel($event)"
      (close)="onClose()"
    >
      <div class="sheet__grip" aria-hidden="true"></div>
      <div class="sheet__body">
        <ng-content />
      </div>
    </dialog>
  `,
})
export class Sheet {
  protected readonly i18n = inject(I18n);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialogRef');

  readonly open = model(false);
  readonly size = input<'half' | 'full'>('half');
  readonly labelKey = input<string | undefined>(undefined);
  /** Already-translated label, for a sheet whose title is interpolated. */
  readonly labelText = input<string | undefined>(undefined);
  /**
   * Whether Escape and the backdrop may close this sheet.
   *
   * `false` for a sheet that exists to collect an answer. The leave prompt is
   * the clearest case: something is waiting on the choice, and an Escape that
   * closed it without choosing would leave that promise unresolved and the
   * navigation blocked for good.
   */
  readonly dismissible = input(true);

  readonly closed = output<void>();

  protected readonly label = computed(() => {
    const key = this.labelKey();
    return this.labelText() ?? (key === undefined ? null : this.i18n.t(key));
  });

  constructor() {
    effect(() => {
      const element = this.dialogRef().nativeElement;
      const shouldOpen = this.open();

      // showModal() throws if the dialog is already open, and close() on a
      // closed dialog fires a spurious 'close' event.
      if (shouldOpen && !element.open) {
        element.showModal();
        this.settleEntry(element);
      } else if (!shouldOpen && element.open) {
        element.close();
      }
    });
  }

  /** Escape and backdrop dismissal, which the platform fires as `cancel`. */
  protected onCancel(event: Event): void {
    if (!this.dismissible()) {
      event.preventDefault();
    }
  }

  protected onClose(): void {
    this.open.set(false);
    this.closed.emit();
  }

  /**
   * Guarantees the sheet ends up where it belongs, animation or not.
   *
   * A CSS transition advances on the document timeline, and a document that is
   * not painting — backgrounded, throttled, or an embedded preview — does not
   * advance it. The transition then sits at its first frame for as long as that
   * lasts, which for a slide-up from `@starting-style` means the sheet is a
   * full viewport below the fold with nothing to interact with.
   *
   * This is the same failure the entry *animation* had, and swapping to a
   * transition did not fix it: an unrun transition holds its starting style
   * exactly as an unrun animation holds its first keyframe.
   *
   * So the component checks instead of assuming. One sheet-duration later, a
   * transition still at exactly zero is one whose timeline is not running, and
   * finishing it trades the slide — which nobody is watching anyway, since the
   * page is not painting — for a sheet that is usable the moment it is seen.
   */
  private settleEntry(element: HTMLDialogElement): void {
    // A timer, not requestAnimationFrame: frames are the thing that is not
    // arriving, so asking for one would wait forever.
    setTimeout(() => {
      for (const animation of element.getAnimations()) {
        if (animation.currentTime === 0) {
          animation.finish();
        }
      }
    }, SETTLE_MS);
  }
}

/** One sheet transition. Past this, a frozen timeline is not a slow frame. */
const SETTLE_MS = 300;
