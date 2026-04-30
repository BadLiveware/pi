/**
 * Shared Stardock state barrel.
 *
 * Keep feature-owned behavior in vertical slices; this barrel only re-exports
 * shared state contracts, path helpers, migrations, and persistence.
 */

export * from "./state/core.ts";
export * from "./state/paths.ts";
export * from "./state/migration.ts";
export * from "./state/store.ts";
