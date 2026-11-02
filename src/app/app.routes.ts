import { isDevMode } from '@angular/core';
import type { Routes } from '@angular/router';

/**
 * Route map. Mirrors docs/ARCHITECTURE.md section 9.
 *
 * Every screen is routed from Phase 1 so navigation, deep links, titles and the
 * GitHub Pages SPA fallback can all be verified before the features exist.
 * Unbuilt screens resolve to PlaceholderPage, which says it is unbuilt rather
 * than showing a blank page.
 *
 * `data.titleKey` drives the document title (TranslatedTitleStrategy).
 * `data.hideNav` removes the tab bar — the active tracker is deliberately modal.
 * `data.preload` opts a route into idle preloading (SelectivePreloadStrategy).
 */
const placeholder = () =>
  import('./features/placeholder/placeholder.page').then((m) => m.PlaceholderPage);

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: placeholder,
    data: { titleKey: 'page.dashboard.title', navTab: 'home' },
  },

  // Planner
  {
    path: 'plans',
    loadComponent: () => import('./features/planner/plans.page').then((m) => m.PlansPage),
    data: { titleKey: 'page.plans.title', navTab: 'plans' },
  },
  {
    path: 'plans/:planId',
    loadComponent: () =>
      import('./features/planner/plan-detail.page').then((m) => m.PlanDetailPage),
    data: { titleKey: 'page.plans.title', navTab: 'plans', showBack: true },
  },
  {
    path: 'plans/:planId/routines/:routineId',
    loadComponent: () =>
      import('./features/planner/routine-editor.page').then((m) => m.RoutineEditorPage),
    data: { titleKey: 'page.plans.title', navTab: 'plans', showBack: true },
  },

  // Exercise library
  {
    path: 'exercises',
    loadComponent: () => import('./features/exercises/exercises.page').then((m) => m.ExercisesPage),
    data: { titleKey: 'page.exercises.title', navTab: 'plans' },
  },
  {
    // Before the :exerciseId route, or "new" is read as an id.
    path: 'exercises/new',
    loadComponent: () =>
      import('./features/exercises/exercise-form.page').then((m) => m.ExerciseFormPage),
    data: { titleKey: 'exercises.new', navTab: 'plans', showBack: true },
  },
  {
    path: 'exercises/:exerciseId/edit',
    loadComponent: () =>
      import('./features/exercises/exercise-form.page').then((m) => m.ExerciseFormPage),
    data: { titleKey: 'exercises.edit', navTab: 'plans', showBack: true },
  },
  {
    path: 'exercises/:exerciseId',
    loadComponent: () =>
      import('./features/exercises/exercise-detail.page').then((m) => m.ExerciseDetailPage),
    data: { titleKey: 'page.exercises.title', navTab: 'plans', showBack: true },
  },

  // Training
  {
    path: 'train',
    loadComponent: placeholder,
    data: { titleKey: 'page.train.title', navTab: 'train', preload: true },
  },
  {
    path: 'train/active',
    loadComponent: placeholder,
    // No tab bar: leaving an active session must be a deliberate choice, not a
    // stray tab tap. The CanDeactivate guard arrives with Phase 5.
    data: { titleKey: 'page.trainActive.title', hideNav: true, preload: true },
  },
  {
    path: 'train/summary/:workoutId',
    loadComponent: placeholder,
    data: { titleKey: 'page.trainActive.title', navTab: 'train' },
  },

  // History
  {
    path: 'history',
    loadComponent: placeholder,
    data: { titleKey: 'page.history.title', navTab: 'home' },
  },
  {
    path: 'history/:workoutId',
    loadComponent: placeholder,
    data: { titleKey: 'page.history.title', navTab: 'home', showBack: true },
  },

  // Progress and body
  {
    path: 'progress',
    loadComponent: placeholder,
    data: { titleKey: 'page.progress.title', navTab: 'progress' },
  },
  {
    path: 'progress/exercise/:exerciseId',
    loadComponent: placeholder,
    data: { titleKey: 'page.progress.title', navTab: 'progress', showBack: true },
  },
  {
    path: 'body',
    loadComponent: placeholder,
    data: { titleKey: 'page.body.title', navTab: 'progress' },
  },

  // Settings
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
    data: { titleKey: 'page.settings.title', navTab: 'more' },
  },
  ...(['profile', 'units', 'workout', 'data', 'about'] as const).map((sub) => ({
    path: `settings/${sub}`,
    loadComponent: placeholder,
    data: { titleKey: 'page.settings.title', navTab: 'more', showBack: true },
  })),

  // Development-only component gallery. Excluded from production builds so it
  // cannot be reached in the deployed app.
  ...(isDevMode()
    ? [
        {
          path: 'dev/ui',
          loadComponent: () =>
            import('./features/dev/ui-gallery.page').then((m) => m.UiGalleryPage),
          data: { titleKey: 'app.name', navTab: 'more' },
        },
      ]
    : []),

  // A 404 page rather than a silent redirect to the dashboard: a broken link
  // should be visible, not quietly swallowed.
  {
    path: '**',
    loadComponent: placeholder,
    data: { titleKey: 'page.notFound.title' },
  },
];
