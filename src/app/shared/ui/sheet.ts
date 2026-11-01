import { Component, effect, ElementRef, inject, input, model, viewChild } from '@angular/core';
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
      [attr.aria-label]="labelKey() ? i18n.t(labelKey()!) : null"
      (close)="open.set(false)"
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

  constructor() {
    effect(() => {
      const element = this.dialogRef().nativeElement;
      const shouldOpen = this.open();

      // showModal() throws if the dialog is already open, and close() on a
      // closed dialog fires a spurious 'close' event.
      if (shouldOpen && !element.open) {
        element.showModal();
      } else if (!shouldOpen && element.open) {
        element.close();
      }
    });
  }
}
