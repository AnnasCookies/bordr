import { defineConfig } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// WebKit reserves 4190 for Sieve; use an ordinary HTTP test port.
const port = 4189;
// Invented files only: neither browser requests nor the watcher reach a real agent or file root.
const fixture = mkdtempSync(join(tmpdir(), 'bordr-security-browser-'));
mkdirSync(join(fixture, 'report'));
writeFileSync(join(fixture, 'endpoints.json'), '{"ssh":[]}');
writeFileSync(join(fixture, 'secret.js'), 'window.fixtureLeaked = "invented";');
writeFileSync(join(fixture, 'report', 'other.md'), '# Sibling note');
writeFileSync(
	join(fixture, 'report', 'app.js'),
	'document.querySelector("#status").textContent = "sibling loaded";'
);
writeFileSync(join(fixture, 'report', 'style.css'), '.proof { color: rgb(1, 2, 3); }');
writeFileSync(
	join(fixture, 'report', 'index.html'),
	'<link rel="stylesheet" href="style.css"><p id="status" class="proof">pending</p><script src="app.js"></script><script src="../secret.js"></script>'
);
writeFileSync(
	join(fixture, 'report', 'notes.md'),
	'# Synthetic notes\n\n<a style="position:fixed;inset:0;z-index:999" class="fixed inset-0 z-40" href="/a/invented?shared=x&text=synthetic">Fixture action</a>\n\n[Sibling note](other.md)\n\n<a href="javascript:window.fixtureLeaked=true">Blocked script</a>\n\n```ts\nconst n = 1;\n```'
);

export default defineConfig({
	testDir: 'e2e',
	testMatch: 'security-regressions.e2e.ts',
	workers: 1,
	projects: ['chromium', 'webkit'].flatMap((browserName) =>
		[390, 1400].map((width) => ({
			name: `${browserName}-${width}`,
			use: { browserName: browserName as 'chromium' | 'webkit', viewport: { width, height: 844 } }
		}))
	),
	use: { baseURL: `http://127.0.0.1:${port}` },
	webServer: {
		command: 'bun .security-build/index.js',
		port,
		reuseExistingServer: false,
		env: {
			HOST: '127.0.0.1',
			PORT: String(port),
			HERDR_SOCKET: join(fixture, 'absent.sock'),
			HERDR_ENDPOINTS: join(fixture, 'endpoints.json'),
			BORDR_DATA_DIR: join(fixture, 'state'),
			BORDR_FILE_ROOTS: `fixture:${fixture}`,
			SOCKET_PATH: ''
		}
	}
});
