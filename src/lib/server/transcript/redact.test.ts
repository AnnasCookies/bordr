import { describe, expect, it } from 'vitest';
import { piAdapter } from './pi';
import { redactSecrets, withSecretRedaction } from './redact';
import type { Adapter } from './types';

const SECRET = 'a'.repeat(64);
const STRUCTURED_SECRET = 'nested api key with spaces';

describe('redactSecrets', () => {
	it('redacts direct, escaped, quoted, multiline and header credentials', () => {
		const escaped = String.raw`{\"CTXC_API_TOKEN\":\"${SECRET}\"}`;
		const twiceEscaped = String.raw`{\\"CTXC_API_TOKEN\\":\\"${SECRET}\\"}`;
		const escapedSpaced = String.raw`{\"DB_PASSWORD\":\"correct horse battery staple\"}`;
		const pem = 'PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nline one\n-----END PRIVATE KEY-----"';
		const embeddedQuote = String.raw`DB_PASSWORD="correct \"horse\" battery staple" command`;
		const text = [
			`"CTXC_API_TOKEN": "${SECRET}"`,
			escaped,
			twiceEscaped,
			escapedSpaced,
			'DB_PASSWORD="correct horse battery staple"',
			'DB_PASSWORD="correct horse battery staple" command',
			'DB_PASSWORD="correct horse battery staple"; command',
			'DB_PASSWORD="correct horse battery staple" # comment',
			embeddedQuote,
			pem,
			`API_TOKEN=${SECRET}`,
			'X-API-Key: abc',
			`Authorization: Bearer ${SECRET}`,
			'Authorization: Basic dXNlcjpwYXNz'
		].join('\n');

		expect(redactSecrets(text)).toBe(
			[
				'"CTXC_API_TOKEN": "[REDACTED]"',
				escaped.replace(SECRET, '[REDACTED]'),
				twiceEscaped.replace(SECRET, '[REDACTED]'),
				String.raw`{\"DB_PASSWORD\":\"[REDACTED]\"}`,
				'DB_PASSWORD="[REDACTED]"',
				'DB_PASSWORD="[REDACTED]" command',
				'DB_PASSWORD="[REDACTED]"; command',
				'DB_PASSWORD="[REDACTED]" # comment',
				'DB_PASSWORD="[REDACTED]" command',
				'PRIVATE_KEY="[REDACTED]"',
				'API_TOKEN=[REDACTED]',
				'X-API-Key: [REDACTED]',
				'Authorization: [REDACTED]',
				'Authorization: [REDACTED]'
			].join('\n')
		);
	});

	it('redacts a quoted secret before trailing spaces and a newline', () => {
		const text = 'DB_PASSWORD="correct horse battery staple"   \nnext';
		expect(redactSecrets(text)).toBe('DB_PASSWORD="[REDACTED]"   \nnext');
	});

	it('fails closed for an unterminated quoted secret with spaces', () => {
		expect(redactSecrets('DB_PASSWORD="correct horse battery staple')).toBe(
			'DB_PASSWORD="[REDACTED]'
		);
		expect(redactSecrets('DB_PASSWORD="first line\nsecond secret line')).toBe(
			'DB_PASSWORD="[REDACTED]'
		);
	});

	it('redacts bare private key and OpenSSH private key blocks', () => {
		const text = [
			'before',
			'-----BEGIN PRIVATE KEY-----',
			'plain-private-material',
			'-----END PRIVATE KEY-----',
			'middle',
			'-----BEGIN OPENSSH PRIVATE KEY-----',
			'openssh-private-material',
			'-----END OPENSSH PRIVATE KEY-----',
			'after'
		].join('\n');

		expect(redactSecrets(text)).toBe(
			['before', '[REDACTED PRIVATE KEY]', 'middle', '[REDACTED PRIVATE KEY]', 'after'].join('\n')
		);
	});

	it('leaves harmless mentions and ordinary hashes intact', () => {
		expect(redactSecrets(`CTXC_API_TOKEN is missing\nsha256 ${SECRET}`)).toBe(
			`CTXC_API_TOKEN is missing\nsha256 ${SECRET}`
		);
	});
});

describe('withSecretRedaction', () => {
	it('redacts nested tool inputs, results, diffs and todo text', () => {
		const adapter: Adapter = {
			resolve: async () => null,
			parse: () => [
				{
					role: 'assistant',
					text: '',
					tools: [],
					blocks: [
						{
							kind: 'tool',
							name: 'read',
							summary: 'settings',
							input: { nested: { CTXC_API_TOKEN: SECRET, apiKey: STRUCTURED_SECRET } },
							result: {
								text: `"CTXC_API_TOKEN": "${SECRET}"`,
								isError: false,
								truncatedLines: 0
							},
							diffs: [{ file: 'config', before: `API_KEY=${SECRET}`, after: 'API_KEY=changed' }],
							todo: {
								completed: 0,
								abandoned: 0,
								closed: 0,
								total: 1,
								open: 1,
								blocked: 0,
								activePhase: 'Safety',
								activePhaseIndex: 1,
								phaseCount: 1,
								phases: [
									{
										name: 'Safety',
										items: [{ content: `Rotate TOKEN=${SECRET}`, status: 'pending' }]
									}
								]
							}
						}
					]
				}
			]
		};

		const output = JSON.stringify(withSecretRedaction(adapter).parse(''));
		expect(output).not.toContain(SECRET);
		expect(output).not.toContain(STRUCTURED_SECRET);
		expect(output).toContain('[REDACTED]');
	});

	it('fails closed when Pi truncates a private key before its END marker', () => {
		const key = [
			'-----BEGIN PRIVATE KEY-----',
			...Array.from({ length: 40 }, (_, index) => `private-line-${index}`),
			'-----END PRIVATE KEY-----'
		].join('\n');
		const transcript = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'toolCall', id: 'key-1', name: 'read', arguments: { path: 'key.pem' } }]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'key-1',
					content: [{ type: 'text', text: key }]
				}
			})
		].join('\n');

		const tool = withSecretRedaction(piAdapter)
			.parse(transcript)[0]
			?.blocks?.find((block) => block.kind === 'tool');
		expect(tool?.kind === 'tool' ? tool.result : null).toEqual({
			text: '[REDACTED PRIVATE KEY]',
			isError: false,
			truncatedLines: 2
		});
	});
});
