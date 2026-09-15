import { describe, expect, it } from 'vitest';
import { attachPrompt, storedName } from './attachments';
import { photoMessage } from './transcript/photo';

const STAMP = '1789430000000-ab12cd';

describe('storedName', () => {
	it('names a photo by its type, as it always has', () => {
		expect(storedName({ name: 'IMG_2044.JPG', type: 'image/jpeg' }, STAMP)).toBe(`${STAMP}.jpeg`);
		expect(storedName({ name: 'x', type: 'image/png' }, STAMP)).toBe(`${STAMP}.png`);
	});

	it('keeps a cleaned copy of any other file name, so the agent knows what it is', () => {
		expect(storedName({ name: 'Q3 report (final).pdf', type: 'application/pdf' }, STAMP)).toBe(
			`${STAMP}-Q3-report-final-.pdf`
		);
	});

	/** The name is chosen by whatever app shared the file, so it is untrusted. */
	it('never lets a name leave the uploads directory or hide itself', () => {
		expect(storedName({ name: '../../.ssh/authorized_keys', type: '' }, STAMP)).toBe(
			`${STAMP}-authorized_keys`
		);
		expect(storedName({ name: 'C:\\Users\\me\\.env', type: 'text/plain' }, STAMP)).toBe(
			`${STAMP}-env`
		);
		expect(storedName({ name: '', type: 'application/octet-stream' }, STAMP)).toBe(`${STAMP}.bin`);
	});

	it('keeps the extension of a very long name', () => {
		const name = `${'a'.repeat(200)}.tar.gz`;
		expect(storedName({ name, type: 'application/gzip' }, STAMP).endsWith('.tar.gz')).toBe(true);
	});

	/** An SVG can carry script; it must not get a photo's name and be served back as one. */
	it('does not treat an SVG as a photo', () => {
		expect(storedName({ name: 'logo.svg', type: 'image/svg+xml' }, STAMP)).toBe(
			`${STAMP}-logo.svg`
		);
	});
});

describe('attachPrompt', () => {
	/**
	 * The transcript shows a sent photo as the photo because it recognises this
	 * exact wording. Changing it for files must not change it for photos.
	 */
	it('keeps the wording the transcript renders as photos', () => {
		expect(photoMessage(attachPrompt(['/u/1.png'], true, ''))).not.toBeNull();
		expect(photoMessage(attachPrompt(['/u/1.png', '/u/2.jpeg'], true, 'these two'))).not.toBeNull();
	});

	it('calls anything else a file, and tells the agent to read it', () => {
		const one = attachPrompt(['/u/1-report.pdf'], false, '');
		expect(one).toBe(
			'[The user attached a file from their phone: /u/1-report.pdf — use your file-reading tool to read it before responding.]'
		);
		expect(attachPrompt(['/u/a.pdf', '/u/b.png'], false, 'compare')).toBe(
			'[The user attached 2 files from their phone:\n- /u/a.pdf\n- /u/b.png — use your file-reading tool to read them before responding.]\n\ncompare'
		);
	});
});
