import { Component, inject, signal } from '@angular/core';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Chip } from '../../shared/ui/chip';
import { DeltaChip } from '../../shared/ui/delta-chip';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { ListRow } from '../../shared/ui/list-row';
import { ProgressRing } from '../../shared/ui/progress-ring';
import { SectionHeader } from '../../shared/ui/section-header';
import { Segmented, type SegmentedOption } from '../../shared/ui/segmented';
import { Sheet } from '../../shared/ui/sheet';
import { Skeleton } from '../../shared/ui/skeleton';
import { StatTile } from '../../shared/ui/stat-tile';
import type { Language, ThemePreference } from '../../domain/models/prefs';

/**
 * Development-only component gallery at /dev/ui.
 *
 * Exists so every kit component can be reviewed in both themes and both text
 * directions on one screen — the Phase 1 acceptance criterion. Excluded from
 * production builds by a guard in app.routes.ts.
 */
@Component({
  selector: 'rl-ui-gallery-page',
  styleUrl: './ui-gallery.page.css',
  imports: [
    AppHeader,
    Badge,
    Button,
    Card,
    Chip,
    DeltaChip,
    Dialog,
    EmptyState,
    Icon,
    ListRow,
    ProgressRing,
    SectionHeader,
    Segmented,
    Sheet,
    Skeleton,
    StatTile,
  ],
  template: `
    <rl-app-header titleKey="app.name" />

    <div class="page gallery">
      <rl-section-header titleKey="settings.appearance.title" />
      <rl-card>
        <div class="gallery__stack">
          <rl-segmented
            name="gallery-theme"
            labelKey="settings.appearance.theme"
            [options]="themeOptions"
            [value]="settings.themePreference()"
            (valueChange)="settings.set('theme', $event)"
          />
          <rl-segmented
            name="gallery-language"
            labelKey="settings.language.title"
            [options]="languageOptions"
            [value]="settings.language()"
            (valueChange)="settings.set('language', $event)"
          />
        </div>
      </rl-card>

      <rl-section-header titleKey="app.name" />
      <rl-card>
        <div class="gallery__row">
          <rl-button variant="primary">Primary</rl-button>
          <rl-button variant="secondary">Secondary</rl-button>
          <rl-button variant="ghost">Ghost</rl-button>
          <rl-button variant="danger">Danger</rl-button>
          <rl-button variant="primary" [disabled]="true">Disabled</rl-button>
          <rl-button variant="secondary" [busy]="true">Busy</rl-button>
        </div>
        <div class="gallery__row">
          <rl-button size="sm" variant="secondary">Small</rl-button>
          <rl-button size="md" variant="secondary">Medium</rl-button>
          <rl-button size="lg" variant="secondary">Large</rl-button>
        </div>
      </rl-card>

      <rl-card>
        <div class="gallery__row">
          <rl-badge kind="pr">PR</rl-badge>
          <rl-badge kind="estimate">e1RM</rl-badge>
          <rl-badge kind="warmup">Warm-up</rl-badge>
          <rl-badge kind="count">18</rl-badge>
          <rl-badge kind="neutral">Neutral</rl-badge>
        </div>
        <div class="gallery__row">
          <rl-chip [selected]="chipOn()" (toggled)="chipOn.set(!chipOn())">Chest</rl-chip>
          <rl-chip>Back</rl-chip>
          <rl-chip variant="removable">Barbell</rl-chip>
        </div>
        <div class="gallery__row">
          <rl-delta-chip [value]="-0.6" unit="kg" />
          <rl-delta-chip [value]="2.5" unit="kg" />
          <rl-delta-chip [value]="0" unit="kg" />
          <rl-delta-chip [value]="null" />
        </div>
        <div class="gallery__row">
          <rl-icon name="home" />
          <rl-icon name="plans" />
          <rl-icon name="train" />
          <rl-icon name="progress" />
          <rl-icon name="more" />
          <rl-icon name="chevron" />
          <rl-icon name="check" />
        </div>
      </rl-card>

      <rl-card>
        <div class="gallery__tiles">
          <rl-stat-tile labelKey="nav.progress" value="82.4" unit="kg" [hero]="true" />
          <rl-stat-tile labelKey="nav.home" [value]="null" emptyHintKey="state.empty.body" />
        </div>
        <div class="gallery__row">
          <rl-progress-ring [value]="0.68" [size]="88"
            ><span class="t-stat-sm">68%</span></rl-progress-ring
          >
          <rl-progress-ring [value]="0.25" [size]="64" />
        </div>
      </rl-card>

      <rl-card [inset]="false">
        <rl-list-row labelKey="settings.language.title" valueText="English" variant="nav" />
        <rl-list-row labelKey="settings.units.weight" valueText="kg" />
        <rl-list-row labelKey="common.delete" variant="destructive" />
      </rl-card>

      <rl-card>
        <div class="gallery__stack">
          <rl-skeleton shape="line" width="70%" />
          <rl-skeleton shape="line" width="45%" />
          <rl-skeleton shape="card" />
        </div>
      </rl-card>

      <rl-card [accentEdge]="true">
        <rl-empty-state
          titleKey="state.empty.title"
          bodyKey="state.empty.body"
          actionKey="common.retry"
        />
      </rl-card>

      <rl-card>
        <div class="gallery__row">
          <rl-button variant="secondary" (click)="sheetOpen.set(true)">Open sheet</rl-button>
          <rl-button variant="secondary" (click)="confirmOpen.set(true)">Confirm</rl-button>
          <rl-button variant="danger" (click)="destroyOpen.set(true)">Typed confirm</rl-button>
          <rl-button variant="secondary" (click)="toasts.success('Saved')">Toast</rl-button>
          <rl-button variant="secondary" (click)="showUndo()">Undo toast</rl-button>
        </div>
      </rl-card>
    </div>

    <rl-sheet [(open)]="sheetOpen" labelKey="app.name">
      <h2 class="t-h2">Bottom sheet</h2>
      <p class="t-body">
        Native dialog element: focus trap, Escape and backdrop come from the platform.
      </p>
      <rl-button variant="primary" [full]="true" (click)="sheetOpen.set(false)">Close</rl-button>
    </rl-sheet>

    <rl-dialog
      [(open)]="confirmOpen"
      titleKey="state.error.title"
      bodyKey="state.error.body"
      confirmKey="common.retry"
    />

    <rl-dialog
      [(open)]="destroyOpen"
      titleKey="common.delete"
      bodyKey="state.error.body"
      confirmKey="common.delete"
      [destructive]="true"
      typedConfirmPhrase="DELETE"
    />
  `,
})
export class UiGalleryPage {
  protected readonly settings = inject(SettingsStore);
  protected readonly toasts = inject(ToastService);

  protected readonly chipOn = signal(true);
  protected readonly sheetOpen = signal(false);
  protected readonly confirmOpen = signal(false);
  protected readonly destroyOpen = signal(false);

  protected readonly themeOptions: readonly SegmentedOption<ThemePreference>[] = [
    { value: 'system', labelKey: 'theme.system' },
    { value: 'light', labelKey: 'theme.light' },
    { value: 'dark', labelKey: 'theme.dark' },
  ];

  protected readonly languageOptions: readonly SegmentedOption<Language>[] = [
    { value: 'en', labelKey: 'language.en' },
    { value: 'ar', labelKey: 'language.ar' },
  ];

  protected showUndo(): void {
    this.toasts.undo('Set deleted', () => this.toasts.success('Restored'));
  }
}
