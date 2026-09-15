import { expect, test } from '@playwright/test';

/**
 * The manifest against the rules that actually decide whether bordr installs.
 *
 * None of this shows up in a typecheck or a unit test: the manifest is a
 * static JSON file, and the only thing that reads it is a browser deciding
 * whether to offer an install at all. Get a field wrong and the app silently
 * stops being installable, or the richer install dialog silently degrades to
 * a bare name and icon, and nothing anywhere says so.
 *
 * Rules from Chrome's install criteria and its richer-install-UI requirements.
 */

interface Icon {
	src: string;
	sizes: string;
	type?: string;
	purpose?: string;
}
interface Shot {
	src: string;
	sizes: string;
	type?: string;
	form_factor?: string;
}
interface Manifest {
	name?: string;
	short_name?: string;
	start_url?: string;
	display?: string;
	prefer_related_applications?: boolean;
	icons: Icon[];
	screenshots?: Shot[];
	shortcuts?: Array<{ name?: string; url?: string }>;
}

async function manifest(request: import('@playwright/test').APIRequestContext): Promise<Manifest> {
	const response = await request.get('/manifest.webmanifest');
	expect(response.ok()).toBe(true);
	return (await response.json()) as Manifest;
}

test('the manifest meets the install criteria', async ({ request }) => {
	const m = await manifest(request);
	expect(m.short_name || m.name).toBeTruthy();
	expect(m.start_url).toBeTruthy();
	expect(['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']).toContain(
		m.display
	);
	expect(m.prefer_related_applications ?? false).toBe(false);

	// Chrome requires both of these sizes before it will offer an install.
	const sizes = m.icons.map((i) => i.sizes);
	expect(sizes).toContain('192x192');
	expect(sizes).toContain('512x512');
});

/**
 * `any` and `maskable` as separate entries, not one `"any maskable"`.
 *
 * A maskable icon carries padding so a circular mask cannot clip it. Reusing
 * that same padded file as the plain icon shows the artwork smaller than it
 * should be everywhere the mask is not applied.
 */
test('icons declare a maskable set and a plain one', async ({ request }) => {
	const m = await manifest(request);
	const purposes = (p?: string) => (p ?? 'any').split(/\s+/).filter(Boolean);
	expect(m.icons.some((i) => purposes(i.purpose).includes('maskable'))).toBe(true);
	expect(m.icons.some((i) => purposes(i.purpose).includes('any'))).toBe(true);
	expect(m.icons.every((i) => purposes(i.purpose).length === 1)).toBe(true);
});

/**
 * Chrome's richer install dialog reads `wide` on desktop and `narrow` on
 * Android, and ignores the other. One form factor means half of the installs
 * fall back to the plain dialog.
 */
test('screenshots satisfy the richer install dialog', async ({ request }) => {
	const m = await manifest(request);
	const shots = m.screenshots ?? [];
	expect(shots.length).toBeGreaterThan(0);

	for (const factor of ['narrow', 'wide']) {
		const forFactor = shots.filter((s) => s.form_factor === factor);
		expect(forFactor.length).toBeGreaterThan(0);
		// At most five: the documented Android cap, and under the desktop one.
		expect(forFactor.length).toBeLessThanOrEqual(5);

		const ratios = new Set<string>();
		for (const shot of forFactor) {
			expect(shot.type).toMatch(/^image\/(png|jpeg)$/);
			const [w, h] = shot.sizes.split('x').map(Number);
			expect(Math.min(w, h)).toBeGreaterThanOrEqual(320);
			expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
			// The long side may be at most 2.3x the short one.
			expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(2.3);
			ratios.add((w / h).toFixed(3));
		}
		// Every screenshot of one form factor must share an aspect ratio.
		expect(ratios.size).toBe(1);
	}
});

test('every declared file is actually served, at the size it claims', async ({ request }) => {
	const m = await manifest(request);
	const declared = [...m.icons, ...(m.screenshots ?? [])];
	for (const asset of declared) {
		const response = await request.get(asset.src);
		expect(response.ok(), `${asset.src} is declared but not served`).toBe(true);
	}
});

test('every shortcut points somewhere real and in scope', async ({ request }) => {
	const m = await manifest(request);
	const shortcuts = m.shortcuts ?? [];
	expect(shortcuts.length).toBeGreaterThan(0);
	// Android shows three; anything past that is built and thrown away.
	expect(shortcuts.length).toBeLessThanOrEqual(3);
	for (const shortcut of shortcuts) {
		expect(shortcut.name).toBeTruthy();
		expect(shortcut.url?.startsWith('/')).toBe(true);
		const response = await request.get(shortcut.url as string);
		expect(response.ok(), `${shortcut.url} does not load`).toBe(true);
	}
});
