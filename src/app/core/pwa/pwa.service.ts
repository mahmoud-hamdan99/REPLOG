import { computed, DOCUMENT, inject, Service, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { APP_META_STORE } from '../../data/app-meta';
import { DiagnosticsService } from '../errors/diagnostics.service';
import { I18n } from '../i18n/i18n.service';
import { ToastService } from '../toast/toast.service';

/**
 * Application updates.
 *
 * One rule shapes everything here: **never reload by itself.** A reload
 * mid-set loses the weight and reps someone has typed but not confirmed, and
 * an app that can do that during a working set is not a tool anyone will
 * trust with a heavy single. So an update is always an offer, and the offer
 * waits when a session is running — ARCHITECTURE section 10.1, goal G2.
 *
 * "A session is running" is read from `appMeta.activeWorkoutId`, which is the
 * documented single source of truth (section 7.1). Asking the tracker store
 * instead would couple the shell to a lazy feature and pull it into the
 * initial bundle, and the pointer is more reliable anyway: it survives the
 * tab eviction that would leave the store empty.
 */
@Service()
export class PwaService {
  private readonly updates = inject(SwUpdate);
  private readonly meta = inject(APP_META_STORE);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18n);
  private readonly diagnostics = inject(DiagnosticsService);
  private readonly document = inject(DOCUMENT);

  private readonly _updateReady = signal(false);
  private readonly _broken = signal(false);

  /** A new version is downloaded and waiting for the user to say when. */
  readonly updateReady = this._updateReady.asReadonly();

  /**
   * The cached files are damaged and the app cannot heal itself.
   *
   * Separate from `updateReady` because the message is different in the way
   * that matters: this one has to say, out loud, that the training history is
   * not affected. Someone told only that the app is broken will assume the
   * worst about their data, and they would be right to.
   */
  readonly isBroken = this._broken.asReadonly();

  readonly isEnabled = computed(() => this.updates.isEnabled);

  private readonly _installPrompt = signal<InstallPrompt | null>(null);

  /**
   * The browser's deferred install prompt, where there is one.
   *
   * Null on iOS, which has no such API: Safari installs through Share → Add
   * to Home Screen and offers nothing to call. About shows the instructions
   * in that case rather than a button that would silently do nothing, which
   * is the rule in UI_UX_SPEC section 7 — never claim a capability the
   * platform does not have.
   */
  readonly installPrompt = this._installPrompt.asReadonly();

  /**
   * Starts listening. Called from the composition root rather than from the
   * constructor so that nothing subscribes in a unit test that did not ask to.
   */
  listen(): void {
    // Captured regardless of whether the service worker is enabled, and
    // early: the event fires once, before any settings screen exists, and a
    // listener added later simply never hears it.
    this.document.defaultView?.addEventListener('beforeinstallprompt', (event) => {
      // Preventing the default is what defers it; without this the browser
      // shows its own bar wherever it likes, including over a working set.
      event.preventDefault();
      this._installPrompt.set(event as InstallPrompt);
    });

    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates.subscribe((event) => {
      switch (event.type) {
        case 'VERSION_READY':
          this._updateReady.set(true);
          void this.offer();
          break;

        case 'VERSION_INSTALLATION_FAILED':
          // Keep running the current version. There is nothing for the user
          // to do about this and nothing is broken yet, so it is recorded for
          // Settings → About → Diagnostics rather than shown.
          this.diagnostics.record({
            kind: 'unexpected',
            message: 'Service worker failed to install a new version',
            detail: event.error,
          });
          break;

        default:
          break;
      }
    });

    this.updates.unrecoverable.subscribe((event) => {
      this._broken.set(true);
      this.diagnostics.record({
        kind: 'storage',
        message: 'Service worker reached an unrecoverable state',
        detail: event.reason,
      });
    });
  }

  /**
   * Offers the waiting update, unless a workout is in progress.
   *
   * A held update is not lost: `updateReady` stays true, so the badge in More
   * keeps the offer available for whenever the user is between sessions.
   */
  private async offer(): Promise<void> {
    if (await this.hasActiveWorkout()) return;

    this.toasts.show(this.i18n.t('update.ready'), {
      kind: 'info',
      durationMs: 10_000,
      action: { labelKey: 'update.reload', run: () => void this.apply() },
    });
  }

  private async hasActiveWorkout(): Promise<boolean> {
    try {
      return (await this.meta.get('activeWorkoutId')) !== null;
    } catch {
      // The database is unreadable — safe mode, or blocked by another tab.
      // Hold the update: the cost of waiting is nothing, and the cost of
      // reloading over a session we could not see is somebody's workout.
      return true;
    }
  }

  /** Activates the waiting version and reloads. Only ever user-initiated. */
  async apply(): Promise<void> {
    try {
      await this.updates.activateUpdate();
    } catch {
      // Activation can fail if the waiting worker has already gone. Reloading
      // still lands on whatever version is current, which is the point.
    }
    this.document.defaultView?.location.reload();
  }

  /** The only route out of an unrecoverable state: fetch everything again. */
  reloadFromNetwork(): void {
    this.document.defaultView?.location.reload();
  }

  /**
   * Shows the browser's install prompt. Only callable where one was offered.
   *
   * The prompt can be shown once; afterwards the browser discards it, so the
   * reference is cleared either way and the screen falls back to explaining
   * Share → Add to Home Screen.
   */
  async promptInstall(): Promise<void> {
    const prompt = this._installPrompt();
    if (prompt === null) return;

    this._installPrompt.set(null);
    try {
      await prompt.prompt();
    } catch {
      // Dismissed, or already used. Nothing to report: the user either
      // installed it or decided not to, and both are fine.
    }
  }
}

/**
 * The part of `BeforeInstallPromptEvent` this app uses.
 *
 * Declared here because the DOM lib does not define it — it is a Chromium
 * extension, which is precisely why the code treats its absence as normal.
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}
