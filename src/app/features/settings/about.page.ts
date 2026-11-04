import { Component, inject, signal } from '@angular/core';
import { DiagnosticsService } from '../../core/errors/diagnostics.service';
import { I18n } from '../../core/i18n/i18n.service';
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
  'about.platform.install',
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
 * The identifiers below are read from the database, not guessed. There is
 * deliberately no build stamp: nothing in the build writes one yet, and an
 * invented one would be worse than its absence on the one screen whose
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
  private readonly meta = inject(APP_META_STORE);
  private readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);

  protected readonly platformNotes = PLATFORM_NOTES;

  protected readonly version = signal('…');
  protected readonly deviceId = signal('…');

  constructor() {
    void this.load();
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
