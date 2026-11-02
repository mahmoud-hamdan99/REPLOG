import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { Button } from './button';
import { Sheet } from './sheet';

type Field = 'weight' | 'reps';

/** 1–9, laid out as a phone keypad; 0 sits on the bottom row. */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export interface PadValue {
  weight: number | null;
  reps: number | null;
}

/**
 * The gym keypad.
 *
 * UI_UX_SPEC section 6.4. The native iOS keyboard is the wrong tool for
 * logging a set: it covers half the screen, animates in slowly, its decimal
 * layout varies by locale, and `type="number"` brings spinners and validation
 * quirks. So the app draws its own pad.
 *
 * It is a *convenience layer, never the only path*: a real labelled
 * `inputmode="decimal"` input sits behind it for screen-reader and keyboard
 * users, and the pad accepts hardware keystrokes directly.
 *
 * Values here are in **display units**. Conversion to canonical kilograms
 * happens in the caller, which is the only place allowed to convert.
 */
@Component({
  selector: 'rl-numeric-pad',
  styleUrl: './numeric-pad.css',
  imports: [Button, Sheet],
  // On the host, not on a div inside the dialog: key events bubble up to here,
  // and a div with a key handler would need a tabindex it has no business
  // having.
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <rl-sheet [(open)]="open" [labelText]="titleText()">
      <div class="pad">
        <h2 class="t-h3 pad__title">{{ titleText() }}</h2>

        <div class="pad__fields">
          @if (showWeight()) {
            <button
              type="button"
              class="pad__field"
              [class.pad__field--active]="field() === 'weight'"
              [attr.aria-pressed]="field() === 'weight'"
              (click)="field.set('weight')"
            >
              <span class="t-micro">{{ i18n.t('pad.weight') }}</span>
              <span class="pad__value t-stat-sm">
                {{ display('weight') }}
                <span class="pad__unit t-caption">{{ unitShort() }}</span>
              </span>
            </button>
          }
          <button
            type="button"
            class="pad__field"
            [class.pad__field--active]="field() === 'reps'"
            [attr.aria-pressed]="field() === 'reps'"
            (click)="field.set('reps')"
          >
            <span class="t-micro">{{ i18n.t('pad.reps') }}</span>
            <span class="pad__value t-stat-sm">{{ display('reps') }}</span>
          </button>
        </div>

        <!-- The accessible path: a real input bound to the active field, so
             the pad is never the only way to enter a value. -->
        <label class="sr-only" [attr.for]="inputId">
          {{ field() === 'weight' ? i18n.t('pad.weight') : i18n.t('pad.reps') }}
        </label>
        <input
          class="sr-only"
          [id]="inputId"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          [value]="buffer()"
          (input)="setBuffer($any($event.target).value)"
        />

        @if (previousText()) {
          <p class="pad__prev t-caption">
            {{ i18n.t('pad.lastTime', { value: previousText()! }) }}
          </p>
        }

        @if (showWeight() && field() === 'weight') {
          <div class="pad__quick" role="group" [attr.aria-label]="i18n.t('pad.quickAdjust')">
            @for (step of quickSteps(); track step) {
              <button type="button" class="pad__step" (click)="nudge(step)">
                {{ signed(step) }}
              </button>
            }
          </div>
        }

        <div class="pad__keys">
          @for (digit of digits; track digit) {
            <button
              type="button"
              class="pad__key"
              [attr.aria-label]="i18n.t('pad.digit', { digit: i18n.formatNumber(+digit) })"
              (click)="append(digit)"
            >
              {{ i18n.formatNumber(+digit) }}
            </button>
          }

          @if (field() === 'reps') {
            <!-- No fractional reps, so a decimal key would be dead space; 00
                 is the one that earns it. -->
            <button
              type="button"
              class="pad__key"
              [attr.aria-label]="i18n.t('pad.doubleZero')"
              (click)="append('00')"
            >
              {{ i18n.formatNumber(0) }}{{ i18n.formatNumber(0) }}
            </button>
          } @else {
            <button
              type="button"
              class="pad__key"
              [attr.aria-label]="i18n.t('pad.decimal')"
              (click)="append(separator())"
            >
              {{ separator() }}
            </button>
          }

          <button
            type="button"
            class="pad__key"
            [attr.aria-label]="i18n.t('pad.digit', { digit: i18n.formatNumber(0) })"
            (click)="append('0')"
          >
            {{ i18n.formatNumber(0) }}
          </button>
          <button
            type="button"
            class="pad__key"
            [attr.aria-label]="i18n.t('pad.clear')"
            (click)="clear()"
          >
            C
          </button>

          <button
            type="button"
            class="pad__key pad__key--wide"
            [attr.aria-label]="i18n.t('pad.backspace')"
            (click)="backspace()"
          >
            &#9003;
          </button>
          <button
            type="button"
            class="pad__key pad__key--wide"
            [attr.aria-label]="i18n.t('pad.next')"
            (click)="nextField()"
          >
            {{ i18n.t('pad.next') }}
          </button>
        </div>

        <div class="pad__done">
          <rl-button variant="primary" size="lg" [full]="true" (click)="commit()">
            {{ i18n.t('pad.done') }}
          </rl-button>
        </div>
      </div>
    </rl-sheet>
  `,
})
export class NumericPad {
  protected readonly i18n = inject(I18n);
  protected readonly digits = DIGITS;
  protected readonly inputId = `pad-input-${nextId()}`;

  readonly open = model(false);
  /** Already translated: "Bench Press · set 3". */
  readonly titleText = input.required<string>();
  /** Seeded into the buffers when the pad opens, not tracked afterwards. */
  readonly initialWeight = input<number | null>(null);
  readonly initialReps = input<number | null>(null);
  /** False for bodyweight, time and distance work, which have no load field. */
  readonly showWeight = input(true);
  /** Which field the pad lands on, from the field the user tapped. */
  readonly startField = input<Field>('weight');
  readonly unitShort = input('kg');
  /** The exercise's own smallest sensible step, in display units. */
  readonly increment = input(2.5);
  /** "30 kg × 8", or null with no history. */
  readonly previousText = input<string | null>(null);

  readonly changed = output<PadValue>();
  /** Done: commit the set and start the rest in one tap. */
  readonly done = output<void>();

  protected readonly field = signal<Field>('weight');
  private readonly weightText = signal('');
  private readonly repsText = signal('');

  /** The locale's decimal separator, so the key matches what people expect. */
  protected readonly separator = computed(() => {
    const parts = new Intl.NumberFormat(this.i18n.locale()).formatToParts(1.1);
    return parts.find((part) => part.type === 'decimal')?.value ?? '.';
  });

  protected readonly quickSteps = computed(() => {
    const step = this.increment();
    return [-step, step, step * 2];
  });

  protected readonly buffer = computed(() =>
    this.field() === 'weight' ? this.weightText() : this.repsText(),
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      // Seeded `untracked`: reading the values reactively would reset the
      // buffer on every keystroke, turning a half-typed "2." back into "2".
      untracked(() => {
        this.field.set(this.showWeight() ? this.startField() : 'reps');
        this.weightText.set(text(this.initialWeight()));
        this.repsText.set(text(this.initialReps()));
      });
    });
  }

  /** Localised digits, so the field matches the keys being pressed. */
  protected display(field: Field): string {
    const raw = field === 'weight' ? this.weightText() : this.repsText();
    if (raw === '') return '—';
    return [...raw]
      .map((character) =>
        character >= '0' && character <= '9'
          ? this.i18n.formatNumber(Number(character))
          : this.separator(),
      )
      .join('');
  }

  protected setBuffer(value: string): void {
    this.write(sanitise(value, this.separator(), this.field() === 'reps'));
  }

  protected append(key: string): void {
    const current = this.buffer();
    if (key === this.separator()) {
      if (current.includes('.')) return;
      this.write(`${current === '' ? '0' : current}.`);
      return;
    }
    this.write(`${current}${key}`);
  }

  protected backspace(): void {
    this.write(this.buffer().slice(0, -1));
  }

  protected clear(): void {
    this.write('');
  }

  /** Quick-adjust by the exercise's own increment, never below zero. */
  protected nudge(delta: number): void {
    const current = parse(this.weightText()) ?? 0;
    this.write(text(Math.max(0, Math.round((current + delta) * 100) / 100)));
  }

  protected signed(step: number): string {
    const sign = step < 0 ? '−' : '+';
    return `${sign}${this.i18n.formatNumber(Math.abs(step))}`;
  }

  protected nextField(): void {
    this.field.set(this.field() === 'reps' && this.showWeight() ? 'weight' : 'reps');
  }

  protected commit(): void {
    this.open.set(false);
    this.done.emit();
  }

  /**
   * Hardware keyboard support.
   *
   * `Tab` is left to the browser on purpose: the fields and every key are
   * focusable, so native tabbing already reaches them, and hijacking Tab would
   * fight the focus trap the native `<dialog>` provides.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const key = event.key;

    if (key >= '0' && key <= '9') {
      this.append(key);
    } else if ((key === '.' || key === ',') && this.field() === 'weight') {
      this.append(this.separator());
    } else if (key === 'Backspace') {
      this.backspace();
    } else if (key === 'Enter') {
      this.commit();
    } else {
      return;
    }

    event.preventDefault();
  }

  private write(raw: string): void {
    const value = this.field() === 'reps' ? raw.replace(/\./g, '') : raw;
    if (this.field() === 'weight') {
      this.weightText.set(value);
    } else {
      this.repsText.set(value);
    }

    const reps = parse(this.repsText());
    this.changed.emit({
      weight: parse(this.weightText()),
      reps: reps === null ? null : Math.round(reps),
    });
  }
}

/** Latin-digit buffer text for a value, or empty for "nothing entered". */
function text(value: number | null): string {
  return value === null ? '' : String(value);
}

/** `null` for an empty or half-typed value, so "2." does not become 2. */
function parse(raw: string): number | null {
  if (raw === '' || raw === '.' || raw.endsWith('.')) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Accepts what a hardware keyboard or a paste might produce.
 *
 * Both `.` and `,` count as the decimal mark whatever the locale: someone with
 * a Latin keyboard on an Arabic interface should not be stuck.
 */
function sanitise(value: string, separator: string, integerOnly: boolean): string {
  const normalised = value.split(separator).join('.').replace(/,/g, '.');
  const filtered = normalised.replace(integerOnly ? /[^0-9]/g : /[^0-9.]/g, '');
  const [whole, ...rest] = filtered.split('.');
  return rest.length === 0 ? (whole ?? '') : `${whole ?? ''}.${rest.join('')}`;
}

let idCounter = 0;
function nextId(): number {
  return ++idCounter;
}
