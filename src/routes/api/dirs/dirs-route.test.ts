import { describe, expect, it } from 'vitest';
import { POST } from './+server';

function request(body: string): Request {
	return new Request('http://bordr.test/api/dirs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
}

describe('POST /api/dirs', () => {
	it('rejects malformed JSON', async () => {
		const response = await POST({ request: request('{') } as never);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ message: 'request must be JSON' });
	});

	it('rejects a non-string parent path', async () => {
		const response = await POST({ request: request('{"parent":42,"name":"project"}') } as never);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ message: 'parent folder must be a path' });
	});
});
