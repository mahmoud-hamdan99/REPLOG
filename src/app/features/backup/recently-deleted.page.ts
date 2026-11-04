import { Component, inject, signal } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { AppHeader } from '../../core/nav/app-header';
import { ToastService } from '../../core/toast/toast.service';
import { RECOVERY_WINDOW_DAYS } from '../../domain/models/entity';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Dialog } from '../../shared/ui/dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { Skeleton } from '../../shared/ui/skeleton';
import { RecentlyDeletedStore, type DeletedItem } from './recently-deleted.store';

/**
 * Recently deleted.
 *
 * The screen that makes a soft delete worth having. Every row says what the
 * thing was, what was in it and how long is left — the last one because
 * "recoverable for 30 days" is a promise with an expiry, and a list that hid
 * the expiry would be letting people believe they had longer than they do.
 *
 * Permanent deletion of what is already past the window is offered, never
 * taken: running it on load would make this the only destructive action in
 * the app that nobody chose.
 */
@Component({
  selector: 'rl-recently-deleted-page',
  styleUrl: './recently-deleted.page.css',
  imports: [AppHeader, Button, Card, Dialog, EmptyState, Skeleton],
  template: `
    <rl-app-header titleKey="deleted.title" [showBack]="true" />

    <div class="page">
      <p class="t-caption hint">{{ i18n.t('deleted.body', { count: windowDays }) }}</p>

      @if (store.items(); as items) {
        @if (items.length === 0) {
          <rl-empty-state titleKey="deleted.empty.title" bodyKey="deleted.empty.body" />
        } @else {
          <rl-card [inset]="false">
            @for (item of items; track item.kind + item.id) {
              <div class="item">
                <div class="item__text">
                  <p class="t-body item__title">{{ item.title }}</p>
                  <p class="t-caption item__detail">
                    {{ i18n.join([i18n.t('deleted.kind.' + item.kind), item.detail]) }}
                  </p>
                  <p class="t-caption item__left" [class.item__left--urgent]="item.daysLeft <= 3">
                    {{ i18n.t('deleted.daysLeft', { count: item.daysLeft }) }}
                  </p>
                </div>
                <rl-button variant="secondary" size="sm" (click)="restore(item)">
                  {{ i18n.t('deleted.restore') }}
                </rl-button>
              </div>
            }
          </rl-card>
        }
      } @else {
        <rl-skeleton variant="card" />
      }

      @if (store.expiredCount() > 0) {
        <rl-card>
          <p class="t-body">
            {{ i18n.t('deleted.expired', { count: store.expiredCount() }) }}
          </p>
          <rl-button variant="danger" [full]="true" (click)="purgeOpen.set(true)">
            {{ i18n.t('deleted.purge') }}
          </rl-button>
        </rl-card>
      }
    </div>

    <rl-dialog
      [open]="purgeOpen()"
      titleKey="deleted.purgeConfirm"
      [bodyText]="i18n.t('deleted.purgeBody', { count: store.expiredCount() })"
      confirmKey="deleted.purge"
      [destructive]="true"
      (confirmed)="purge()"
      (cancelled)="purgeOpen.set(false)"
    />
  `,
})
export class RecentlyDeletedPage {
  protected readonly store = inject(RecentlyDeletedStore);
  protected readonly i18n = inject(I18n);
  private readonly toasts = inject(ToastService);

  protected readonly windowDays = RECOVERY_WINDOW_DAYS;
  protected readonly purgeOpen = signal(false);

  constructor() {
    void this.store.load();
  }

  protected async restore(item: DeletedItem): Promise<void> {
    try {
      await this.store.restore(item);
      this.toasts.success(this.i18n.t('deleted.restored'));
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    }
  }

  protected async purge(): Promise<void> {
    this.purgeOpen.set(false);
    try {
      const count = await this.store.purgeExpired();
      this.toasts.success(this.i18n.t('deleted.purged', { count }));
    } catch {
      this.toasts.error(this.i18n.t('state.error.title'));
    }
  }
}
