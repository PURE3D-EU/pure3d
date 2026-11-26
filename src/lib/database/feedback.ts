import { pb } from '$lib/database/client';

const maxImageBytes = 20 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function feedbackPageUrl() {
	return window.location.origin + window.location.pathname;
}

export function feedbackSubmission() {
	const images = new Map<string, File>();

	function clear() {
		for (const url of images.keys()) URL.revokeObjectURL(url);
		images.clear();
	}

	return {
		clear,
		stageImage(file: File, feedbackHtml: string) {
			if (!imageTypes.includes(file.type)) {
				throw new Error('Use a JPEG, PNG, WebP or GIF screenshot.');
			}
			for (const url of images.keys()) {
				if (feedbackHtml.includes(url)) continue;
				URL.revokeObjectURL(url);
				images.delete(url);
			}
			if (
				images.size >= 20 ||
				file.size + [...images.values()].reduce((total, image) => total + image.size, 0) >
					maxImageBytes
			) {
				throw new Error('Attach up to 20 screenshots with a combined size of 20 MB.');
			}
			const url = URL.createObjectURL(file);
			images.set(url, file);
			return url;
		},
		async send(input: {
			participantName: string;
			participantEmail: string;
			editionUrl: string;
			category: string;
			severity: string;
			feedbackHtml: string;
		}) {
			const { feedbackHtml, ...fields } = input;
			const draft = document.createElement('template');
			draft.innerHTML = feedbackHtml;
			const attached = new Set<File>();
			for (const image of draft.content.querySelectorAll('img')) {
				const file = images.get(image.getAttribute('src') ?? '');
				if (file) attached.add(file);
				image.remove();
			}
			const { contentText } = await import('$lib/utils/content-html');
			const note = contentText(draft.innerHTML);
			if (!note && !attached.size) throw new Error('Add a short note or a screenshot.');
			const body = new FormData();
			body.set(
				'feedback',
				JSON.stringify({
					...fields,
					note,
					imageCount: attached.size,
					pageUrl: feedbackPageUrl(),
					browserInfo: {
						userAgent: navigator.userAgent,
						language: navigator.language,
						viewport: `${window.innerWidth}x${window.innerHeight}`
					}
				})
			);
			for (const file of attached) body.append('images', file);
			await pb.send('/api/pure3d/feedback', { method: 'POST', body });
			clear();
		}
	};
}
