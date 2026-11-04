import { Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { I18n } from './core/i18n/i18n.service';
import { PwaService } from './core/pwa/pwa.service';
import { TabBar } from './core/nav/tab-bar';
import { ThemeService } from './core/theme/theme.service';
import { ToastHost } from './shared/ui/toast-host';

/**
 * Application shell: skip link, scrolling main region, bottom navigation and
 * the toast host.
 *
 * ThemeService and I18n are injected here, not merely imported, because both
 * own effects that reflect state onto the document (`data-theme`, `lang`,
 * `dir`). Injecting them is what starts those effects.
 */
@Component({
  selector: 'rl-root',
  styleUrl: './app.css',
  imports: [RouterOutlet, TabBar, ToastHost],
  template: `
    <!-- A button, not an anchor. Safari leaves links out of the Tab order
         unless the user turns on full keyboard access, which would make a skip
         *link* unreachable by keyboard on this app's primary platform. A button
         is always tabbable, and moving focus is what a skip control is for —
         a fragment navigation does not reliably move focus anyway. -->
    <button type="button" class="skip" (click)="skipToContent()">
      {{ i18n.t('a11y.skipToContent') }}
    </button>

    <!-- The one thing the shell interrupts for. An unrecoverable service
         worker means the cached app files are damaged, which looks to a user
         exactly like "the app ate my training" — so the first sentence says
         the history is untouched, before explaining anything else. It is a
         banner rather than a dialog because the app still works; only its
         ability to update itself does not. -->
    @if (pwa.isBroken()) {
      <div class="broken" role="alert">
        <p class="t-h3 broken__title">{{ i18n.t('update.broken.title') }}</p>
        <p class="t-body broken__body">{{ i18n.t('update.broken.body') }}</p>
        <button type="button" class="broken__action t-label" (click)="pwa.reloadFromNetwork()">
          {{ i18n.t('update.broken.action') }}
        </button>
      </div>
    }

    <main
      #mainContent
      id="main-content"
      class="shell__main"
      tabindex="-1"
      [class.shell__main--no-nav]="hideNav()"
    >
      <router-outlet />
    </main>

    @if (!hideNav()) {
      <rl-tab-bar />
    }

    <rl-toast-host />
  `,
})
export class App {
  protected readonly i18n = inject(I18n);
  protected readonly pwa = inject(PwaService);
  private readonly router = inject(Router);

  // Started for their document-reflecting effects.
  private readonly theme = inject(ThemeService);

  private readonly routeData = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => deepestRouteData(this.router)),
      startWith(deepestRouteData(this.router)),
    ),
    { initialValue: {} as Record<string, unknown> },
  );

  protected readonly hideNav = computed(() => this.routeData()['hideNav'] === true);

  private readonly mainContent = viewChild.required<ElementRef<HTMLElement>>('mainContent');

  /** Moves keyboard focus past the chrome into the page content. */
  protected skipToContent(): void {
    const main = this.mainContent().nativeElement;
    main.focus();
    // Optional call: focus is what matters, and jsdom does not implement
    // scrollIntoView, so an unguarded call fails the unit suite.
    main.scrollIntoView?.();
  }

  constructor() {
    // Referenced so the field is not treated as unused; the effect it owns is
    // the actual purpose.
    void this.theme;
  }
}

/** Merged `data` of the deepest activated route. */
function deepestRouteData(router: Router): Record<string, unknown> {
  let route = router.routerState.snapshot.root;
  let data: Record<string, unknown> = { ...route.data };
  while (route.firstChild) {
    route = route.firstChild;
    data = { ...data, ...route.data };
  }
  return data;
}
