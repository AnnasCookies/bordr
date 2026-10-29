import { beforeEach, expect, it, vi } from 'vitest';
import { pickerIdentity } from '#lib/picker-shortcut.js';
import { parsePicker } from '#lib/server/picker.js';

const fixture = vi.hoisted(() => ({
	scope: 'original',
	flipAfterRead: false,
	reads: [] as string[],
	inputs: [] as string[]
}));
const screen = 'Approve the fixture?\n❯ 1. Yes\n  2. No\nEnter to select · Esc to cancel';
vi.mock('#lib/server/herdr/connections.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/herdr/connections.js')>()),
	ensureConnection: async () => {
		const captured = fixture.scope;
		return {
			error: null,
			machine: { id: 'remote', target: captured, session: 'main', enabled: true },
			client: {
				sourceScope: captured,
				request: async (method: string) => {
					if (method === 'agent.read' || method === 'pane.read') {
						fixture.reads.push(captured);
						if (fixture.flipAfterRead) fixture.scope = 'replacement';
						return { read: { text: screen } };
					}
					fixture.inputs.push(captured);
					return {};
				}
			}
		};
	}
}));
vi.mock('#lib/server/herdr/machines.js', () => ({ listMachines: () => [] }));

beforeEach(() => {
	fixture.scope = 'original';
	fixture.flipAfterRead = false;
	fixture.reads.length = 0;
	fixture.inputs.length = 0;
});

async function answer(scope?: string) {
	const { POST } = await import('./+server');
	return POST({
		params: { pane: 'remote~w1:p1' },
		request: new Request('http://fixture', {
			method: 'POST',
			body: JSON.stringify({ index: 1, scope, dialog: pickerIdentity(parsePicker(screen)) })
		})
	} as never);
}

it.each(['replacement', 'new-session'])(
	'refuses an old answer before reading %s',
	async (replacement) => {
		fixture.scope = replacement;
		await expect(answer('original')).rejects.toMatchObject({ status: 409 });
		expect(fixture.reads).toEqual([]);
		expect(fixture.inputs).toEqual([]);
	}
);

it('retains the captured binding when the target changes after screen verification', async () => {
	fixture.flipAfterRead = true;
	await expect(answer('original')).rejects.toMatchObject({ status: 409 });
	expect(fixture.reads).toEqual(['original']);
	expect(fixture.inputs).toEqual([]);
});

it('still sends one confirmation to an unchanged recorded target', async () => {
	const response = await answer('original');
	expect(await response.json()).toMatchObject({ ok: true, chose: 'Yes' });
	expect(fixture.inputs).toEqual(['original']);
});

it('requires a source binding for a remote answer', async () => {
	await expect(answer()).rejects.toMatchObject({ status: 400 });
	expect(fixture.inputs).toEqual([]);
});
