import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { CLOCK, type Clock } from './data/clock';
import { PREFS_STORE, type PrefsStore } from './data/prefs';
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from './domain/models/prefs';

/**
 * In-memory preferences, so the shell can be tested without touching
 * LocalStorage. This is the payoff of putting the storage contract in data/:
 * no fake-indexeddb, no jsdom storage shim, no global state between tests.
 */
function inMemoryPrefs(initial: Partial<Prefs> = {}): PrefsStore {
  let current: Prefs = normalizePrefs({ ...DEFAULT_PREFS, ...initial });
  return {
    read: () => current,
    write: (prefs) => {
      current = prefs;
    },
    clear: () => {
      current = { ...DEFAULT_PREFS };
    },
  };
}

function fixedClock(at = '2026-03-02T18:00:00.000Z'): Clock {
  const ms = Date.parse(at);
  return {
    now: () => ms,
    nowIso: () => new Date(ms).toISOString(),
    timezoneOffsetMinutes: () => 0,
  };
}

describe('App shell', () => {
  function setup(prefs: Partial<Prefs> = {}) {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: PREFS_STORE, useValue: inMemoryPrefs(prefs) },
        { provide: CLOCK, useValue: fixedClock() },
      ],
    });
    return TestBed.createComponent(App);
  }

  it('creates', () => {
    const fixture = setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the skip control as a button, so Safari keeps it tabbable', async () => {
    const fixture = setup();
    await fixture.whenStable();
    const skip = fixture.nativeElement.querySelector('.skip') as HTMLElement | null;
    expect(skip).toBeTruthy();
    expect(skip?.tagName).toBe('BUTTON');
  });

  it('moves focus into main when the skip control is activated', async () => {
    const fixture = setup();
    await fixture.whenStable();
    const skip = fixture.nativeElement.querySelector('.skip') as HTMLButtonElement;
    skip.click();
    await fixture.whenStable();
    const main = fixture.nativeElement.querySelector('main#main-content') as HTMLElement;
    expect(document.activeElement).toBe(main);
  });

  it('renders the bottom navigation with five destinations', async () => {
    const fixture = setup();
    await fixture.whenStable();
    const tabs = fixture.nativeElement.querySelectorAll('.tab');
    expect(tabs.length).toBe(5);
  });

  it('exposes a labelled main landmark that the skip link targets', async () => {
    const fixture = setup();
    await fixture.whenStable();
    const main = fixture.nativeElement.querySelector('main#main-content');
    expect(main).toBeTruthy();
  });

  it('applies dark theme and ltr for default preferences', async () => {
    const fixture = setup({ theme: 'dark', language: 'en' });
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches the document to rtl when the language is Arabic', async () => {
    const fixture = setup({ language: 'ar' });
    await fixture.whenStable();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
