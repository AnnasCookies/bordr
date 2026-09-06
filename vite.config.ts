import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from 'svelte-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// SvelteKit emits hashes for its own inline hydration script; a
			// hand-rolled script-src 'self' header blocks it and the app never
			// hydrates (which looked exactly like "stuck reconnecting").
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'img-src': ['self', 'data:', 'blob:'],
					'style-src': ['self', 'unsafe-inline'],
					'script-src': ['self'],
					'connect-src': ['self'],
					'frame-ancestors': ['none'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self']
				}
			},
			// The hook in src/hooks.server.ts does this check itself, by host
			// rather than full origin: svelte-adapter-bun assumes https when it
			// has no PROTOCOL_HEADER, so the built-in check refused every form
			// POST on a plain-HTTP loopback run. Do not remove the hook's check.
			csrf: { trustedOrigins: ['*'] },
			// The installed app stays open for days and swaps pages without a
			// reload, so a deploy never reached a phone until the app was
			// closed: it kept running the old bundle and showed the old bugs.
			// Polling version.json makes the next navigation a full load and
			// lets the layout offer a reload as soon as a build lands.
			version: { pollInterval: 30_000 },
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Overridable so the e2e suite can build somewhere else: it used to
			// rebuild ./build under the live service, which then lazy-loaded
			// route chunks that no longer existed and answered 500 on every
			// page but the one already in memory.
			adapter: adapter({ out: process.env.BORDR_BUILD_OUT ?? 'build' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		// `globalSetup`, not `globalTeardown`: Vitest has no such option, and an
		// unknown key is accepted in silence, so the sweep simply never ran.
		globalSetup: ['./vitest.teardown.ts'],
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Never let a test touch the running service's state.
					env: { BORDR_DATA_DIR: join(tmpdir(), `bordr-test-${process.pid}`) },
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
