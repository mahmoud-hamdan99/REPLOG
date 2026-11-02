import type { CanDeactivateFn } from '@angular/router';
import type { ActiveWorkoutPage } from './active-workout.page';

/**
 * Leaving the tracker requires an explicit choice.
 *
 * docs/ARCHITECTURE.md section 7.4 and UI_UX_SPEC section 5.3: *leaving the
 * screen is impossible without an explicit choice*. The guard hands the
 * decision to the component, which shows Keep training / Pause and exit /
 * Discard and resolves only once one is picked.
 *
 * The component answers immediately when there is nothing to protect — no
 * session, or a session another tab owns — so this never gets in the way of
 * ordinary navigation.
 */
export const canLeaveActiveWorkout: CanDeactivateFn<ActiveWorkoutPage> = (component) =>
  component.canLeave();
