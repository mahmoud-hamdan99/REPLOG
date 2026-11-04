import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BUILD_INFO } from '../../core/build-info';
import { DisplayFormat } from '../../core/format/display-format.service';
import { DiagnosticsService } from '../../core/errors/diagnostics.service';
import { I18n } from '../../core/i18n/i18n.service';
import { PwaService } from '../../core/pwa/pwa.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import { APP_META_STORE } from '../../data/app-meta';
import { EXPECTED_SCHEMA_VERSION } from '../../data/schema-version';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ListRow } from '../../shared/ui/list-row';
import { SectionHeader } from '../../shared/ui/section-header';

/** One sentence of platform honesty, in the order a new user meets them. */
const PLATFORM_NOTES: readonly string[] = [
  'about.platform.sync',
  'about.platform.storage',
  'about.platform.offline',
  'about.platform.restTimer',
  'about.platform.notifications',
  'about.platform.photos',
  'about.platform.health',
];

/**
 * About.
 *
 * The honest-messaging screen from UI_UX_SPEC section 7, which is the one
 * place the app states its limits in full rather than only where they bite.
 * Every line is something this app genuinely cannot do on iOS, written as a
 * fact rather than as an apology or a "coming soon" — a teaser is a promise,
 * and Version 1 is not making any.
 *
 * The identifiers below are read from the database, not guessed, and the
 * build stamp is read from what `scripts/stamp-build.mjs` wrote. A build that
 * was never stamped says so rather than showing a plausible blank: an
 * invented version would be worse than its absence on the one screen whose
 * purpose is to be trustworthy.
 */
@Component({
  selector: 'rl-about-page',
  styleUrl: './settings.page.css',
  imports: [AppHeader, Button, Card, ListRow, SectionHeader],
  template: `
    <rl-app-header titleKey="page.about.title" [showBack]="true" />

    <div class="page">
      <section class="group">
        <rl-card [inset]="false">
          <rl-list-row labelKey="about.version" [valueText]="version()" [interactive]="false" />
          <rl-list-row labelKey="about.build" [valueText]="build()" [interactive]="false" />
          <rl-list-row
            labelKey="about.schema"
            [valueText]="schemaVersion()"
            [interactive]="false"
          />
          <rl-list-row labelKey="about.locale" [valueText]="locale()" [interactive]="false" />
          <rl-list-row labelKey="about.device" [valueText]="deviceId()" [interactive]="false" />
        </rl-card>
      </section>

      <section class="group">
        <rl-section-header titleKey="about.platform.title" />
        <rl-card>
          @for (note of platformNotes; track note) {
            <p class="t-body about__note">{{ i18n.t(note) }}</p>
          }
        </rl-card>
      </section>

      <!-- The one thing on this screen a user can act on. The note above
           tells them iOS may remove their data and that they should export;
           leaving them to find the Data screen themselves would be stating a
           risk and withholding the remedy. -->
      <section class="group">
        <rl-button variant="secondary" [full]="true" (click)="openData()">
          {{ i18n.t('about.backup.action') }}
        </rl-button>
      </section>

      <section class="group">
        <rl-section-header titleKey="about.diagnostics.title" />
        <rl-card>
          <p class="t-caption toggle__hint">{{ i18n.t('about.diagnostics.note') }}</p>

          @if (missingKeyCount() > 0) {
            <p class="t-caption about__note">
              {{ i18n.t('about.diagnostics.missingKeys', { count: missingKeyCount() }) }}
            </p>
          }

          @if (diagnostics.entries().length === 0) {
            <p class="t-body about__note">{{ i18n.t('about.diagnostics.empty') }}</p>
          } @else {
            <!-- Left-to-right and monospaced whatever the interface language:
                 these are timestamps and identifiers, not prose, and bidi
                 reordering would rearrange them into something that is not
                 what went wrong. -->
            <pre class="about__log" dir="ltr">{{ diagnostics.asText() }}</pre>
            <div class="about__actions">
              <rl-button variant="secondary" size="sm" (click)="copy()">
                {{ i18n.t('about.diagnostics.copy') }}
              </rl-button>
              <rl-button variant="ghost" size="sm" (click)="diagnostics.clear()">
                {{ i18n.t('about.diagnostics.clear') }}
              </rl-button>
            </div>
          }
        </rl-card>
      </section>

      <section class="group">
        <rl-section-header titleKey="install.title" />
        <rl-card>
          <!-- iOS has no install prompt API, so there is no button to offer.
               Where the browser does support one, it is shown; where it does
               not, the instructions are the honest alternative to a button
               that would do nothing. -->
          @if (canPrompt()) {
            <rl-button variant="primary" [full]="true" (click)="install()">
              {{ i18n.t('install.action') }}
            </rl-button>
          } @else {
            <p class="t-body about__note">{{ i18n.t('install.ios') }}</p>
          }
        </rl-card>
      </section>

      <section class="group">
        <rl-section-header titleKey="about.credits.title" />
        <rl-card>
          <p class="t-body about__note">{{ i18n.t('about.credits.body') }}</p>
        </rl-card>
      </section>
    </div>
  `,
})
export class AboutPage {
  protected readonly i18n = inject(I18n);
  protected readonly diagnostics = inject(DiagnosticsService);
  private readonly pwa = inject(PwaService);
  private readonly fmt = inject(DisplayFormat);
  private readonly meta = inject(APP_META_STORE);
  private readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly platformNotes = PLATFORM_NOTES;

  /**
   * The deferred install prompt, where the browser offers one.
   *
   * Captured by the shell before this screen exists, because the event fires
   * once and early. Null on iOS, which has no such API at all — hence the
   * instructions rather than a button that could not work.
   */
  protected readonly canPrompt = computed(() => this.pwa.installPrompt() !== null);

  protected readonly version = signal('…');
  protected readonly deviceId = signal('…');

  constructor() {
    void this.load();
  }

  /**
   * The commit and date this build came from, or a plain statement that it
   * carries neither.
   *
   * `scripts/stamp-build.mjs` fills these in CI. A local build has no stamp,
   * and the screen says so rather than printing a version number that traces
   * back to nothing — this is the one screen whose entire purpose is to be
   * checkable.
   */
  protected build(): string {
    if (BUILD_INFO.commit === null) return this.i18n.t('about.buildUnknown');
    return this.i18n.join([
      BUILD_INFO.commit,
      BUILD_INFO.builtAt === null ? '' : this.fmt.shortDate(BUILD_INFO.builtAt),
    ]);
  }

  protected schemaVersion(): string {
    return this.i18n.formatNumber(EXPECTED_SCHEMA_VERSION);
  }

  protected locale(): string {
    return this.i18n.join([
      this.i18n.t(`language.${this.settings.language()}`),
      this.i18n.t(`numerals.${this.settings.numerals()}`),
    ]);
  }

  /**
   * How many translation keys were asked for and missing this session.
   *
   * Surfaced because it is the only way a missing string is ever noticed in a
   * language the person reading the screen may not speak.
   */
  protected missingKeyCount(): number {
    return this.i18n.missingKeys().length;
  }

  private async load(): Promise<void> {
    const [version, device] = await Promise.all([
      this.meta.get('appVersion'),
      this.meta.get('deviceId'),
    ]);
    this.version.set(version);
    // The first segment only: enough to tell two devices apart in a backup
    // file, short enough to read out, and not a fingerprint on display.
    this.deviceId.set(device.split('-')[0] ?? device);
  }

  protected async install(): Promise<void> {
    await this.pwa.promptInstall();
  }

  protected openData(): void {
    void this.router.navigate(['/settings/data']);
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.diagnostics.asText());
      this.toasts.success(this.i18n.t('about.diagnostics.copied'));
    } catch {
      // Safari refuses the clipboard outside a user gesture it recognises, and
      // a silent failure here would have the user paste nothing into a bug
      // report and wonder why.
      this.toasts.error(this.i18n.t('about.diagnostics.copyFailed'));
    }
  }
}
