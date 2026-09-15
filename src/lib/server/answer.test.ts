import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pickerIdentity } from '$lib/picker-shortcut';
import { parsePicker } from './picker';

const fixture = vi.hoisted(() => ({
	visible: '',
	read: vi.fn<() => Promise<string>>(),
	keys: vi.fn<(pane: string, keys: string[]) => Promise<void>>(),
	text: vi.fn<(pane: string, text: string) => Promise<void>>()
}));
vi.mock('$lib/server/herdr', () => ({
	rawAgent: async () => null,
	readVisible: fixture.read,
	sendKeys: fixture.keys,
	sendText: fixture.text,
	promptAgent: vi.fn()
}));
import { POST } from '../../routes/api/agents/[pane]/answer/+server';

function multi(question: string, selected = false) {
	return `${question}\n${selected ? '❯' : ' '} 1. [x] Buzz\n  2. [ ] Ding\n  3. [✔] Silence\n${selected ? ' ' : '❯'} Submit\nEnter to submit answer · Esc to cancel`;
}
function writeIn(subject: string) {
	return `${subject}\n❯ 1. One\n  2. Two\n  3. Type something.\nEnter to select · ↑/↓ to navigate · Esc to cancel`;
}
async function post(body: object) {
	return POST({
		params: { pane: 'fixture' },
		request: new Request('http://fixture', { method: 'POST', body: JSON.stringify(body) })
	} as Parameters<typeof POST>[0]);
}
beforeEach(() => {
	vi.useFakeTimers();
	fixture.read.mockReset().mockImplementation(async () => fixture.visible);
	fixture.keys.mockReset().mockResolvedValue();
	fixture.text.mockReset().mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

for (const selected of [true, false]) {
	it(`one Submit never confirms the next question (next checkbox highlighted: ${selected})`, async () => {
		fixture.visible = multi('First question?');
		fixture.keys.mockImplementation(async () => {
			fixture.visible = multi('Second question?', selected);
		});
		const result = post({ submit: true });
		await vi.runAllTimersAsync();
		expect(await (await result).json()).toMatchObject({ outcome: 'accepted' });
		expect(fixture.keys.mock.calls).toEqual([['fixture', ['enter']]]);
		expect(parsePicker(fixture.visible)?.question).toBe('Second question?');
	});
}
it('only observes after one confirmation, even while the original dialog remains visible', async () => {
	fixture.visible = multi('Slow screen?');
	const result = post({ submit: true });
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ outcome: 'unknown' });
	expect(fixture.keys.mock.calls).toEqual([['fixture', ['enter']]]);
	expect(fixture.read.mock.calls.length).toBeGreaterThan(2);
});
it('navigates to the original Submit row, confirms once and observes closure', async () => {
	fixture.visible = multi('First question?', true);
	fixture.keys.mockImplementation(async (_pane, keys) => {
		fixture.visible = keys.includes('enter') ? '' : multi('First question?');
	});
	const result = post({ submit: true });
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ outcome: 'accepted' });
	expect(fixture.keys.mock.calls).toEqual([
		['fixture', ['down', 'down', 'down']],
		['fixture', ['enter']]
	]);
});
it('refuses a replacement dialog reached by navigation before confirmation', async () => {
	fixture.visible = multi('First question?', true);
	fixture.keys.mockImplementation(async () => {
		fixture.visible = multi('Second question?');
	});
	const result = post({ submit: true }).then(
		(r) => r.status,
		(e) => e.status
	);
	await vi.runAllTimersAsync();
	expect(await result).toBe(409);
	expect(fixture.keys.mock.calls).toEqual([['fixture', ['down', 'down', 'down']]]);
});
it('refuses replacement between the initial screen and the first navigation read', async () => {
	fixture.visible = multi('First question?', true);
	fixture.read.mockResolvedValueOnce(fixture.visible).mockResolvedValue(multi('Second question?'));
	const result = post({ submit: true }).then(
		(r) => r.status,
		(e) => e.status
	);
	await vi.runAllTimersAsync();
	expect(await result).toBe(409);
	expect(fixture.keys).not.toHaveBeenCalled();
});
it('rejects a captured write-in for a replacement dialog even if its index still exists', async () => {
	const dialog = pickerIdentity(parsePicker(writeIn('Original question?')));
	fixture.visible = writeIn('Replacement question?');
	const result = post({ index: 3, text: 'captured answer', dialog }).then(
		(r) => r.status,
		(e) => e.status
	);
	await vi.runAllTimersAsync();
	expect(await result).toBe(409);
	expect(fixture.keys).not.toHaveBeenCalled();
	expect(fixture.text).not.toHaveBeenCalled();
});
it('types the captured write-in into the matching original dialog', async () => {
	fixture.visible = writeIn('Original question?');
	const dialog = pickerIdentity(parsePicker(fixture.visible));
	fixture.keys.mockImplementation(async (_pane, keys) => {
		if (keys.includes('enter')) fixture.visible = '';
	});
	const result = post({ index: 3, text: 'captured answer', dialog });
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ outcome: 'accepted' });
	expect(fixture.text).toHaveBeenCalledWith('fixture', 'captured answer');
	expect(fixture.keys.mock.calls).toEqual([
		['fixture', ['down', 'down']],
		['fixture', ['enter']]
	]);
});
