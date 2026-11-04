/**
 * Build identity. **Generated — do not edit.**
 *
 * The committed copy holds development defaults; `scripts/stamp-build.mjs`
 * overwrites it in CI before the production build. A null `commit` means
 * this build was never stamped, and About says exactly that rather than
 * printing a value nobody can trace back to anything.
 */
export interface BuildInfo {
  version: string;
  /** Short SHA of the commit this was built from, or null when unstamped. */
  commit: string | null;
  /** ISO instant the build ran, or null when unstamped. */
  builtAt: string | null;
}

export const BUILD_INFO: BuildInfo = {
  version: '0.0.0',
  commit: null,
  builtAt: null,
};
