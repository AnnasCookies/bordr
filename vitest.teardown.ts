import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Nothing to do before the run; the sweep happens after it. */
export function setup(): void {}

/**
 * Remove the throwaway directories the test run created.
 *
 * Swept by PREFIX rather than by the exact path: the config names the data
 * directory after the pid of the process that evaluated it, and the teardown
 * runs somewhere else, so keying on `process.pid` here silently matched
 * nothing. These names belong to this project's tests and nothing else.
 */
const PREFIXES = ['bordr-test-', 'bordr-tail-', 'bordr-files-', 'bordr-root-', 'bordr-outside-'];

/** Vitest has no `globalTeardown` option — a globalSetup file exports this. */
export function teardown(): void {
	const dir = tmpdir();
	for (const name of readdirSync(dir)) {
		if (!PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
		try {
			rmSync(join(dir, name), { recursive: true, force: true });
		} catch {
			// Another run may own it; leaving it is harmless.
		}
	}
}
