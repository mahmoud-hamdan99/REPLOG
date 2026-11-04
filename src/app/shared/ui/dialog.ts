import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { Button } from './button';

/**
 * Confirmation dialog.
 *
 * Three strengths, matching the destructive-action policy in
 * docs/DATABASE_SPEC.md section 9.3:
 *   - plain confirm
 *   - `destructive`, which colours the action and puts it on the trailing side
 *   - `typedConfirmPhrase`, which requires the user to type a word for the
 *     genuinely unrecoverable operations (reset all data, import in replace
 *     mode)
 *
 * The confirm label is always a verb supplied by the caller. "OK" is not an
 * acceptable label for an action that destroys something.
 */
@Component({
  selector: 'rl-dialog',
  styleUrl: './dialog.css',
  imports: [Button],
  template: `
    <dialog
      #dialogRef
      class="dlg"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="body() ? bodyId : null"
      (close)="open.set(false)"
    >
      <h2 class="t-h2 dlg__title" [id]="titleId">{{ i18n.t(titleKey()) }}</h2>

      @if (body(); as text) {
        <p class="t-body dlg__body" [id]="bodyId">{{ text }}</p>
      }

      @if (typedConfirmPhrase()) {
        <label class="dlg__typed">
          <span class="t-label">{{
            i18n.t('dialog.typeToConfirm', { phrase: typedConfirmPhrase()! })
          }}</span>
          <input
            class="dlg__input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            [value]="typed()"
            (input)="typed.set($any($event.target).value)"
          />
        </label>
      }

      <div class="dlg__actions">
        <rl-button variant="secondary" (click)="cancel()">
          {{ i18n.t(cancelKey()) }}
        </rl-button>
        <rl-button
          [variant]="destructive() ? 'danger' : 'primary'"
          [disabled]="!canConfirm()"
          (click)="confirm()"
        >
          {{ i18n.t(confirmKey()) }}
        </rl-button>
      </div>
    </dialog>
  `,
})
export class Dialog {
  protected readonly i18n = inject(I18n);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialogRef');

  readonly open = model(false);
  readonly titleKey = input.required<string>();
  readonly bodyKey = input<string | undefined>(undefined);
  /** Already-translated body, for a message with interpolated values. */
  readonly bodyText = input<string | undefined>(undefined);
  readonly confirmKey = input('common.confirm');
  readonly cancelKey = input('common.cancel');
  readonly destructive = input(false);
  /** When set, the user must type this exact phrase to enable confirmation. */
  readonly typedConfirmPhrase = input<string | undefined>(undefined);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly titleId = `dlg-title-${nextId()}`;
  protected readonly bodyId = `dlg-body-${nextId()}`;
  protected readonly typed = signal('');

  protected readonly body = computed(() => {
    const key = this.bodyKey();
    return this.bodyText() ?? (key === undefined ? null : this.i18n.t(key));
  });

  /**
   * Trimmed, not loosened. The phrase still has to match exactly — that is
   * the point of the gate — but a trailing space from an on-screen keyboard
   * is not a different answer, and reading as a refusal would make the
   * dialog look broken at the moment it matters most.
   */
  protected readonly canConfirm = computed(() => {
    const phrase = this.typedConfirmPhrase();
    return phrase === undefined || this.typed().trim() === phrase.trim();
  });

  constructor() {
    effect(() => {
      const element = this.dialogRef().nativeElement;
      const shouldOpen = this.open();
      if (shouldOpen && !element.open) {
        this.typed.set('');
        element.showModal();
      } else if (!shouldOpen && element.open) {
        element.close();
      }
    });
  }

  protected confirm(): void {
    if (!this.canConfirm()) {
      return;
    }
    this.confirmed.emit();
    this.open.set(false);
  }

  protected cancel(): void {
    this.cancelled.emit();
    this.open.set(false);
  }
}

let idCounter = 0;
function nextId(): number {
  return ++idCounter;
}
