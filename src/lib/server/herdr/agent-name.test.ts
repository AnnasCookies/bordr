import { describe, expect, it } from 'vitest';
import { herdrAgentName, uniqueHerdrAgentName } from './agent-name';

describe('herdrAgentName', () => {
	it('turns a human display label into a valid Herdr agent name', () => {
		expect(herdrAgentName('Model Picker', 'pi')).toBe('model-picker');
		expect(herdrAgentName('Tony’s Pi!', 'pi')).toBe('tonys-pi');
	});

	it('keeps the required leading letter and 32-character ceiling', () => {
		expect(herdrAgentName('123 jobs', 'pi')).toBe('pi-123-jobs');
		expect(herdrAgentName('x'.repeat(50), 'pi')).toBe('x'.repeat(32));
	});

	it('falls back to the harness kind when the label has no usable characters', () => {
		expect(herdrAgentName('🛠️', 'pi')).toBe('pi');
		expect(herdrAgentName(undefined, 'claude')).toBe('claude');
	});
});

describe('uniqueHerdrAgentName', () => {
	it('adds the pane id without breaking Herdr limits', () => {
		const name = uniqueHerdrAgentName('model-picker', 'w2E:p1');
		expect(name).toBe('model-picker-w2e-p1');
		expect(uniqueHerdrAgentName('x'.repeat(32), 'w123:p45')).toHaveLength(32);
		expect(uniqueHerdrAgentName('x'.repeat(32), 'w123:p45')).toMatch(/^[a-z][a-z0-9_-]+$/);
	});
});
