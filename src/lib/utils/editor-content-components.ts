import { Node } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
	isCalloutStyle,
	isCmsColumnCount,
	normaliseContentImage,
	normaliseLogoItems,
	normaliseProfileCards,
	normaliseProjectFacts,
	parseEditionIds,
	parseOpenCallIds,
	safeContentUrl,
	serialiseEditionIds,
	serialiseOpenCallIds,
	type CalloutStyle,
	type ContentImage,
	type CmsColumnCount,
	type LogoItem,
	type ProfileCard,
	type ProjectFact
} from './content-components';

/** Editor-only chrome. Serialisation still uses each extension's original renderHTML. */
export function withComponentControls(extension: Node) {
	return extension.extend({
		addNodeView() {
			const parent = this.parent?.();
			return (props) => {
				const { editor, getPos } = props;
				let node = props.node;
				const labels: Record<string, string> = {
					cmsCallout: 'Callout',
					cmsColumns: 'Columns',
					cmsActions: 'Action links',
					cmsProfileCards: 'Profile cards',
					cmsLogoGrid: 'Logo grid',
					cmsProjectFacts: 'Project facts',
					cmsEditionGrid: 'Edition grid',
					cmsOpenCalls: 'Open calls',
					cmsExpandable: 'Expandable section',
					contentImageFigure: 'Image',
					image: 'Image'
				};
				const view = parent?.(props);
				const rendered = view || DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
				const dom = document.createElement('div');
				dom.className = 'cms-component-node';
				dom.addEventListener('click', (event) => {
					if ((event.target as HTMLElement).closest('a, summary')) event.preventDefault();
				});
				const controls = document.createElement('div');
				controls.className = 'cms-component-controls';
				controls.contentEditable = 'false';
				controls.setAttribute('role', 'group');
				controls.setAttribute('aria-label', `${labels[node.type.name]} controls`);
				const title = document.createElement('strong');
				title.textContent = labels[node.type.name];
				controls.append(title);
				const button = (label: string, action: () => void) => {
					const button = document.createElement('button');
					button.type = 'button';
					button.textContent = label;
					button.setAttribute('aria-label', `${label} ${labels[node.type.name].toLowerCase()}`);
					button.addEventListener('mousedown', (event) => event.preventDefault());
					button.addEventListener('click', (event) => {
						event.preventDefault();
						action();
					});
					controls.append(button);
					return button;
				};
				const select = () => {
					const position = getPos();
					if (typeof position !== 'number') return;
					editor.commands.setNodeSelection(position);
					return position;
				};
				button('Edit', () => {
					const position = select();
					if (position === undefined) return;
					editor.view.dom.dispatchEvent(
						new CustomEvent('cms-component-edit', {
							bubbles: true,
							detail: { name: node.type.name, position }
						})
					);
				});
				button('Select', () => {
					select();
					editor.view.focus();
				});
				// Node-view props and the transaction document can come from different
				// installed model versions. Read and rearrange only the live document's
				// own nodes/fragments; never pass a foreign Fragment into a transaction.
				const moveTarget = (direction: -1 | 1) => {
					const position = getPos();
					if (typeof position !== 'number' || position > editor.state.doc.content.size) return;
					const { state } = editor;
					const $pos = state.doc.resolve(position);
					const index = $pos.index();
					const current = $pos.nodeAfter;
					const siblingIndex = index + direction;
					const sibling = $pos.parent.maybeChild(siblingIndex);
					if (!current || current.type.name !== node.type.name || !sibling) return;
					const offset = $pos.parentOffset;
					const siblingOffset =
						direction < 0 ? offset - sibling.nodeSize : offset + current.nodeSize;
					const currentContent = $pos.parent.content.cut(offset, offset + current.nodeSize);
					const siblingContent = $pos.parent.content.cut(
						siblingOffset,
						siblingOffset + sibling.nodeSize
					);
					const replacement =
						direction < 0
							? currentContent.append(siblingContent)
							: siblingContent.append(currentContent);
					const first = Math.min(index, siblingIndex);
					if (!$pos.parent.canReplace(first, first + 2, replacement)) return;
					const start = direction < 0 ? position - sibling.nodeSize : position;
					return { start, current, sibling, replacement };
				};
				const move = (direction: -1 | 1) => {
					const target = moveTarget(direction);
					if (!target) return;
					const { start, current, sibling, replacement } = target;
					const { state, view } = editor;
					const tr = state.tr.replaceWith(
						start,
						start + current.nodeSize + sibling.nodeSize,
						replacement
					);
					tr.setSelection(
						NodeSelection.create(tr.doc, direction < 0 ? start : start + sibling.nodeSize)
					);
					view.dispatch(tr.scrollIntoView());
					view.focus();
				};
				const up = button('Move up', () => move(-1));
				const down = button('Move down', () => move(1));
				const refreshMoves = () => {
					up.disabled = !moveTarget(-1);
					down.disabled = !moveTarget(1);
				};
				refreshMoves();
				controls.addEventListener('focusin', refreshMoves);
				controls.addEventListener('pointerenter', refreshMoves);
				button('Duplicate', () => {
					const position = select();
					if (position === undefined) return;
					const current = editor.state.doc.nodeAt(position);
					if (!current) return;
					editor
						.chain()
						.insertContentAt(position + current.nodeSize, current.toJSON())
						.run();
				});
				button('Delete', () => {
					if (select() !== undefined) editor.commands.deleteSelection();
				});
				dom.append(controls, rendered.dom);
				if (node.isAtom && rendered.dom instanceof HTMLElement)
					rendered.dom.contentEditable = 'false';
				if (rendered.dom instanceof HTMLDetailsElement) rendered.dom.open = true;
				return {
					dom,
					contentDOM: rendered.contentDOM,
					update: (updatedNode) => {
						if (updatedNode.isAtom || !updatedNode.sameMarkup(node)) return false;
						node = updatedNode;
						refreshMoves();
						return true;
					},
					stopEvent: (event) =>
						controls.contains(event.target as globalThis.Node) || !!view?.stopEvent?.(event),
					ignoreMutation: (mutation) =>
						controls.contains(mutation.target) || (node.isAtom && mutation.type !== 'selection'),
					destroy: () => view?.destroy?.()
				};
			};
		}
	});
}

function profileCards(element: HTMLElement) {
	return normaliseProfileCards(
		Array.from(
			element.querySelectorAll<HTMLElement>(':scope > article[data-cms-profile="true"]')
		).map((card) => {
			const links = Array.from(
				card.querySelectorAll<HTMLAnchorElement>(
					':scope > [data-cms-profile-links="true"] > a[data-cms-profile-link="true"]'
				)
			).map((link) => ({ label: link.textContent || '', href: link.getAttribute('href') || '' }));
			const legacyLink = card.querySelector<HTMLAnchorElement>('a[href]');
			return {
				name: card.dataset.name,
				role: card.dataset.role,
				bio: card.dataset.bio,
				image: card.dataset.image,
				alt: card.dataset.alt,
				...(links.length ? { links } : {}),
				href: card.dataset.href || legacyLink?.getAttribute('href'),
				linkLabel: card.dataset.linkLabel || legacyLink?.textContent
			};
		})
	);
}

function logoItems(element: HTMLElement) {
	return normaliseLogoItems(
		Array.from(element.querySelectorAll<HTMLElement>(':scope > figure[data-cms-logo="true"]')).map(
			(logo) => ({
				name: logo.dataset.name,
				image: logo.dataset.image,
				alt: logo.dataset.alt,
				href: logo.dataset.href
			})
		)
	);
}

function projectFacts(element: HTMLElement) {
	return normaliseProjectFacts(
		Array.from(
			element.querySelectorAll<HTMLElement>(':scope > div[data-cms-project-fact="true"]')
		).map((fact) => ({ label: fact.dataset.label, value: fact.dataset.value }))
	);
}

function dataAttributes(values: Record<string, string>) {
	return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

function contentImage(element: HTMLElement) {
	const image = element.querySelector(':scope > img');
	const normalised = normaliseContentImage({
		src: image?.getAttribute('src'),
		alt: image?.getAttribute('alt'),
		caption: element.querySelector(':scope > figcaption')?.textContent || ''
	});
	return normalised ? { ...normalised, title: image?.getAttribute('title') || null } : null;
}

function actionAttrs(element: HTMLElement) {
	const links = Array.from(element.querySelectorAll('a[data-cms-action]'));
	const primary = links.find((link) => link.getAttribute('data-cms-action') === 'primary');
	const secondary = links.find((link) => link.getAttribute('data-cms-action') === 'secondary');
	const primaryHref = primary && safeContentUrl(primary.getAttribute('href') || '');
	const secondaryHref = secondary && safeContentUrl(secondary.getAttribute('href') || '');
	if (!primary?.textContent?.trim() || !primaryHref) return false;
	return {
		primaryLabel: primary.textContent.trim(),
		primaryHref,
		secondaryLabel: secondary?.textContent?.trim() || '',
		secondaryHref: secondaryHref || ''
	};
}

export const CmsCallout = Node.create({
	name: 'cmsCallout',
	group: 'block',
	content: 'block+',
	defining: true,
	addAttributes() {
		return { style: { default: 'info' } };
	},
	parseHTML() {
		return [
			{
				tag: 'aside[data-cms-callout]',
				getAttrs: (element) => {
					const style = (element as HTMLElement).getAttribute('data-cms-callout');
					return isCalloutStyle(style) ? { style } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ['aside', { 'data-cms-callout': HTMLAttributes.style }, 0];
	}
});

export const CmsActions = Node.create({
	name: 'cmsActions',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return {
			primaryLabel: { default: '' },
			primaryHref: { default: '' },
			secondaryLabel: { default: '' },
			secondaryHref: { default: '' }
		};
	},
	parseHTML() {
		return [
			{
				tag: 'div[data-cms-actions="true"]',
				getAttrs: (element) => actionAttrs(element as HTMLElement)
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		const { primaryLabel, primaryHref, secondaryLabel, secondaryHref } = HTMLAttributes;
		return [
			'div',
			{ 'data-cms-actions': 'true' },
			['a', { href: primaryHref, 'data-cms-action': 'primary' }, primaryLabel],
			...(secondaryLabel && secondaryHref
				? [['a', { href: secondaryHref, 'data-cms-action': 'secondary' }, secondaryLabel]]
				: [])
		];
	},
	addNodeView() {
		return ({ node }) => {
			const dom = document.createElement('div');
			dom.className = 'cms-editor-actions';
			dom.contentEditable = 'false';
			dom.dataset.cmsActions = 'true';
			dom.textContent = `Action links · ${node.attrs.primaryLabel}${node.attrs.secondaryLabel ? ` / ${node.attrs.secondaryLabel}` : ''}`;
			dom.addEventListener('click', (event) => event.preventDefault());
			return { dom };
		};
	}
});

export const ContentImageFigure = Node.create({
	name: 'contentImageFigure',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return {
			src: { default: '' },
			alt: { default: '' },
			title: { default: null },
			caption: { default: '' }
		};
	},
	parseHTML() {
		return [
			{
				tag: 'figure[data-content-image="true"]',
				getAttrs: (element) => contentImage(element as HTMLElement) || false
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		const image = normaliseContentImage(HTMLAttributes);
		if (!image) return ['figure', { 'data-content-image': 'invalid' }];
		return [
			'figure',
			{ 'data-content-image': 'true' },
			[
				'img',
				{
					src: image.src,
					alt: image.alt,
					...(HTMLAttributes.title ? { title: HTMLAttributes.title } : {})
				}
			],
			...(image.caption ? [['figcaption', {}, image.caption]] : [])
		];
	}
});

export const CmsColumn = Node.create({
	name: 'cmsColumn',
	content: 'block+',
	defining: true,
	parseHTML() {
		return [{ tag: 'div[data-cms-column="true"]' }];
	},
	renderHTML() {
		return ['div', { 'data-cms-column': 'true' }, 0];
	}
});

export const CmsColumns = Node.create({
	name: 'cmsColumns',
	group: 'block',
	content: 'cmsColumn{2,4}',
	defining: true,
	isolating: true,
	addAttributes() {
		return { count: { default: 2 } };
	},
	parseHTML() {
		return [
			{
				tag: 'section[data-cms-columns]',
				getAttrs: (element) => {
					const container = element as HTMLElement;
					const count = Number(container.getAttribute('data-cms-columns'));
					return isCmsColumnCount(count) && container.children.length === count ? { count } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ['section', { 'data-cms-columns': HTMLAttributes.count }, 0];
	},
	addKeyboardShortcuts() {
		return {
			Escape: () =>
				this.editor.commands.command(({ state, tr, dispatch }) => {
					for (let depth = state.selection.$from.depth; depth > 0; depth--) {
						if (state.selection.$from.node(depth).type.name !== 'cmsColumns') continue;
						const insertAt = state.selection.$from.after(depth);
						if (dispatch) {
							const paragraph = tr.doc.type.schema.nodes.paragraph.create();
							dispatch(
								tr
									.insert(insertAt, paragraph)
									.setSelection(TextSelection.create(tr.doc, insertAt + 1))
									.scrollIntoView()
							);
						}
						return true;
					}
					return false;
				})
		};
	}
});

export const CmsProfileCards = Node.create({
	name: 'cmsProfileCards',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return { items: { default: [] as ProfileCard[] } };
	},
	parseHTML() {
		return [
			{
				tag: 'section[data-cms-profiles="true"]',
				getAttrs: (element) => {
					const items = profileCards(element as HTMLElement);
					return items.length ? { items } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		const items = normaliseProfileCards(HTMLAttributes.items);
		return [
			'section',
			{ 'data-cms-profiles': 'true' },
			...items.map((item) => [
				'article',
				dataAttributes({
					'data-cms-profile': 'true',
					'data-name': item.name,
					'data-role': item.role,
					'data-bio': item.bio,
					'data-image': item.image,
					'data-alt': item.alt
				}),
				...(item.image ? [['img', { src: item.image, alt: item.alt }]] : []),
				[
					'div',
					{},
					['h3', {}, item.name],
					...(item.role ? [['p', {}, item.role]] : []),
					...(item.bio ? [['p', {}, item.bio]] : [])
				],
				...(item.links.length
					? [
							[
								'div',
								{ 'data-cms-profile-links': 'true' },
								...item.links.map((link) => [
									'a',
									{ href: link.href, 'data-cms-profile-link': 'true' },
									link.label
								])
							]
						]
					: [])
			])
		];
	}
});

export const CmsLogoGrid = Node.create({
	name: 'cmsLogoGrid',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return { items: { default: [] as LogoItem[] } };
	},
	parseHTML() {
		return [
			{
				tag: 'div[data-cms-logo-grid="true"]',
				getAttrs: (element) => {
					const items = logoItems(element as HTMLElement);
					return items.length ? { items } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		const items = normaliseLogoItems(HTMLAttributes.items);
		return [
			'div',
			{ 'data-cms-logo-grid': 'true' },
			...items.map((item) => [
				'figure',
				dataAttributes({
					'data-cms-logo': 'true',
					'data-name': item.name,
					'data-image': item.image,
					'data-alt': item.alt,
					'data-href': item.href
				}),
				...(item.href
					? [['a', { href: item.href }, ['img', { src: item.image, alt: item.alt || item.name }]]]
					: [['img', { src: item.image, alt: item.alt || item.name }]]),
				['figcaption', {}, item.name]
			])
		];
	}
});

export const CmsProjectFacts = Node.create({
	name: 'cmsProjectFacts',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return { items: { default: [] as ProjectFact[] } };
	},
	parseHTML() {
		return [
			{
				tag: 'dl[data-cms-project-facts="true"]',
				getAttrs: (element) => {
					const items = projectFacts(element as HTMLElement);
					return items.length ? { items } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		const items = normaliseProjectFacts(HTMLAttributes.items);
		return [
			'dl',
			{ 'data-cms-project-facts': 'true' },
			...items.map((item) => [
				'div',
				{ 'data-cms-project-fact': 'true', 'data-label': item.label, 'data-value': item.value },
				['dt', {}, item.label],
				['dd', {}, item.value]
			])
		];
	}
});

export const CmsEditionGrid = Node.create({
	name: 'cmsEditionGrid',
	group: 'block',
	atom: true,
	selectable: true,
	addOptions() {
		return { editionTitle: (id: string) => id };
	},
	addAttributes() {
		return { ids: { default: '' } };
	},
	parseHTML() {
		return [
			{
				tag: 'div[data-cms-editions]',
				getAttrs: (element) => {
					const ids = serialiseEditionIds(
						parseEditionIds((element as HTMLElement).getAttribute('data-cms-editions') || '')
					);
					return ids ? { ids } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-cms-editions': HTMLAttributes.ids }];
	},
	addNodeView() {
		return ({ node }) => {
			const ids = parseEditionIds(node.attrs.ids);
			const dom = document.createElement('div');
			dom.className = 'cms-editor-edition-grid';
			dom.contentEditable = 'false';
			dom.dataset.cmsEditions = node.attrs.ids;
			const title = document.createElement('strong');
			title.textContent = `Edition grid · ${ids.length}`;
			const editions = document.createElement('span');
			editions.textContent = ids.map((id) => this.options.editionTitle(id)).join(' · ');
			dom.append(title, editions);
			return { dom };
		};
	}
});

export const CmsOpenCalls = Node.create({
	name: 'cmsOpenCalls',
	group: 'block',
	atom: true,
	selectable: true,
	addOptions() {
		return { openCallTitle: (id: string) => id };
	},
	addAttributes() {
		return { ids: { default: '' } };
	},
	parseHTML() {
		return [
			{
				tag: 'div[data-cms-open-calls="true"][data-open-call-ids]',
				getAttrs: (element) => {
					const ids = serialiseOpenCallIds(
						parseOpenCallIds((element as HTMLElement).getAttribute('data-open-call-ids') || '')
					);
					return ids ? { ids } : false;
				}
			}
		];
	},
	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-cms-open-calls': 'true', 'data-open-call-ids': HTMLAttributes.ids }];
	},
	addNodeView() {
		return ({ node }) => {
			const ids = parseOpenCallIds(node.attrs.ids);
			const dom = document.createElement('div');
			dom.className = 'cms-editor-open-calls';
			dom.contentEditable = 'false';
			dom.dataset.cmsOpenCalls = 'true';
			dom.dataset.openCallIds = node.attrs.ids;
			const title = document.createElement('strong');
			title.textContent = `Open calls · ${ids.length}`;
			const calls = document.createElement('span');
			calls.textContent = ids.map((id) => this.options.openCallTitle(id)).join(' · ');
			dom.append(title, calls);
			return { dom };
		};
	}
});

export const CmsSummary = Node.create({
	name: 'cmsSummary',
	content: 'inline*',
	defining: true,
	parseHTML() {
		return [{ tag: 'summary' }];
	},
	renderHTML() {
		return ['summary', 0];
	}
});

export const CmsExpandable = Node.create({
	name: 'cmsExpandable',
	group: 'block',
	content: 'cmsSummary block+',
	defining: true,
	isolating: true,
	parseHTML() {
		return [{ tag: 'details[data-cms-expandable="true"]' }];
	},
	renderHTML() {
		return ['details', { 'data-cms-expandable': 'true' }, 0];
	},
	addNodeView() {
		return () => {
			const dom = document.createElement('details');
			dom.open = true;
			dom.dataset.cmsExpandable = 'true';
			const contentDOM = document.createElement('div');
			contentDOM.className = 'cms-editor-expandable-content';
			dom.append(contentDOM);
			return { dom, contentDOM };
		};
	},
	addKeyboardShortcuts() {
		return {
			Escape: () =>
				this.editor.commands.command(({ state, tr, dispatch }) => {
					for (let depth = state.selection.$from.depth; depth > 0; depth--) {
						if (state.selection.$from.node(depth).type.name !== 'cmsExpandable') continue;
						const insertAt = state.selection.$from.after(depth);
						if (dispatch) {
							const paragraph = tr.doc.type.schema.nodes.paragraph.create();
							dispatch(
								tr
									.insert(insertAt, paragraph)
									.setSelection(TextSelection.create(tr.doc, insertAt + 1))
									.scrollIntoView()
							);
						}
						return true;
					}
					return false;
				})
		};
	}
});

export function calloutContent(style: CalloutStyle) {
	return {
		type: 'cmsCallout',
		attrs: { style },
		content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout text' }] }]
	};
}

export function expandableContent() {
	return {
		type: 'cmsExpandable',
		content: [
			{ type: 'cmsSummary', content: [{ type: 'text', text: 'Section title' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Section content' }] }
		]
	};
}

export function columnsContent(count: CmsColumnCount) {
	return {
		type: 'cmsColumns',
		attrs: { count },
		content: Array.from({ length: count }, (_, index) => ({
			type: 'cmsColumn',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: `Column ${index + 1}` }]
				}
			]
		}))
	};
}

export function profileCardsContent(items: ProfileCard[]) {
	return { type: 'cmsProfileCards', attrs: { items: normaliseProfileCards(items) } };
}

export function logoGridContent(items: LogoItem[]) {
	return { type: 'cmsLogoGrid', attrs: { items: normaliseLogoItems(items) } };
}

export function projectFactsContent(items: ProjectFact[]) {
	return { type: 'cmsProjectFacts', attrs: { items: normaliseProjectFacts(items) } };
}

export function contentImageFigure(image: ContentImage) {
	return { type: 'contentImageFigure', attrs: normaliseContentImage(image) };
}
