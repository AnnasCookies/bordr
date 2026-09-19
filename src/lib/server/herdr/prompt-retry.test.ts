import { describe, expect, it, vi } from 'vitest';
import { HerdrRequestError } from './client';
import { promptAfterRegistration, promptWithPaneFallback } from './prompt-retry';

describe('promptAfterRegistration', () => {
	it('waits through the new-agent registration window without duplicating delivery', async () => {
		const send = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new HerdrRequestError('invalid_request', 'not an active named agent'))
			.mockRejectedValueOnce(new HerdrRequestError('invalid_request', 'not an active named agent'))
			.mockResolvedValueOnce();
		const sleep = vi.fn(async () => {});

		await promptAfterRegistration(send, sleep, [250, 500]);

		expect(send).toHaveBeenCalledTimes(3);
		expect(sleep.mock.calls).toEqual([[250], [500]]);
	});

	it('does not retry another refusal', async () => {
		const refused = new HerdrRequestError('invalid_request', 'permission denied');
		const send = vi.fn(async () => {
			throw refused;
		});

		await expect(promptAfterRegistration(send, async () => {})).rejects.toBe(refused);
		expect(send).toHaveBeenCalledOnce();
	});

	it('stops after the bounded retry schedule', async () => {
		const send = vi.fn(async () => {
			throw new HerdrRequestError('invalid_request', 'not an active named agent');
		});

		await expect(promptAfterRegistration(send, async () => {}, [1, 2])).rejects.toThrow(
			'not an active named agent'
		);
		expect(send).toHaveBeenCalledTimes(3);
	});
});

describe('promptWithPaneFallback', () => {
	it('uses terminal input immediately while Herdr still marks launch pending', async () => {
		const sendNamed = vi.fn(async () => undefined);
		const sendPane = vi.fn(async () => undefined);

		await promptWithPaneFallback({ sendNamed, sendPane, launchPending: true });

		expect(sendNamed).not.toHaveBeenCalled();
		expect(sendPane).toHaveBeenCalledOnce();
	});

	it('falls back once after bounded named-agent refusals', async () => {
		const sendNamed = vi.fn(async () => {
			throw new HerdrRequestError('invalid_request', 'not an active named agent');
		});
		const sendPane = vi.fn(async () => undefined);

		await promptWithPaneFallback({
			sendNamed,
			sendPane,
			sleep: async () => undefined,
			delays: [1]
		});

		expect(sendNamed).toHaveBeenCalledTimes(2);
		expect(sendPane).toHaveBeenCalledOnce();
	});

	it('never falls back after an ambiguous failure', async () => {
		const refused = new HerdrRequestError('invalid_request', 'permission denied');
		const sendPane = vi.fn(async () => undefined);

		await expect(
			promptWithPaneFallback({
				sendNamed: async () => {
					throw refused;
				},
				sendPane
			})
		).rejects.toBe(refused);
		expect(sendPane).not.toHaveBeenCalled();
	});
});
