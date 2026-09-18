import { describe, expect, it, vi } from 'vitest';
import { HerdrRequestError } from './client';
import { promptAfterRegistration } from './prompt-retry';

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
