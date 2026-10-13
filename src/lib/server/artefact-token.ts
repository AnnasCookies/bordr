import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';

// A restart revokes open artefact URLs; reloading the viewer issues a fresh capability.
const key = randomBytes(32);

/** Only the trusted viewer can issue a capability for a resolved directory. */
export function artefactToken(directory: string): string {
	return createHmac('sha256', key).update(directory).digest('base64url');
}

/** The file has already passed resolveSafe, so aliases cannot widen this directory grant. */
export function allowsArtefact(token: string | undefined, absolute: string): boolean {
	if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
	const supplied = Buffer.from(token, 'base64url');
	if (supplied.toString('base64url') !== token) return false;
	// Subdirectories contain normal artefact assets too; parents and sibling directories do not.
	for (let directory = dirname(absolute); ; directory = dirname(directory)) {
		if (timingSafeEqual(supplied, Buffer.from(artefactToken(directory), 'base64url'))) return true;
		if (dirname(directory) === directory) return false;
	}
}
