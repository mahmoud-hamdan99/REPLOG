import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DisplayFormat } from '../../core/format/display-format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { SettingsStore } from '../../core/settings/settings.store';
import { ToastService } from '../../core/toast/toast.service';
import type { Photo } from '../../domain/models/body';
import type { Pose } from '../../domain/models/enums';
import { readExif } from '../../domain/photos/exif';
import {
  POSES,
  defaultPair,
  filterByPose,
  groupByMonth,
  intervalBetween,
} from '../../domain/photos/gallery';
import { Badge } from '../../shared/ui/badge';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { PhotoThumb } from '../../shared/ui/photo-thumb';
import { ProgressTabs } from '../../shared/ui/progress-tabs';
import { Sheet } from '../../shared/ui/sheet';
import { PhotosStore } from './photos.store';

/**
 * Progress photos.
 *
 * The screen is shaped by one fact that is not about photographs: **this is
 * the most sensitive data in the app.** So nothing here appears on the
 * dashboard, the grid is reachable only from the Progress tab, a Settings
 * option puts every thumbnail behind a tap, and the import sheet says plainly
 * that photos stay on the device and that location data is removed. What it
 * does not do is imply a lock it does not have — Settings states, in words,
 * that anyone holding the unlocked phone can open this screen.
 *
 * Deleting is the one irreversible action in the app. The pixels are
 * hard-deleted with the record (DATABASE_SPEC section 3.12), so the dialog
 * says "cannot be undone" and means it, rather than offering the undo toast
 * every other delete in this app gets.
 */
@Component({
  selector: 'rl-photos-page',
  styleUrl: './photos.page.css',
  imports: [AppHeader, Badge, Button, Chip, Dialog, EmptyState, PhotoThumb, ProgressTabs, Sheet],
  template: `
    <rl-app-header titleKey="page.photos.title">
      @if ((store.photos() ?? []).length > 0) {
        <button type="button" class="hdr-action" (click)="toggleSelecting()">
          {{ selecting() ? i18n.t('common.cancel') : i18n.t('photos.select') }}
        </button>
      }
    </rl-app-header>

    <div class="page">
      <rl-progress-tabs />

      @if (store.isLoading()) {
        <p class="t-body">{{ i18n.t('state.loading.label') }}</p>
      } @else if (store.error(); as error) {
        <rl-empty-state titleKey="state.error.title" bodyKey="state.error.body" />
        <p class="t-caption">{{ error }}</p>
      } @else if ((store.photos() ?? []).length === 0) {
        <rl-empty-state
          titleKey="photos.empty.title"
          bodyKey="photos.empty.body"
          actionKey="photos.empty.action"
          (actioned)="openImport()"
        />
        <p class="t-caption privacy">{{ i18n.t('photos.privacy') }}</p>
      } @else {
        <div class="top">
          <rl-button variant="primary" (click)="openImport()">{{ i18n.t('photos.add') }}</rl-button>
          @if (!selecting()) {
            <rl-button variant="secondary" [disabled]="!canCompare()" (click)="openCompare()">
              {{ i18n.t('photos.compare.open') }}
            </rl-button>
          }
        </div>

        <div class="filters" role="group" [attr.aria-label]="i18n.t('photos.filter')">
          @for (pose of poses; track pose) {
            <rl-chip [selected]="activePoses().includes(pose)" (toggled)="togglePose(pose)">
              {{ i18n.t('pose.' + pose) }}
            </rl-chip>
          }
        </div>

        @if (visible().length === 0) {
          <rl-empty-state titleKey="photos.noMatches.title" bodyKey="photos.noMatches.body" />
        }

        @for (group of groups(); track group.month) {
          <h2 class="t-label month">{{ format.monthLabel(group.month) }}</h2>
          <div class="grid">
            @for (photo of group.photos; track photo.id) {
              <rl-photo-thumb
                [url]="store.thumbUrl(photo)"
                [alt]="describe(photo)"
                [blurred]="settings.prefs().blurPhotos"
                [selectable]="selecting()"
                [selected]="isSelected(photo.id)"
                (selectedChange)="toggleSelected(photo.id, $event)"
                (activated)="openDetail(photo)"
              />
            }
          </div>
        }

        @if (selecting()) {
          <div class="bar">
            <span class="t-caption">
              {{ i18n.t('count.selected', { count: selected().size }) }}
            </span>
            <rl-button
              variant="danger"
              size="sm"
              [disabled]="selected().size === 0"
              (click)="deleteOpen.set(true)"
            >
              {{ i18n.t('common.delete') }}
            </rl-button>
          </div>
        }
      }
    </div>

    <!-- Import -->
    <rl-sheet [(open)]="importOpen" size="full" labelKey="photos.add">
      <h2 class="t-h2 sheet__title">{{ i18n.t('photos.add') }}</h2>
      <p class="t-caption">{{ i18n.t('photos.privacy') }}</p>

      <label class="field">
        <span class="t-label">{{ i18n.t('photos.file') }}</span>
        <!-- No custom picker: iOS already offers Camera, Photo Library and
             Files from a plain file input, and better than this could. -->
        <input
          #fileInput
          class="field__input"
          type="file"
          accept="image/*"
          (change)="onFile($any($event.target).files)"
        />
      </label>

      @if (pending(); as file) {
        <p class="t-body">{{ file.name }}</p>
      }

      <div class="field">
        <span class="t-label">{{ i18n.t('photos.pose') }}</span>
        <div class="filters">
          @for (pose of poses; track pose) {
            <rl-chip [selected]="draftPose() === pose" (toggled)="draftPose.set(pose)">
              {{ i18n.t('pose.' + pose) }}
            </rl-chip>
          }
        </div>
      </div>

      <label class="field">
        <span class="t-label">{{ i18n.t('photos.date') }}</span>
        <input
          class="field__input"
          type="date"
          [value]="draftDay()"
          (change)="draftDay.set($any($event.target).value)"
        />
      </label>

      <label class="field">
        <span class="t-label">{{ i18n.t('photos.notes') }}</span>
        <textarea
          class="field__input"
          rows="2"
          [value]="draftNotes()"
          (input)="draftNotes.set($any($event.target).value)"
        ></textarea>
      </label>

      <div class="sheet-actions">
        <rl-button
          variant="primary"
          size="lg"
          [full]="true"
          [disabled]="pending() === null || busy()"
          [busy]="busy()"
          (click)="save()"
        >
          {{ i18n.t('photos.save') }}
        </rl-button>
      </div>
    </rl-sheet>

    <!-- One photo, full size -->
    <rl-sheet [(open)]="detailOpen" size="full" [labelText]="detailLabel()">
      @if (detail(); as photo) {
        <h2 class="t-h2 sheet__title">{{ format.weekdayDay(photo.takenAt) }}</h2>
        <img class="full" [src]="store.fullUrl(photo) ?? ''" [alt]="describe(photo)" />

        <dl class="facts">
          <div class="facts__pair">
            <dt class="t-caption">{{ i18n.t('photos.pose') }}</dt>
            <dd class="t-body">{{ i18n.t('pose.' + photo.pose) }}</dd>
          </div>
          @if (photo.weightKg !== null) {
            <div class="facts__pair">
              <dt class="t-caption">{{ i18n.t('body.field.weight') }}</dt>
              <dd class="t-body">{{ format.byUnitType('mass', photo.weightKg) }}</dd>
            </div>
          }
        </dl>

        @if (photo.notes) {
          <p class="t-body">{{ photo.notes }}</p>
        }

        <div class="sheet-actions">
          <rl-button variant="danger" [full]="true" (click)="askDeleteOne(photo)">
            {{ i18n.t('common.delete') }}
          </rl-button>
        </div>
      }
    </rl-sheet>

    <!-- Two photos, side by side -->
    <rl-sheet [(open)]="compareOpen" size="full" labelKey="photos.compare.title">
      <h2 class="t-h2 sheet__title">{{ i18n.t('photos.compare.title') }}</h2>

      <div class="pickers">
        <label class="field">
          <span class="t-label">{{ i18n.t('photos.compare.from') }}</span>
          <select class="field__input" (change)="compareFrom.set($any($event.target).value)">
            @for (photo of visible(); track photo.id) {
              <option [value]="photo.id" [selected]="compareFrom() === photo.id">
                {{ format.weekdayDay(photo.takenAt) }} · {{ i18n.t('pose.' + photo.pose) }}
              </option>
            }
          </select>
        </label>

        <label class="field">
          <span class="t-label">{{ i18n.t('photos.compare.to') }}</span>
          <select class="field__input" (change)="compareTo.set($any($event.target).value)">
            @for (photo of visible(); track photo.id) {
              <option [value]="photo.id" [selected]="compareTo() === photo.id">
                {{ format.weekdayDay(photo.takenAt) }} · {{ i18n.t('pose.' + photo.pose) }}
              </option>
            }
          </select>
        </label>
      </div>

      @if (pair(); as both) {
        <p class="t-body-strong interval">{{ intervalLabel() }}</p>

        <div class="compare">
          @for (photo of [both.from, both.to]; track photo.id) {
            <figure class="compare__half">
              <img class="full" [src]="store.fullUrl(photo) ?? ''" [alt]="describe(photo)" />
              <figcaption class="t-caption">
                {{ format.weekdayDay(photo.takenAt) }}
                @if (photo.weightKg !== null) {
                  <rl-badge kind="count">{{ format.byUnitType('mass', photo.weightKg) }}</rl-badge>
                }
              </figcaption>
            </figure>
          }
        </div>
      } @else {
        <p class="t-body">{{ i18n.t('photos.compare.none') }}</p>
      }
    </rl-sheet>

    <rl-dialog
      [(open)]="deleteOpen"
      titleKey="photos.delete.title"
      [bodyText]="deleteBody()"
      confirmKey="photos.delete.confirm"
      [destructive]="true"
      (confirmed)="remove()"
    />
  `,
})
export class PhotosPage {
  protected readonly i18n = inject(I18n);
  protected readonly format = inject(DisplayFormat);
  protected readonly store = inject(PhotosStore);
  protected readonly settings = inject(SettingsStore);
  private readonly toasts = inject(ToastService);

  protected readonly poses = POSES;

  protected readonly importOpen = signal(false);
  protected readonly detailOpen = signal(false);
  protected readonly compareOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly busy = signal(false);

  protected readonly activePoses = signal<Pose[]>([]);
  protected readonly selecting = signal(false);
  protected readonly selected = signal(new Set<string>());
  protected readonly detail = signal<Photo | null>(null);

  protected readonly pending = signal<File | null>(null);
  protected readonly draftPose = signal<Pose>('front');
  protected readonly draftDay = signal('');
  protected readonly draftNotes = signal('');

  protected readonly compareFrom = signal('');
  protected readonly compareTo = signal('');

  constructor() {
    void this.store.load();

    // Every object URL this screen created is released when it is left. The
    // store is a root service that outlives the route, so without this a
    // photo library stays pinned in memory while the user is in Settings.
    inject(DestroyRef).onDestroy(() => this.store.releaseUrls());
  }

  // --------------------------------------------------------------- listing

  protected readonly visible = computed(() =>
    filterByPose(this.store.photos() ?? [], this.activePoses()),
  );

  protected readonly groups = computed(() => groupByMonth(this.visible()));

  protected readonly canCompare = computed(() => this.visible().length >= 2);

  protected togglePose(pose: Pose): void {
    this.activePoses.update((poses) =>
      poses.includes(pose) ? poses.filter((candidate) => candidate !== pose) : [...poses, pose],
    );
  }

  /** Pose and date, so a screen reader hears which photo this is. */
  protected describe(photo: Photo): string {
    return this.i18n.join([
      this.i18n.t(`pose.${photo.pose}`),
      this.format.weekdayDay(photo.takenAt),
    ]);
  }

  // ------------------------------------------------------------- selection

  protected toggleSelecting(): void {
    this.selecting.update((on) => !on);
    this.selected.set(new Set());
  }

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggleSelected(id: string, on: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // ---------------------------------------------------------------- import

  protected openImport(): void {
    this.pending.set(null);
    this.draftPose.set('front');
    this.draftDay.set(this.store.today());
    this.draftNotes.set('');
    this.importOpen.set(true);
  }

  /**
   * Reads the capture date out of the picked file before anything else.
   *
   * Prefilling from EXIF is the difference between importing a backlog of
   * photos and retyping a date for each one. The user can still change it: the
   * file's date is evidence, not a verdict.
   */
  protected async onFile(files: FileList | null): Promise<void> {
    const file = files?.[0] ?? null;
    this.pending.set(file);
    if (file === null) return;

    const taken = readExif(await file.arrayBuffer()).takenOn;
    if (taken !== null) this.draftDay.set(taken);
  }

  protected async save(): Promise<void> {
    const file = this.pending();
    if (file === null) return;

    this.busy.set(true);
    try {
      await this.store.add({
        file,
        pose: this.draftPose(),
        takenAt: this.draftDay(),
        notes: this.draftNotes().trim() === '' ? null : this.draftNotes().trim(),
      });
      this.importOpen.set(false);
      this.toasts.success(this.i18n.t('photos.saved'));
    } catch (error) {
      this.toasts.error(this.messageFor(error));
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- detail

  protected openDetail(photo: Photo): void {
    this.detail.set(photo);
    this.detailOpen.set(true);
  }

  protected detailLabel(): string {
    const photo = this.detail();
    return photo === null ? '' : this.describe(photo);
  }

  // --------------------------------------------------------------- compare

  protected openCompare(): void {
    const pair = defaultPair(this.visible());
    if (pair) {
      this.compareFrom.set(pair.from.id);
      this.compareTo.set(pair.to.id);
    }
    this.compareOpen.set(true);
  }

  protected readonly pair = computed(() => {
    const from = this.store.byId(this.compareFrom());
    const to = this.store.byId(this.compareTo());
    return from && to ? { from, to } : null;
  });

  protected intervalLabel(): string {
    const both = this.pair();
    if (both === null) return '';

    const interval = intervalBetween(both.from.takenAt, both.to.takenAt);
    if (interval.sameDay) return this.i18n.t('photos.compare.sameDay');
    // Weeks once there are any, because "14 weeks apart" is how people talk
    // about a training block; days below that, because "0 weeks" says nothing.
    return interval.weeks > 0
      ? this.i18n.t('photos.compare.weeksApart', { count: interval.weeks })
      : this.i18n.t('photos.compare.daysApart', { count: interval.days });
  }

  // ---------------------------------------------------------------- delete

  protected askDeleteOne(photo: Photo): void {
    this.selected.set(new Set([photo.id]));
    this.deleteOpen.set(true);
  }

  protected deleteBody(): string {
    // Names the count and the consequence. This is the only delete in the app
    // with no undo, because the pixels go with the record.
    return this.i18n.t('photos.delete.body', { count: this.selected().size });
  }

  protected async remove(): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0) return;

    try {
      await this.store.removeMany(ids);
      this.selected.set(new Set());
      this.selecting.set(false);
      this.detailOpen.set(false);
      this.detail.set(null);
      this.toasts.success(this.i18n.t('photos.deleted', { count: ids.length }));
    } catch (error) {
      this.toasts.error(this.messageFor(error));
    }
  }

  // --------------------------------------------------------------- private

  private messageFor(error: unknown): string {
    const key =
      error !== null && typeof error === 'object' && 'messageKey' in error
        ? String((error as { messageKey?: string }).messageKey ?? '')
        : '';
    return key === '' ? this.i18n.t('state.error.title') : this.i18n.t(key, { max: 25 });
  }
}
