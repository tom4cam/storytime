// Root Vitest workspace. Without this, running `vitest` from the repo root
// (instead of from apps/web) silently ignores apps/web/vitest.config.ts —
// dropping its setupFiles and include globs, which made storage-backed tests
// fail with "window.localStorage.removeItem is not a function". Pointing the
// workspace at apps/web makes the suite behave identically from either cwd.
export default ['apps/web'];
