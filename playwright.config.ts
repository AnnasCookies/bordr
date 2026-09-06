import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * e2e runs the ADAPTER OUTPUT, not `vite preview`.
 *
 * Preview does not carry the SSE stream, so `/api/events` never connects and
 * every screen renders "bordr unreachable" with an empty agent list — tests
 * either skipped or passed vacuously against a server bordr never runs.
 */
export default defineConfig({
	webServer: {
		// A separate output directory: building into ./build while the systemd
		// service is running from it breaks the live app (see vite.config.ts).
		command: 'BORDR_BUILD_OUT=.e2e-build bun run build && bun ./.e2e-build/index.js',
		port: 4173,
		env: {
			HOST: '127.0.0.1',
			PORT: '4173',
			// Never let a test touch the running service's watches or push subs.
			BORDR_DATA_DIR: join(tmpdir(), `bordr-e2e-${process.pid}`),
			// The repo's own static/ is the only browsable root: it exists on every
			// clone, holds an SVG artifact, and sits one level below package.json,
			// so a traversal that escaped it would find a real file.
			BORDR_FILE_ROOTS: `dev:${resolve('static')}`
		},
		reuseExistingServer: false
	},
	globalTeardown: './playwright.teardown.ts',
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	use: { viewport: { width: 390, height: 844 } }
});
