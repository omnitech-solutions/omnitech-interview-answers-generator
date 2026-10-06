// Marks every module that imports this file as server-only: Next stops the
// build if a client component ever reaches one (NX-SEC-04). The Auth config,
// the tenant context and the fake-auth rules read secrets and the session, so
// they must never be bundled for the browser.
//
// The `server-only` package throws when imported outside a server bundle, so
// vitest aliases it to an empty module (vitest.config.ts); Next supplies the
// empty react-server build when it compiles.
import "server-only";
