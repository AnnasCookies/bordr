import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Remove the throwaway data directories the e2e web server ran against. */
export default function teardown(): void {
	const dir = tmpdir();
	for (const name of readdirSync(dir)) {
		if (!name.startsWith('bordr-e2e-')) continue;
		try {
			rmSync(join(dir, name), { recursive: true, force: true });
		} catch {
			// Another run may own it; leaving it is harmless.
		}
	}
}
