import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ompResultImages, piAdapter, piSessionEnded } from './pi';

const SESSION = [
	'{"type":"session","version":1}',
	'{"type":"message","timestamp":"2026-09-11T12:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"look at the repo"}]}}',
	'{"type":"message","timestamp":"2026-09-11T12:00:01.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Check it safely."},{"type":"text","text":"On it."},{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"/repo","i":"Listing repo root"},"intent":"Listing repo root"}]}}',
	'{"type":"message","message":{"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"files..."}],"isError":false}}',
	'{"type":"custom_message","customType":"x","content":"noise"}',
	'{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]}}'
].join('\n');

describe('piAdapter.parse', () => {
	it('keeps conversation turns and attaches tool results without extra bubbles', () => {
		const messages = piAdapter.parse(SESSION);
		expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
		expect(messages[1].blocks).toEqual([
			{ kind: 'thinking', text: 'Check it safely.' },
			{ kind: 'text', text: 'On it.' },
			{
				kind: 'tool',
				name: 'read',
				summary: 'Listing repo root',
				input: { path: '/repo', i: 'Listing repo root' },
				result: { text: 'files...', isError: false, truncatedLines: 0 },
				diffs: []
			}
		]);
	});

	it('keeps canonical OMP todo details instead of reparsing display text', () => {
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'toolCall', id: 'todo-1', name: 'todo', arguments: { op: 'view' } }]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'todo-1',
					content: [{ type: 'text', text: 'wording deliberately not parsed' }],
					details: {
						op: 'view',
						phases: [
							{
								name: 'Safety',
								tasks: [
									{ content: 'Remove probe', status: 'abandoned' },
									{ content: 'Check ctxc', status: 'blocked', blocker: 'server offline' }
								]
							}
						]
					}
				}
			})
		].join('\n');

		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			todo: {
				abandoned: 1,
				closed: 1,
				total: 2,
				open: 0,
				blocked: 1,
				activePhase: 'Safety',
				phases: [
					{
						name: 'Safety',
						items: [
							{ content: 'Remove probe', status: 'abandoned' },
							{ content: 'Check ctxc', status: 'blocked', note: 'server offline' }
						]
					}
				]
			}
		});
	});

	it('keeps timestamps for pending-prompt ordering', () => {
		expect(piAdapter.parse(SESSION)[0].at).toBe(Date.parse('2026-09-11T12:00:00.000Z'));
	});

	it('spots a stale session report without rejecting a resumed transcript', () => {
		const exited = `${SESSION}\n${JSON.stringify({ type: 'custom', customType: 'session_exit' })}`;
		expect(piSessionEnded(exited)).toBe(true);
		expect(
			piSessionEnded(
				`${exited}\n${JSON.stringify({ type: 'message', message: { role: 'user', content: 'back' } })}`
			)
		).toBe(false);
	});

	it('derives flat preview fields from rich blocks', () => {
		const assistant = piAdapter.parse(SESSION)[1];
		expect(assistant.text).toBe('On it.');
		expect(assistant.tools).toEqual([{ name: 'read', summary: 'Listing repo root' }]);
	});

	it('renders free-form edit input and names the file it changes', () => {
		const patch =
			'*** Begin Patch\n[src/lib/example.ts#A1B2]\nPUT 1.=1:\n+const ok = true;\n*** End Patch\n';
		const line = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [{ type: 'toolCall', id: 'edit-1', name: 'edit', arguments: patch }]
			}
		});
		const tool = piAdapter.parse(line)[0].blocks?.[0];
		expect(tool).toMatchObject({
			kind: 'tool',
			summary: 'src/lib/example.ts',
			input: { input: patch }
		});
	});

	it('keeps native Pi edit changes when the result has no diff details', () => {
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id: 'edit-native',
							name: 'edit',
							arguments: {
								path: '/repo/example.ts',
								edits: [
									{ oldText: 'const one = 1;', newText: 'const one = 2;' },
									{ oldText: 'const two = 2;', newText: 'const two = 3;' }
								]
							}
						}
					]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'edit-native',
					content: [{ type: 'text', text: 'Successfully replaced 2 blocks.' }]
				}
			})
		].join('\n');
		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			diffs: [
				{ file: '/repo/example.ts', before: 'const one = 1;', after: 'const one = 2;' },
				{ file: '/repo/example.ts', before: 'const two = 2;', after: 'const two = 3;' }
			]
		});
	});

	it('keeps native Pi line numbers from result details that omit the path', () => {
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id: 'edit-numbered',
							name: 'edit',
							arguments: {
								path: '/repo/example.ts',
								edits: [{ oldText: 'old one\nold two', newText: 'new one\nnew two' }]
							}
						}
					]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'edit-numbered',
					content: [{ type: 'text', text: 'Successfully replaced 2 blocks.' }],
					details: {
						diff: '-145 old one\n+145 new one\n     ...\n-219 \told two\n+219 \tnew two',
						firstChangedLine: 145
					}
				}
			})
		].join('\n');
		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			diffs: [
				{
					file: '/repo/example.ts',
					before: 'old one\n\told two',
					after: 'new one\n\tnew two',
					beforeLines: [145, 219],
					afterLines: [145, 219]
				}
			]
		});
	});

	it('uses OMP diff lines instead of duplicating whole-file snapshots', () => {
		const oldText = `${Array.from({ length: 500 }, (_, i) => `old ${i}`).join('\n')}\nconst value = 1;`;
		const newText = oldText.replace('const value = 1;', 'const value = 2;');
		const details = {
			diff: ' 500|old 499\n-501|const value = 1;\n+501|const value = 2;',
			path: '/repo/example.ts',
			oldText,
			newText,
			op: 'update'
		};
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'toolCall', id: 'edit-1', name: 'edit', arguments: 'patch' }]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'edit-1',
					content: [{ type: 'text', text: 'Done' }],
					details
				}
			})
		].join('\n');
		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			diffs: [
				{
					file: '/repo/example.ts',
					before: 'const value = 1;',
					after: 'const value = 2;'
				}
			]
		});
	});

	it('keeps every file from OMP multi-file edit results', () => {
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'toolCall', id: 'edit-many', name: 'edit', arguments: 'patch' }]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'edit-many',
					content: [{ type: 'text', text: 'Done' }],
					details: {
						diff: '-1|old one\n+1|new one\n-1|old two\n+1|new two',
						perFileResults: [
							{ path: '/repo/one.ts', diff: '-1|old one\n+1|new one', op: 'update' },
							{ path: '/repo/two.ts', diff: '-1|old two\n+1|new two', op: 'update' }
						]
					}
				}
			})
		].join('\n');
		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			diffs: [
				{ file: '/repo/one.ts', before: 'old one', after: 'new one' },
				{ file: '/repo/two.ts', before: 'old two', after: 'new two' }
			]
		});
	});

	it('marks failed results and bounds long output without losing the dropped count', () => {
		const output = Array.from({ length: 43 }, (_, i) => `line ${i + 1}`).join('\n');
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: {} }]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'tool-1',
					content: [{ type: 'text', text: output }],
					isError: true
				}
			})
		].join('\n');
		const result = piAdapter.parse(jsonl)[0].blocks?.[0];
		expect(result).toMatchObject({
			kind: 'tool',
			result: { isError: true, truncatedLines: 3 }
		});
		if (result?.kind !== 'tool') throw new Error('expected a tool block');
		expect(result.result?.text.split('\n')).toHaveLength(40);
	});

	it('puts a native Pi Read image on the matching tool result', () => {
		const data = Buffer.from('inline image fixture').toString('base64');
		const jsonl = [
			JSON.stringify({
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id: 'read-image',
							name: 'read',
							arguments: { path: '/tmp/screenshot.png' }
						}
					]
				}
			}),
			JSON.stringify({
				type: 'message',
				message: {
					role: 'toolResult',
					toolCallId: 'read-image',
					content: [
						{ type: 'text', text: 'Read image file [image/png]' },
						{ type: 'image', data, mimeType: 'image/png' }
					]
				}
			})
		].join('\n');
		expect(piAdapter.parse(jsonl)[0].blocks?.[0]).toMatchObject({
			kind: 'tool',
			name: 'read',
			result: {
				text: 'Read image file [image/png]',
				images: [`data:image/png;base64,${data}`]
			}
		});
	});

	it('offers an unanswered ask and clears it when its result arrives', () => {
		const call = JSON.stringify({
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'ask-1',
						name: 'ask',
						arguments: {
							questions: [
								{
									question: 'Which colour?',
									options: [{ label: 'Red' }, { label: 'Blue' }]
								}
							]
						}
					}
				]
			}
		});
		expect(piAdapter.parse(call)[0].ask).toEqual({
			question: 'Which colour?',
			options: ['Red', 'Blue']
		});
		const result = JSON.stringify({
			type: 'message',
			message: {
				role: 'toolResult',
				toolCallId: 'ask-1',
				content: [{ type: 'text', text: 'User selected: Red' }]
			}
		});
		expect(piAdapter.parse(`${call}\n${result}`)[0].ask).toBeUndefined();
	});
});

describe('ompResultImages', () => {
	const hash = 'a'.repeat(64);
	const image = (data: string, mimeType = 'image/webp') => ({
		type: 'image',
		data,
		mimeType
	});

	it('resolves a strict blob hash into a bounded image data URL', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bordr-omp-blobs-'));
		try {
			await writeFile(join(dir, hash), Buffer.from('webp fixture'));
			expect(ompResultImages([image(`blob:sha256:${hash}`)], dir)).toEqual({
				images: [`data:image/webp;base64,${Buffer.from('webp fixture').toString('base64')}`],
				dropped: 0
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('accepts native Pi inline base64 without a blob-store round trip', () => {
		const bytes = Buffer.from('inline image fixture');
		const data = bytes.toString('base64');
		expect(ompResultImages([image(data, 'IMAGE/PNG')])).toEqual({
			images: [`data:image/png;base64,${data}`],
			dropped: 0
		});
		expect(ompResultImages([image(data)], undefined, { remaining: bytes.length - 1 })).toEqual({
			images: [],
			dropped: 1
		});
	});

	it('shares one image byte budget across tool results', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bordr-omp-blobs-'));
		try {
			const bytes = Buffer.from('webp fixture');
			await writeFile(join(dir, hash), bytes);
			const budget = { remaining: bytes.length };
			expect(ompResultImages([image(`blob:sha256:${hash}`)], dir, budget).images).toHaveLength(1);
			expect(ompResultImages([image(`blob:sha256:${hash}`)], dir, budget)).toEqual({
				images: [],
				dropped: 1
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('rejects traversal, unsafe media, bad inline data and linked blobs', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bordr-omp-blobs-'));
		try {
			await symlink('/etc/passwd', join(dir, hash));
			expect(
				ompResultImages(
					[
						image('blob:sha256:../../etc/passwd'),
						image(`blob:sha256:${hash}`, 'text/html'),
						image('data:image/png;base64,AAAA', 'image/png'),
						image('not base64!', 'image/png'),
						image(`blob:sha256:${hash}`)
					],
					dir
				)
			).toEqual({ images: [], dropped: 0 });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('reports a regular blob that exceeds the per-image cap', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bordr-omp-blobs-'));
		try {
			const path = join(dir, hash);
			await writeFile(path, '');
			await truncate(path, 1_100_001);
			expect(ompResultImages([image(`blob:sha256:${hash}`)], dir)).toEqual({
				images: [],
				dropped: 1
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('piAdapter.resolve', () => {
	it('accepts only absolute existing paths', async () => {
		expect(await piAdapter.resolve('not-a-path')).toBeNull();
		expect(await piAdapter.resolve('/no/such/file.jsonl')).toBeNull();
	});
});

describe('pi adapter: hostile lines', () => {
	it('skips a bare null or scalar line instead of throwing', () => {
		const good = JSON.stringify({
			type: 'message',
			message: { role: 'user', content: 'hello' }
		});
		expect(() => piAdapter.parse(`null\n42\n"str"\n${good}\n`)).not.toThrow();
		expect(piAdapter.parse(`null\n${good}\n`)).toHaveLength(1);
	});
});
