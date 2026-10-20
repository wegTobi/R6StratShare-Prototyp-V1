// The Node build has no Workers bindings. Existing DB access fails closed with
// the established "binding unavailable" error; no local identity or DB is faked.
export const env = Object.freeze({});
