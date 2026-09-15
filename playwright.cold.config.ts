import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Offline only: invented browser payloads, no live panes or inherited machine endpoints. */
export default defineConfig({
	testDir: 'e2e',
	testMatch: 'cold-regressions.e2e.ts',
	workers: 1,
	use: { baseURL: 'http://127.0.0.1:4175', viewport: { width: 1400, height: 900 } },
	webServer: {
		command: 'bun .e2e-build/index.js',
		port: 4175,
		reuseExistingServer: false,
		env: {
			HOST: '127.0.0.1',
			PORT: '4175',
			HERDR_SOCKET: '/tmp/bordr-cold-invalid.sock',
			HERDR_ENDPOINTS: '/tmp/bordr-cold-invalid-endpoints.json',
			BORDR_DATA_DIR: join(tmpdir(), `bordr-cold-browser-${process.pid}`),
			BORDR_FILE_ROOTS: `fixture:${resolve('static')}`
		}
	}
});
