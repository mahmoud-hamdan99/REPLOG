// Public surface of the data layer: contracts and DI tokens only.
// Implementations live in infrastructure/ and are bound in app.config.ts.
// See docs/ARCHITECTURE.md section 4.
export * from './app-meta';
export * from './clock';
export * from './db-events';
export * from './ids';
export * from './photo-blobs';
export * from './prefs';
export * from './repository';
export * from './stores';
export * from './tokens';
export * from './unit-of-work';
