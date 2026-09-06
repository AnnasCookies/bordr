/**
 * Shrink a photo on the phone before it is uploaded.
 *
 * A camera photo is 3-6 MB and 4000 px across; the agent reads it with a
 * vision model that sees nothing extra past ~2000 px. Six of them blew
 * through the server's request cap and took a while over the tailnet. A
 * screenshot keeps its format so text stays crisp; a photo becomes a JPEG.
 * Anything the browser cannot decode (HEIC on most Android builds) is sent
 * as it came, and the server's own type check has the final word.
 */
export const MAX_EDGE = 2048;
/** Below this, resizing buys nothing worth the CPU. */
export const SMALL_ENOUGH = 700 * 1024;

export interface Plan {
	/** Multiply both edges by this; 1 means leave the pixels alone. */
	scale: number;
	type: 'image/png' | 'image/jpeg';
	quality: number;
	/** Nothing to gain: send the original untouched. */
	skip: boolean;
}

export function planShrink(
	file: { type: string; size: number },
	width: number,
	height: number
): Plan {
	const png = file.type === 'image/png';
	const type = png ? 'image/png' : 'image/jpeg';
	const longest = Math.max(width, height);
	const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
	// A PNG under the size floor that already fits: leave it. A JPEG that
	// fits is still re-encoded only when it is large, since quality 0.85
	// on a phone JPEG typically halves it.
	const skip = scale === 1 && (png || file.size <= SMALL_ENOUGH);
	return { scale, type, quality: 0.85, skip };
}

/** Resize in the browser; returns the original when there is nothing to gain or decoding fails. */
export async function shrinkImage(file: File): Promise<File> {
	if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return file;
	}
	try {
		const plan = planShrink(file, bitmap.width, bitmap.height);
		if (plan.skip) return file;
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * plan.scale);
		canvas.height = Math.round(bitmap.height * plan.scale);
		const context = canvas.getContext('2d');
		if (!context) return file;
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, plan.type, plan.quality)
		);
		if (!blob || blob.size >= file.size) return file;
		const name = file.name.replace(/\.[^.]+$/, '') + (plan.type === 'image/png' ? '.png' : '.jpg');
		return new File([blob], name, { type: plan.type, lastModified: file.lastModified });
	} finally {
		bitmap.close();
	}
}
