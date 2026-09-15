/**
 * Short tones for "an agent needs you" and "an agent has finished".
 *
 * Synthesised rather than shipped as files: two notes each is a few lines of
 * WebAudio and no bytes on the wire, and a tone generated at a known pitch
 * cannot be a 404 or an unplayable codec on someone's phone.
 *
 * Browsers refuse to start audio until the person has interacted with the
 * page, so the context is created suspended and resumed on the first gesture.
 * Everything before that is silently dropped — which is correct: a page the
 * user has not touched has no business making a noise.
 */

export type Chime = 'attention' | 'done';

/** The two notes of each, in Hz, and how long the whole thing lasts. */
const VOICES: Record<Chime, { notes: [number, number]; step: number; gain: number }> = {
	// Rising and quick — the one that means "you are being waited for".
	attention: { notes: [660, 990], step: 0.11, gain: 0.16 },
	// Falling and softer — an announcement, not a demand.
	done: { notes: [620, 440], step: 0.13, gain: 0.1 }
};

let ctx: AudioContext | null = null;
let unlocked = false;

/** The one context, made on demand so a page that never chimes never makes one. */
function context(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		const Ctor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	return ctx;
}

/**
 * Let audio start, on the first real interaction.
 *
 * Returns a teardown, so a component can own it. Idempotent: several callers
 * arming it is normal, and only the first one does anything.
 */
export function armChimes(): () => void {
	if (typeof window === 'undefined' || unlocked) return () => {};
	const wake = () => {
		unlocked = true;
		void context()?.resume();
		for (const type of ['pointerdown', 'keydown', 'touchend']) {
			window.removeEventListener(type, wake);
		}
	};
	for (const type of ['pointerdown', 'keydown', 'touchend']) {
		window.addEventListener(type, wake, { once: true, passive: true });
	}
	return () => {
		for (const type of ['pointerdown', 'keydown', 'touchend']) {
			window.removeEventListener(type, wake);
		}
	};
}

/**
 * Play one, or do nothing.
 *
 * Never throws and never awaits: this is called from a reactive effect
 * watching agent status, and a failed tone must not be able to take the
 * transcript down with it.
 */
export function chime(kind: Chime): void {
	if (!unlocked) return;
	const audio = context();
	if (!audio || audio.state === 'closed') return;

	const voice = VOICES[kind];
	const start = audio.currentTime;

	voice.notes.forEach((hz, i) => {
		const at = start + i * voice.step;
		const osc = audio.createOscillator();
		const amp = audio.createGain();
		// A triangle rather than a sine: it carries through a pocket without
		// the harshness of a square, and through a phone speaker a pure sine
		// at this level is close to inaudible.
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(hz, at);
		// Ramped, not switched. A gain that steps on and off clicks, and at
		// this length the click is most of what you hear.
		amp.gain.setValueAtTime(0, at);
		amp.gain.linearRampToValueAtTime(voice.gain, at + 0.012);
		amp.gain.exponentialRampToValueAtTime(0.0001, at + voice.step + 0.06);
		osc.connect(amp).connect(audio.destination);
		osc.start(at);
		osc.stop(at + voice.step + 0.08);
	});
}

/** Test seam: pretend a gesture has happened. */
export function unlockForTest(state = true): void {
	unlocked = state;
}
