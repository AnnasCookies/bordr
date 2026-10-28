/**
 * The server's environment, read when a value is used.
 *
 * SvelteKit 3 removed `$env/dynamic/private`. Its replacement wants every
 * variable declared up front with a schema, and turns an unset one into a
 * default — but bordr's safety checks need unset to stay unset (an unset HOST
 * is refused outright, see bind.ts). This keeps the old shape: one object,
 * looked up at call time, that tests can mock in place of this module.
 */
export const env: Readonly<Record<string, string | undefined>> = process.env;
