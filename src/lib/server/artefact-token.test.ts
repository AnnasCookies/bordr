import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { allowsArtefact, artefactToken } from './artefact-token';

const directory = resolve('fixture', 'report');

describe('artefact capabilities', () => {
	it('allows siblings and nested assets but not a parent or neighbouring directory', () => {
		const token = artefactToken(directory);
		expect(allowsArtefact(token, join(directory, 'app.js'))).toBe(true);
		expect(allowsArtefact(token, join(directory, 'assets', 'app.js'))).toBe(true);
		expect(allowsArtefact(token, resolve(directory, '..', 'secret.js'))).toBe(false);
		expect(allowsArtefact(token, resolve(directory, '..', 'other', 'app.js'))).toBe(false);
	});

	it('refuses a non-canonical spelling of a genuine token that decodes to the same bytes', () => {
		const token = artefactToken(directory);
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
		const alias = token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)!) + 1];
		expect(Buffer.from(alias, 'base64url').equals(Buffer.from(token, 'base64url'))).toBe(true);
		expect(allowsArtefact(alias, join(directory, 'app.js'))).toBe(false);
	});

	it('refuses missing, malformed, non-canonical and forged tokens', () => {
		for (const token of [undefined, '', '~', 'a'.repeat(43), 'a'.repeat(44)]) {
			expect(allowsArtefact(token, join(directory, 'app.js'))).toBe(false);
		}
	});
});
