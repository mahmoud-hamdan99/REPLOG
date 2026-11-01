import { Service, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error' | 'undo';

export interface ToastAction {
  /** Translation key for the action label. */
  labelKey: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  /** Already-translated message text. */
  message: string;
  action?: ToastAction | undefined;
  durationMs: number;
}

/** An undo toast lingers: 5s is not enough to notice and react. */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  error: 8000,
  undo: 7000,
};

/** At most two at once; a stack taller than that covers the content. */
const MAX_VISIBLE = 2;

@Service()
export class ToastService {
  private readonly _toasts = signal<readonly Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = this._toasts.asReadonly();

  show(
    message: string,
    options: { kind?: ToastKind; action?: ToastAction; durationMs?: number } = {},
  ): number {
    const kind = options.kind ?? 'info';
    const toast: Toast = {
      id: this.nextId++,
      kind,
      message,
      action: options.action,
      durationMs: options.durationMs ?? DEFAULT_DURATION[kind],
    };

    this._toasts.update((current) => {
      const next = [...current, toast];
      const overflow = next.length - MAX_VISIBLE;
      if (overflow > 0) {
        for (const dropped of next.slice(0, overflow)) {
          this.clearTimer(dropped.id);
        }
        return next.slice(overflow);
      }
      return next;
    });

    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), toast.durationMs),
    );
    return toast.id;
  }

  success(message: string): number {
    return this.show(message, { kind: 'success' });
  }

  error(message: string): number {
    return this.show(message, { kind: 'error' });
  }

  /** Shows an undo affordance. Running the action dismisses the toast. */
  undo(message: string, run: () => void, labelKey = 'common.undo'): number {
    const id = this.show(message, {
      kind: 'undo',
      action: {
        labelKey,
        run: () => {
          run();
          this.dismiss(id);
        },
      },
    });
    return id;
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this._toasts.update((current) => current.filter((toast) => toast.id !== id));
  }

  dismissAll(): void {
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id);
    }
    this._toasts.set([]);
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}
