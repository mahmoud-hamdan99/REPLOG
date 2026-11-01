import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { I18n } from '../i18n/i18n.service';

/**
 * Sets the document title from the route's `titleKey`, translated.
 *
 * Angular's default strategy takes a static `title` string, which cannot be
 * translated at runtime. This reads the key instead, so the tab and the iOS app
 * switcher follow the selected language.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18n);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const appName = this.i18n.t('app.name');
    const key = deepestTitleKey(snapshot);
    const pageTitle = key ? this.i18n.t(key) : null;

    // Avoid "REPLOG · REPLOG" when a route's own title is the app name.
    this.title.setTitle(pageTitle && pageTitle !== appName ? `${pageTitle} · ${appName}` : appName);
  }
}

function deepestTitleKey(snapshot: RouterStateSnapshot): string | null {
  let route = snapshot.root;
  let key: string | null = null;
  while (route.firstChild) {
    route = route.firstChild;
    const candidate = route.data['titleKey'];
    if (typeof candidate === 'string') {
      key = candidate;
    }
  }
  return key;
}
