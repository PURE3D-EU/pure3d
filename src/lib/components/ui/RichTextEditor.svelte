<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import MediaImageField from './MediaImageField.svelte';
	import { NodeSelection, TextSelection } from '@tiptap/pm/state';
	import StarterKit from '@tiptap/starter-kit';
	import Link from '@tiptap/extension-link';
	import Image from '@tiptap/extension-image';
	import { Table } from '@tiptap/extension-table';
	import TableRow from '@tiptap/extension-table-row';
	import TableCell from '@tiptap/extension-table-cell';
	import TableHeader from '@tiptap/extension-table-header';
	import Underline from '@tiptap/extension-underline';
	import Placeholder from '@tiptap/extension-placeholder';
	import { VideoEmbed, embedUrl } from '$lib/utils/editor-embed';
	import {
		withComponentControls,
		CmsActions,
		CmsCallout,
		CmsColumn,
		CmsColumns,
		ContentImageFigure,
		CmsEditionGrid,
		CmsExpandable,
		CmsLogoGrid,
		CmsOpenCalls,
		CmsProfileCards,
		CmsProjectFacts,
		CmsSummary,
		calloutContent,
		columnsContent,
		expandableContent,
		logoGridContent,
		profileCardsContent,
		projectFactsContent
	} from '$lib/utils/editor-content-components';
	import {
		calloutStyles,
		isCmsColumnCount,
		maxEditionReferences,
		maxLogoItems,
		maxOpenCallReferences,
		maxProfileCards,
		maxProfileLinks,
		maxProjectFacts,
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
		type LogoItem,
		type ProfileCard,
		type ProjectFact
	} from '$lib/utils/content-components';
	import ArrowDownIcon from '~icons/lucide/arrow-down';
	import ArrowUpIcon from '~icons/lucide/arrow-up';
	import BoldIcon from '~icons/lucide/bold';
	import BookOpenCheckIcon from '~icons/lucide/book-open-check';
	import ChevronDownIcon from '~icons/lucide/chevron-down';
	import Columns2Icon from '~icons/lucide/columns-2';
	import Columns3Icon from '~icons/lucide/columns-3';
	import Columns4Icon from '~icons/lucide/columns-4';
	import ExternalLinkIcon from '~icons/lucide/external-link';
	import GalleryThumbnailsIcon from '~icons/lucide/gallery-thumbnails';
	import Heading1Icon from '~icons/lucide/heading-1';
	import Heading2Icon from '~icons/lucide/heading-2';
	import Heading3Icon from '~icons/lucide/heading-3';
	import ImageIcon from '~icons/lucide/image';
	import InfoIcon from '~icons/lucide/info';
	import ItalicIcon from '~icons/lucide/italic';
	import LayoutGridIcon from '~icons/lucide/layout-grid';
	import LinkIcon from '~icons/lucide/link';
	import ListIcon from '~icons/lucide/list';
	import ListChecksIcon from '~icons/lucide/list-checks';
	import ListOrderedIcon from '~icons/lucide/list-ordered';
	import MegaphoneIcon from '~icons/lucide/megaphone';
	import PanelTopOpenIcon from '~icons/lucide/panel-top-open';
	import PencilIcon from '~icons/lucide/pencil';
	import PlusIcon from '~icons/lucide/plus';
	import QuoteIcon from '~icons/lucide/quote';
	import SeparatorHorizontalIcon from '~icons/lucide/separator-horizontal';
	import TableIcon from '~icons/lucide/table-2';
	import TrashIcon from '~icons/lucide/trash-2';
	import UnderlineIcon from '~icons/lucide/underline';
	import UsersRoundIcon from '~icons/lucide/users-round';
	import VideoIcon from '~icons/lucide/video';

	interface Props {
		content?: string;
		placeholder?: string;
		minHeight?: string;
		enableImagePaste?: boolean;
		uploadImage?: (file: File) => Promise<string>;
		onchange?: (html: string) => void;
		cmsComponents?: boolean;
		cmsEditions?: { id: string; title: string }[];
		cmsOpenCalls?: { id: string; title: string }[];
		cmsOpenCallsEnabled?: boolean;
	}

	let {
		content = '',
		placeholder = 'Start writing...',
		minHeight = '200px',
		enableImagePaste = false,
		uploadImage,
		onchange,
		cmsComponents = false,
		cmsEditions = [],
		cmsOpenCalls = [],
		cmsOpenCallsEnabled = true
	}: Props = $props();

	let element: HTMLDivElement;
	let editor: Editor | null = $state(null);
	let transactionVersion = $state(0);
	function isActive(name: string, attrs?: Record<string, unknown>) {
		void transactionVersion;
		return editor?.isActive(name, attrs) ?? false;
	}
	function attributes(name: string) {
		void transactionVersion;
		return editor?.getAttributes(name) || {};
	}
	function canHistory(action: 'undo' | 'redo') {
		void transactionVersion;
		return editor?.can()[action]() ?? false;
	}
	let isUploadingImage = $state(false);
	let editionPickerOpen = $state(false);
	let editionSearch = $state<HTMLInputElement>();
	let openCallSearch = $state<HTMLInputElement>();
	let editionQuery = $state('');
	let editionIds = $state<string[]>([]);
	let editionLimitReached = $state(false);
	let openCallPickerOpen = $state(false);
	let openCallQuery = $state('');
	let openCallIds = $state<string[]>([]);
	let openCallLimitReached = $state(false);
	let insertMenu = $state<HTMLDetailsElement>();
	let insertMenuSummary = $state<HTMLElement>();
	type ComponentEditorKind =
		| 'profiles'
		| 'logos'
		| 'facts'
		| 'image'
		| 'actions'
		| 'callout'
		| 'columns'
		| 'expandable';
	let componentDialog = $state<HTMLDialogElement>();
	let componentEditorKind = $state<ComponentEditorKind>();
	let componentEditorError = $state('');
	let componentEditorTarget = $state<{ name: string; position: number }>();
	let draftProfiles = $state<ProfileCard[]>([]);
	let draftLogos = $state<LogoItem[]>([]);
	let draftFacts = $state<ProjectFact[]>([]);
	let draftImage = $state<ContentImage>({ src: '', alt: '', caption: '' });
	let draftImageTitle = $state('');
	let draftActions = $state({
		primaryLabel: '',
		primaryHref: '',
		secondaryLabel: '',
		secondaryHref: ''
	});
	let draftStyle = $state<CalloutStyle>('info');
	let draftColumnCount = $state(2);
	let draftSummary = $state('');
	let mediaBusy = $state(false);
	type EditorDocument = Editor['state']['doc'];
	let dialogDocument: EditorDocument | undefined;
	let transferBlocks = $state<{ position: number; label: string; items: ProfileCard[] }[]>([]);
	let profileDestinations = $state<number[]>([]);
	let recordTarget: { name: string; position: number } | undefined;
	let recordDocument: EditorDocument | undefined;
	let pickerError = $state('');
	function saveRecords(name: string, ids: string) {
		if (!editor) return false;
		if (recordDocument !== editor.state.doc) {
			pickerError = 'Content changed. Cancel and reopen the picker before saving.';
			return false;
		}
		return editor.commands.command(({ state, tr, dispatch }) => {
			if (recordTarget) {
				const node = state.doc.nodeAt(recordTarget.position);
				if (node?.type.name !== name) return false;
				tr.setNodeMarkup(recordTarget.position, undefined, { ...node.attrs, ids });
			} else tr.replaceSelectionWith(state.doc.type.schema.nodes[name].create({ ids }));
			if (dispatch) dispatch(tr.scrollIntoView());
			return true;
		});
	}
	let matchingEditions = $derived(
		cmsEditions.filter(
			(edition) =>
				edition.title.toLowerCase().includes(editionQuery.toLowerCase()) &&
				!editionIds.includes(edition.id)
		)
	);
	let matchingOpenCalls = $derived(
		cmsOpenCalls.filter(
			(call) =>
				call.title.toLowerCase().includes(openCallQuery.toLowerCase()) &&
				!openCallIds.includes(call.id)
		)
	);

	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit.configure({ link: false, underline: false }),
				Underline,
				Link.configure({ openOnClick: false }),
				withComponentControls(Image),
				withComponentControls(ContentImageFigure),
				VideoEmbed,
				Table.configure({ resizable: true }),
				TableRow,
				TableCell,
				TableHeader,
				Placeholder.configure({ placeholder }),
				...[
					withComponentControls(CmsCallout),
					withComponentControls(CmsActions),
					CmsColumn,
					withComponentControls(CmsColumns),
					withComponentControls(
						CmsEditionGrid.configure({
							editionTitle: (id: string) =>
								cmsEditions.find((edition) => edition.id === id)?.title || id
						})
					),
					withComponentControls(
						CmsOpenCalls.configure({
							openCallTitle: (id: string) =>
								cmsOpenCalls.find((call) => call.id === id)?.title || id
						})
					),
					CmsSummary,
					withComponentControls(CmsExpandable),
					withComponentControls(CmsProfileCards),
					withComponentControls(CmsLogoGrid),
					withComponentControls(CmsProjectFacts)
				]
			],
			content,
			editorProps: {
				handleClick: (_view, _position, event) => {
					if ((event.target as HTMLElement).closest('a')) {
						event.preventDefault();
						return true;
					}
					return false;
				}
			},
			onTransaction: () => {
				transactionVersion++;
			},
			onUpdate: ({ editor: e }) => {
				onchange?.(e.getHTML());
			}
		});
		element.addEventListener('cms-component-edit', handleComponentEdit);
	});

	// Update editor content when the content prop changes externally
	$effect(() => {
		// Toolbar transactions must not reapply a stale parent prop or erase redo history.
		const incoming = content;
		untrack(() => {
			if (editor && incoming !== editor.getHTML()) {
				editor.commands.setContent(incoming, { emitUpdate: false });
			}
		});
	});

	onDestroy(() => {
		element?.removeEventListener('cms-component-edit', handleComponentEdit);
		editor?.destroy();
	});

	function handleComponentEdit(event: Event) {
		const { name } = (event as CustomEvent<{ name: string }>).detail;
		const kinds: Record<string, ComponentEditorKind> = {
			cmsProfileCards: 'profiles',
			cmsLogoGrid: 'logos',
			cmsProjectFacts: 'facts',
			contentImageFigure: 'image',
			image: 'image',
			cmsActions: 'actions',
			cmsCallout: 'callout',
			cmsColumns: 'columns',
			cmsExpandable: 'expandable'
		};
		if (name === 'cmsEditionGrid') editEditionGrid();
		else if (name === 'cmsOpenCalls') editOpenCalls();
		else if (kinds[name]) openComponentEditor(kinds[name]);
	}

	function setLink() {
		if (!editor) return;
		const previousUrl = editor.getAttributes('link').href;
		const url = window.prompt('URL', previousUrl);
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}

	function addImage() {
		openComponentEditor('image');
	}
	function addVideo() {
		const value = window.prompt('YouTube, Vimeo or SoundCloud player URL');
		if (!value) return;
		const src = embedUrl(value);
		if (!src) {
			window.alert('Enter a valid HTTPS YouTube, Vimeo or SoundCloud player link.');
			return;
		}
		editor
			?.chain()
			.focus()
			.insertContent({ type: 'videoEmbed', attrs: { src, title: 'Embedded video' } })
			.run();
	}

	function setCallout(style: CalloutStyle) {
		if (!editor) return;
		const target = selectedNode('cmsCallout') || activeNode('cmsCallout');
		if (target)
			editor.commands.command(({ tr, dispatch }) => {
				if (dispatch)
					dispatch(tr.setNodeMarkup(target.position, undefined, { ...target.node.attrs, style }));
				return true;
			});
		else editor.chain().focus().insertContent(calloutContent(style)).run();
	}

	function closeInsertMenu() {
		insertMenu?.removeAttribute('open');
	}

	function handleInsertMenuKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !insertMenu?.open) return;
		event.preventDefault();
		event.stopPropagation();
		closeInsertMenu();
		insertMenuSummary?.focus();
	}

	function insertCallout() {
		setCallout('info');
		closeInsertMenu();
	}

	function activeNode(name: string) {
		if (!editor) return null;
		const from = editor.state.doc.resolve(editor.state.selection.from);
		for (let depth = from.depth; depth > 0; depth--) {
			if (from.node(depth).type.name === name)
				return {
					node: from.node(depth),
					position: from.before(depth)
				};
		}
		return null;
	}

	function setColumns(value: number) {
		if (!editor || !isCmsColumnCount(value)) return;
		const active = selectedNode('cmsColumns') || activeNode('cmsColumns');
		if (!active) editor.chain().focus().insertContent(columnsContent(value)).run();
		else {
			const schema = editor.state.doc.type.schema;
			const columnType = schema.nodes.cmsColumn;
			const columns = Array.from({ length: value }, (_, index) => {
				const content = Array.from(active.node.maybeChild(index)?.content.content || []);
				if (index === value - 1)
					for (let extra = value; extra < active.node.childCount; extra++)
						content.push(...active.node.child(extra).content.content);
				if (!content.length) content.push(schema.nodes.paragraph.create());
				return columnType.create(null, content);
			});
			const replacement = schema.nodes.cmsColumns.create({ count: value }, columns);
			editor.commands.command(({ tr, dispatch }) => {
				if (dispatch)
					dispatch(
						tr
							.replaceWith(active.position, active.position + active.node.nodeSize, replacement)
							.setSelection(TextSelection.near(tr.doc.resolve(active.position + 1)))
							.scrollIntoView()
					);
				return true;
			});
		}
		closeInsertMenu();
	}

	function selectedNode(name: string) {
		if (!editor || !(editor.state.selection instanceof NodeSelection)) return null;
		const node = editor.state.doc.nodeAt(editor.state.selection.from);
		return node?.type.name === name ? { node, position: editor.state.selection.from } : null;
	}

	function openComponentEditor(kind: ComponentEditorKind) {
		if (!editor) return;
		const names = {
			profiles: 'cmsProfileCards',
			logos: 'cmsLogoGrid',
			facts: 'cmsProjectFacts',
			image: 'contentImageFigure',
			actions: 'cmsActions',
			callout: 'cmsCallout',
			columns: 'cmsColumns',
			expandable: 'cmsExpandable'
		} as const;
		const selected = selectedNode(names[kind]);
		componentEditorTarget = selected
			? { name: names[kind], position: selected.position }
			: undefined;
		componentEditorError = '';
		dialogDocument = editor.state.doc;
		mediaBusy = false;
		if (kind === 'actions')
			draftActions = {
				primaryLabel: 'Learn more',
				primaryHref: '',
				secondaryLabel: '',
				secondaryHref: '',
				...selected?.node.attrs
			};
		if (kind === 'callout') draftStyle = selected?.node.attrs.style || 'info';
		if (kind === 'columns') draftColumnCount = selected?.node.childCount || 2;
		if (kind === 'expandable') draftSummary = selected?.node.firstChild?.textContent || '';
		if (kind === 'profiles') {
			const items = normaliseProfileCards(selected?.node.attrs.items || []);
			draftProfiles = items.length
				? items
				: [{ name: '', role: '', bio: '', image: '', alt: '', links: [] }];
			profileDestinations = draftProfiles.map(() => -1);
			transferBlocks = [];
			let heading = '';
			editor.state.doc.descendants((node, position) => {
				if (node.type.name === 'heading') heading = node.textContent;
				if (node.type.name === 'cmsProfileCards' && position !== selected?.position)
					transferBlocks.push({
						position,
						label: `${heading || 'Profile cards'} · ${node.attrs.items.map((item: ProfileCard) => item.name).join(', ')}`,
						items: normaliseProfileCards(node.attrs.items)
					});
			});
		}
		if (kind === 'logos') {
			const items = normaliseLogoItems(selected?.node.attrs.items || []);
			draftLogos = items.length ? items : [{ name: '', image: '', alt: '', href: '' }];
		}
		if (kind === 'facts') {
			const items = normaliseProjectFacts(selected?.node.attrs.items || []);
			draftFacts = items.length ? items : [{ label: '', value: '' }];
		}
		if (kind === 'image') {
			const legacyImage = selectedNode('image');
			draftImageTitle = selected?.node.attrs.title || legacyImage?.node.attrs.title || '';
			componentEditorTarget = legacyImage
				? { name: 'image', position: legacyImage.position }
				: componentEditorTarget;
			draftImage = normaliseContentImage(selected?.node.attrs || legacyImage?.node.attrs || {}) || {
				src: '',
				alt: '',
				caption: ''
			};
		}
		componentEditorKind = kind;
		componentDialog?.showModal();
		closeInsertMenu();
	}

	function closeComponentEditor() {
		componentDialog?.close();
	}

	function addComponentItem(kind: 'profiles' | 'logos' | 'facts') {
		if (kind === 'profiles') profileDestinations = [...profileDestinations, -1];
		if (kind === 'profiles')
			draftProfiles = [
				...draftProfiles,
				{ name: '', role: '', bio: '', image: '', alt: '', links: [] }
			];
		if (kind === 'logos') draftLogos = [...draftLogos, { name: '', image: '', alt: '', href: '' }];
		if (kind === 'facts') draftFacts = [...draftFacts, { label: '', value: '' }];
	}

	function moveComponentItem(
		kind: 'profiles' | 'logos' | 'facts',
		index: number,
		direction: -1 | 1
	) {
		const move = <T,>(items: T[]) => {
			const next = [...items];
			const target = index + direction;
			if (target < 0 || target >= next.length) return next;
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		};
		if (kind === 'profiles') {
			draftProfiles = move(draftProfiles);
			profileDestinations = move(profileDestinations);
		}
		if (kind === 'logos') draftLogos = move(draftLogos);
		if (kind === 'facts') draftFacts = move(draftFacts);
	}

	function removeComponentItem(kind: 'profiles' | 'logos' | 'facts', index: number) {
		if (kind === 'profiles')
			profileDestinations = profileDestinations.filter((_, itemIndex) => itemIndex !== index);
		if (kind === 'profiles')
			draftProfiles = draftProfiles.filter((_, itemIndex) => itemIndex !== index);
		if (kind === 'logos') draftLogos = draftLogos.filter((_, itemIndex) => itemIndex !== index);
		if (kind === 'facts') draftFacts = draftFacts.filter((_, itemIndex) => itemIndex !== index);
	}

	function addProfileLink(index: number) {
		draftProfiles = draftProfiles.map((profile, profileIndex) =>
			profileIndex === index && profile.links.length < maxProfileLinks
				? { ...profile, links: [...profile.links, { label: '', href: '' }] }
				: profile
		);
	}

	function moveProfileLink(profileIndex: number, linkIndex: number, direction: -1 | 1) {
		draftProfiles = draftProfiles.map((profile, index) => {
			if (index !== profileIndex) return profile;
			const target = linkIndex + direction;
			if (target < 0 || target >= profile.links.length) return profile;
			const links = [...profile.links];
			[links[linkIndex], links[target]] = [links[target], links[linkIndex]];
			return { ...profile, links };
		});
	}

	function removeProfileLink(profileIndex: number, linkIndex: number) {
		draftProfiles = draftProfiles.map((profile, index) =>
			index === profileIndex
				? { ...profile, links: profile.links.filter((_, itemIndex) => itemIndex !== linkIndex) }
				: profile
		);
	}

	function saveComponentEditor() {
		if (!editor || !componentEditorKind) return;
		if (mediaBusy) return;
		if (dialogDocument !== editor.state.doc) {
			componentEditorError =
				'Content changed while this dialog was open. Cancel and reopen it before saving.';
			return;
		}
		const component = componentEditorKind;
		const emptyList =
			component === 'profiles'
				? !draftProfiles.length
				: component === 'logos'
					? !draftLogos.length
					: component === 'facts'
						? !draftFacts.length
						: false;
		if (emptyList && componentEditorTarget) {
			editor.commands.setNodeSelection(componentEditorTarget.position);
			editor.commands.deleteSelection();
			closeComponentEditor();
			return;
		}
		if (component === 'image' && !draftImage.src.trim() && componentEditorTarget) {
			const target = componentEditorTarget;
			editor.commands.command(({ state, tr, dispatch }) => {
				const node = state.doc.nodeAt(target.position);
				if (node?.type.name !== target.name) return false;
				if (dispatch)
					dispatch(
						tr.replaceWith(
							target.position,
							target.position + node.nodeSize,
							state.doc.type.schema.nodes.paragraph.create()
						)
					);
				return true;
			});
			closeComponentEditor();
			return;
		}
		if (['actions', 'callout', 'columns', 'expandable'].includes(component)) {
			const target = componentEditorTarget;
			if (component === 'actions') {
				const primaryHref = safeContentUrl(draftActions.primaryHref);
				const secondaryHref = draftActions.secondaryHref
					? safeContentUrl(draftActions.secondaryHref)
					: '';
				if (
					!draftActions.primaryLabel.trim() ||
					!primaryHref ||
					(draftActions.secondaryLabel.trim() ? !secondaryHref : !!draftActions.secondaryHref)
				) {
					componentEditorError =
						'Enter a primary label and safe destination. Complete both secondary fields or leave both empty.';
					return;
				}
				const attrs = {
					...draftActions,
					primaryLabel: draftActions.primaryLabel.trim(),
					secondaryLabel: draftActions.secondaryLabel.trim(),
					primaryHref,
					secondaryHref
				};
				if (target) editor.commands.updateAttributes('cmsActions', attrs);
				else editor.commands.insertContent({ type: 'cmsActions', attrs });
			} else if (component === 'callout') setCallout(draftStyle);
			else if (component === 'columns') setColumns(draftColumnCount);
			else if (target) {
				if (!draftSummary.trim()) {
					componentEditorError = 'Enter a section title.';
					return;
				}
				const summary = editor.state.doc.nodeAt(target.position)?.firstChild;
				if (summary && draftSummary !== summary.textContent)
					editor.commands.command(({ tr, dispatch }) => {
						const start = target.position + 1;
						const replacement = summary.type.create(
							summary.attrs,
							tr.doc.type.schema.text(draftSummary),
							summary.marks
						);
						if (dispatch) dispatch(tr.replaceWith(start, start + summary.nodeSize, replacement));
						return true;
					});
			}
			closeComponentEditor();
			return;
		}
		const normalised =
			component === 'profiles'
				? normaliseProfileCards(draftProfiles)
				: component === 'logos'
					? normaliseLogoItems(draftLogos)
					: component === 'facts'
						? normaliseProjectFacts(draftFacts)
						: normaliseContentImage(draftImage);
		const expected =
			component === 'profiles'
				? draftProfiles.length
				: component === 'logos'
					? draftLogos.length
					: component === 'facts'
						? draftFacts.length
						: 1;
		if (
			!normalised ||
			(Array.isArray(normalised) && (!normalised.length || normalised.length !== expected))
		) {
			componentEditorError = 'Complete all required fields with safe, valid URLs before saving.';
			return;
		}
		const content =
			component === 'profiles'
				? profileCardsContent(normalised as ProfileCard[])
				: component === 'logos'
					? logoGridContent(normalised as LogoItem[])
					: component === 'facts'
						? projectFactsContent(normalised as ProjectFact[])
						: {
								type: 'contentImageFigure',
								attrs: { ...(normalised as ContentImage), title: draftImageTitle || null }
							};
		if (component === 'profiles' && profileDestinations.some((position) => position !== -1)) {
			const profiles = normalised as ProfileCard[];
			const transfers = transferBlocks
				.map((block) => ({
					...block,
					items: [
						...normaliseProfileCards(block.items),
						...profiles.filter((_, index) => profileDestinations[index] === block.position)
					]
				}))
				.filter((block) =>
					profiles.some((_, index) => profileDestinations[index] === block.position)
				);
			if (transfers.some((block) => block.items.length > maxProfileCards)) {
				componentEditorError = `A destination can contain at most ${maxProfileCards} profiles. No changes have been saved.`;
				return;
			}
			editor.commands.command(({ tr, dispatch, state }) => {
				// Attribute updates do not shift positions; remove the source only afterwards.
				for (const block of transfers) {
					const node = state.doc.nodeAt(block.position)!;
					tr.setNodeMarkup(block.position, undefined, { ...node.attrs, items: block.items });
				}
				const remaining = profiles.filter((_, index) => profileDestinations[index] === -1);
				const target = componentEditorTarget;
				if (target) {
					const node = state.doc.nodeAt(target.position)!;
					if (remaining.length)
						tr.setNodeMarkup(target.position, undefined, { ...node.attrs, items: remaining });
					else
						tr.replaceWith(
							target.position,
							target.position + node.nodeSize,
							state.doc.type.schema.nodes.paragraph.create()
						);
				} else if (remaining.length)
					tr.replaceSelectionWith(
						state.doc.type.schema.nodeFromJSON(profileCardsContent(remaining))
					);
				if (dispatch) dispatch(tr.scrollIntoView());
				return true;
			});
			closeComponentEditor();
			return;
		}
		editor.commands.command(({ state, tr, dispatch }) => {
			const target = componentEditorTarget;
			if (target && state.doc.nodeAt(target.position)?.type.name === target.name) {
				const node = state.doc.nodeAt(target.position)!;
				if (target.name === 'image')
					if (draftImage.caption)
						tr.replaceWith(
							target.position,
							target.position + node.nodeSize,
							state.doc.type.schema.nodeFromJSON({
								...content,
								attrs: { ...content.attrs, title: draftImageTitle || null }
							})
						);
					else
						tr.setNodeMarkup(target.position, undefined, {
							...node.attrs,
							src: draftImage.src,
							alt: draftImage.alt,
							title: draftImageTitle || null
						});
				else
					tr.setNodeMarkup(target.position, undefined, {
						...node.attrs,
						...(content.attrs || {}),
						...(component === 'image' ? { title: draftImageTitle || null } : {})
					});
			} else tr.replaceSelectionWith(state.doc.type.schema.nodeFromJSON(content));
			if (dispatch) dispatch(tr.scrollIntoView());
			return true;
		});
		closeComponentEditor();
	}

	function setActions() {
		openComponentEditor('actions');
	}

	async function editEditionGrid() {
		if (!editor) return;
		const selected = selectedNode('cmsEditionGrid');
		recordDocument = editor.state.doc;
		recordTarget = selected ? { name: 'cmsEditionGrid', position: selected.position } : undefined;
		pickerError = '';
		openCallPickerOpen = false;
		editionIds = editor.isActive('cmsEditionGrid')
			? parseEditionIds(editor.getAttributes('cmsEditionGrid').ids || '')
			: [];
		editionQuery = '';
		editionLimitReached = false;
		editionPickerOpen = true;
		closeInsertMenu();
		await tick();
		editionSearch?.focus();
	}

	function addEdition(id: string) {
		if (editionIds.includes(id)) return;
		if (editionIds.length >= maxEditionReferences) {
			editionLimitReached = true;
			return;
		}
		editionIds = [...editionIds, id];
	}

	function saveEditionGrid() {
		if (!editor || editionIds.length === 0) return;
		let attrs: { ids: string };
		try {
			attrs = { ids: serialiseEditionIds(editionIds) };
		} catch (error) {
			editionLimitReached = error instanceof Error;
			return;
		}
		if (saveRecords('cmsEditionGrid', attrs.ids)) editionPickerOpen = false;
	}

	async function editOpenCalls() {
		if (!editor) return;
		const selected = selectedNode('cmsOpenCalls');
		recordDocument = editor.state.doc;
		recordTarget = selected ? { name: 'cmsOpenCalls', position: selected.position } : undefined;
		pickerError = '';
		editionPickerOpen = false;
		openCallIds = editor.isActive('cmsOpenCalls')
			? parseOpenCallIds(editor.getAttributes('cmsOpenCalls').ids || '')
			: [];
		openCallQuery = '';
		openCallLimitReached = false;
		openCallPickerOpen = true;
		closeInsertMenu();
		await tick();
		openCallSearch?.focus();
	}

	function addOpenCall(id: string) {
		if (openCallIds.includes(id)) return;
		if (openCallIds.length >= maxOpenCallReferences) {
			openCallLimitReached = true;
			return;
		}
		openCallIds = [...openCallIds, id];
	}

	function saveOpenCalls() {
		if (!editor || openCallIds.length === 0) return;
		let attrs: { ids: string };
		try {
			attrs = { ids: serialiseOpenCallIds(openCallIds) };
		} catch (error) {
			openCallLimitReached = error instanceof Error;
			return;
		}
		if (saveRecords('cmsOpenCalls', attrs.ids)) openCallPickerOpen = false;
	}

	async function handlePaste(event: ClipboardEvent) {
		if (!enableImagePaste || !uploadImage || !editor) return;
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
			file.type.startsWith('image/')
		);
		if (files.length === 0) return;

		event.preventDefault();
		isUploadingImage = true;
		try {
			for (const file of files) {
				const url = await uploadImage(file);
				editor
					.chain()
					.focus()
					.setImage({ src: url, alt: file.name || 'Pasted image' })
					.run();
			}
		} finally {
			isUploadingImage = false;
		}
	}
</script>

<svelte:window onkeydown={handleInsertMenuKeydown} />

<div id="rich-text-editor" class="rounded-box border border-base-300 bg-base-100">
	<!-- Toolbar -->
	<div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
		<div class="toolbar-group" role="group" aria-label="Edit history">
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				disabled={!canHistory('undo')}
				onclick={() => editor?.chain().focus().undo().run()}>Undo</button
			>
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				disabled={!canHistory('redo')}
				onclick={() => editor?.chain().focus().redo().run()}>Redo</button
			>
		</div>
		<div class="toolbar-group" role="group" aria-label="Text style">
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('bold')}
				aria-label="Bold"
				aria-pressed={isActive('bold')}
				title="Bold"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleBold().run()}><BoldIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('italic')}
				aria-label="Italic"
				aria-pressed={isActive('italic')}
				title="Italic"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleItalic().run()}><ItalicIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('underline')}
				aria-label="Underline"
				aria-pressed={isActive('underline')}
				title="Underline"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineIcon /></button
			>
		</div>
		<span class="toolbar-divider" aria-hidden="true"></span>
		<div class="toolbar-group" role="group" aria-label="Headings">
			{#each [1, 2, 3] as level (level)}
				<button
					type="button"
					class="toolbar-button"
					class:is-active={isActive('heading', { level })}
					aria-label={`Heading ${level}`}
					aria-pressed={isActive('heading', { level })}
					title={`Heading ${level}`}
					disabled={!editor}
					onclick={() =>
						editor
							?.chain()
							.focus()
							.toggleHeading({ level: level as 1 | 2 | 3 })
							.run()}
				>
					{#if level === 1}<Heading1Icon />{:else if level === 2}<Heading2Icon
						/>{:else}<Heading3Icon />{/if}
				</button>
			{/each}
		</div>
		<span class="toolbar-divider" aria-hidden="true"></span>
		<div class="toolbar-group" role="group" aria-label="Lists and quote">
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('bulletList')}
				aria-label="Bulleted list"
				aria-pressed={isActive('bulletList')}
				title="Bulleted list"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}><ListIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('orderedList')}
				aria-label="Numbered list"
				aria-pressed={isActive('orderedList')}
				title="Numbered list"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}
				><ListOrderedIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('blockquote')}
				aria-label="Block quote"
				aria-pressed={isActive('blockquote')}
				title="Block quote"
				disabled={!editor}
				onclick={() => editor?.chain().focus().toggleBlockquote().run()}><QuoteIcon /></button
			>
		</div>
		<span class="toolbar-divider" aria-hidden="true"></span>
		<div class="toolbar-group" role="group" aria-label="Insert content">
			<button
				type="button"
				class="toolbar-button"
				class:is-active={isActive('link')}
				aria-label="Add or edit link"
				aria-pressed={isActive('link')}
				title="Add or edit link"
				disabled={!editor}
				onclick={setLink}><LinkIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				aria-label="Add image"
				title="Add image"
				disabled={!editor}
				onclick={addImage}><ImageIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				aria-label="Embed video"
				title="Embed video"
				disabled={!editor}
				onclick={addVideo}><VideoIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				aria-label="Insert table"
				title="Insert table"
				disabled={!editor}
				onclick={() =>
					editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
				><TableIcon /></button
			>
			<button
				type="button"
				class="toolbar-button"
				aria-label="Insert divider"
				title="Insert divider"
				disabled={!editor}
				onclick={() => editor?.chain().focus().setHorizontalRule().run()}
				><SeparatorHorizontalIcon /></button
			>
		</div>
		{#if cmsComponents}
			<span class="toolbar-divider" aria-hidden="true"></span>
			<div class="cms-toolbar-group">
				<details bind:this={insertMenu} class="dropdown relative">
					<summary
						bind:this={insertMenuSummary}
						class="toolbar-button toolbar-menu-button"
						aria-label="Insert component"
						title="Insert component"><PlusIcon /><ChevronDownIcon class="chevron" /></summary
					>
					<div class="component-menu dropdown-content">
						<div class="column-options" role="group" aria-label="Insert columns">
							<span class="column-options-label" aria-hidden="true">Columns</span>
							<button
								type="button"
								aria-label="Two columns"
								title="Two columns"
								onclick={() => setColumns(2)}><Columns2Icon /><span>2</span></button
							>
							<button
								type="button"
								aria-label="Three columns"
								title="Three columns"
								onclick={() => setColumns(3)}><Columns3Icon /><span>3</span></button
							>
							<button
								type="button"
								aria-label="Four columns"
								title="Four columns"
								onclick={() => setColumns(4)}><Columns4Icon /><span>4</span></button
							>
						</div>
						<button type="button" onclick={insertCallout}><InfoIcon /><span>Callout</span></button>
						<button type="button" onclick={() => openComponentEditor('profiles')}
							><UsersRoundIcon /><span>Profile cards</span></button
						>
						<button type="button" onclick={() => openComponentEditor('logos')}
							><GalleryThumbnailsIcon /><span>Logo grid</span></button
						>
						<button type="button" onclick={() => openComponentEditor('facts')}
							><ListChecksIcon /><span>Project facts</span></button
						>
						<button
							type="button"
							onclick={() => {
								setActions();
								closeInsertMenu();
							}}><ExternalLinkIcon /><span>Action links</span></button
						>
						<button type="button" onclick={editEditionGrid}
							><BookOpenCheckIcon /><span>Edition grid</span></button
						>
						{#if cmsOpenCallsEnabled}<button type="button" onclick={editOpenCalls}
								><MegaphoneIcon /><span>Open calls</span></button
							>{/if}
						<button
							type="button"
							onclick={() => {
								editor?.chain().focus().insertContent(expandableContent()).run();
								closeInsertMenu();
							}}><PanelTopOpenIcon /><span>Expandable section</span></button
						>
					</div>
				</details>
				{#if isActive('cmsCallout')}
					<label class="callout-style" title="Callout style"
						><span class="sr-only">Callout style</span><InfoIcon /><select
							value={attributes('cmsCallout').style}
							onchange={(event) => setCallout(event.currentTarget.value as CalloutStyle)}
							>{#each calloutStyles as style (style)}<option value={style}>{style}</option
								>{/each}</select
						></label
					>
				{/if}
				{#if isActive('cmsActions')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit action links"
						title="Edit action links"
						onclick={setActions}><PencilIcon /></button
					>
				{/if}
				{#if isActive('cmsEditionGrid')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit edition grid"
						title="Edit edition grid"
						onclick={editEditionGrid}><LayoutGridIcon /></button
					>
				{/if}
				{#if isActive('cmsOpenCalls')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit open calls"
						title="Edit open calls"
						onclick={editOpenCalls}><MegaphoneIcon /></button
					>
				{/if}
				{#if isActive('cmsColumns')}
					<label class="callout-style" title="Column count"
						><span class="sr-only">Column count</span><LayoutGridIcon /><select
							value={attributes('cmsColumns').count}
							onchange={(event) => setColumns(Number(event.currentTarget.value))}
							><option value="2">2 columns</option><option value="3">3 columns</option><option
								value="4">4 columns</option
							></select
						></label
					>
				{/if}
				{#if isActive('cmsProfileCards')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit profile cards"
						title="Edit profile cards"
						onclick={() => openComponentEditor('profiles')}><PencilIcon /></button
					>
				{/if}
				{#if isActive('cmsLogoGrid')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit logo grid"
						title="Edit logo grid"
						onclick={() => openComponentEditor('logos')}><PencilIcon /></button
					>
				{/if}
				{#if isActive('cmsProjectFacts')}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit project facts"
						title="Edit project facts"
						onclick={() => openComponentEditor('facts')}><PencilIcon /></button
					>
				{/if}
			</div>
		{/if}
	</div>
	{#if editionPickerOpen}
		<div class="space-y-3 border-b border-base-300 p-3">
			<p class="text-sm">
				Source: explicitly selected published edition records, displayed in the order below.
			</p>
			{#if pickerError}<p role="alert" class="text-error">{pickerError}</p>{/if}
			<label class="block text-sm font-medium"
				>Choose published editions<input
					class="input mt-1 w-full"
					type="search"
					placeholder="Search editions…"
					bind:this={editionSearch}
					bind:value={editionQuery}
				/></label
			>
			{#if editionIds.length}
				<ul class="space-y-2" aria-label="Selected editions">
					{#each editionIds as id, index (id)}
						{@const edition = cmsEditions.find((item) => item.id === id)}
						<li class="flex items-center gap-2 text-sm">
							<span class="min-w-0 flex-1 truncate"
								>{edition?.title || 'Unavailable edition'} · {id}</span
							>
							<button
								type="button"
								class="picker-icon-button"
								aria-label={`Move ${edition?.title || id} up`}
								title="Move up"
								disabled={index === 0}
								onclick={() =>
									(editionIds = editionIds.map((value, position) =>
										position === index - 1
											? editionIds[index]
											: position === index
												? editionIds[index - 1]
												: value
									))}><ArrowUpIcon /></button
							>
							<button
								type="button"
								class="picker-icon-button"
								aria-label={`Move ${edition?.title || id} down`}
								title="Move down"
								disabled={index === editionIds.length - 1}
								onclick={() =>
									(editionIds = editionIds.map((value, position) =>
										position === index + 1
											? editionIds[index]
											: position === index
												? editionIds[index + 1]
												: value
									))}><ArrowDownIcon /></button
							>
							<button
								type="button"
								class="picker-icon-button danger"
								aria-label={`Remove ${edition?.title || id}`}
								title="Remove"
								onclick={() => (editionIds = editionIds.filter((value) => value !== id))}
								><TrashIcon /></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="text-xs opacity-60">Up to {maxEditionReferences} published editions.</p>
			{#if editionLimitReached}<p role="alert" class="text-sm text-error">
					Remove an edition before adding another.
				</p>{/if}
			<div class="max-h-40 overflow-y-auto rounded border border-base-300">
				{#each matchingEditions as edition (edition.id)}
					<button
						type="button"
						class="block min-h-11 w-full px-3 text-left text-sm hover:bg-base-200"
						onclick={() => addEdition(edition.id)}>{edition.title} · {edition.id}</button
					>
				{/each}
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm btn-primary"
					disabled={!editionIds.length}
					onclick={saveEditionGrid}>Save edition grid</button
				>
				<button type="button" class="btn btn-sm" onclick={() => (editionPickerOpen = false)}
					>Cancel</button
				>
			</div>
		</div>
	{/if}
	{#if openCallPickerOpen}
		<div class="space-y-3 border-b border-base-300 p-3">
			<p class="text-sm">
				Source: explicitly selected published open call records, displayed in the order below.
			</p>
			{#if pickerError}<p role="alert" class="text-error">{pickerError}</p>{/if}
			<label class="block text-sm font-medium"
				>Choose published open calls<input
					class="input mt-1 w-full"
					type="search"
					placeholder="Search open calls…"
					bind:this={openCallSearch}
					bind:value={openCallQuery}
				/></label
			>
			{#if openCallIds.length}
				<ul class="space-y-2" aria-label="Selected open calls">
					{#each openCallIds as id, index (id)}
						{@const call = cmsOpenCalls.find((item) => item.id === id)}
						<li class="flex items-center gap-2 text-sm">
							<span class="min-w-0 flex-1 truncate"
								>{call?.title || 'Unavailable open call'} · {id}</span
							>
							<button
								type="button"
								class="picker-icon-button"
								aria-label={`Move ${call?.title || id} up`}
								title="Move up"
								disabled={index === 0}
								onclick={() =>
									(openCallIds = openCallIds.map((value, position) =>
										position === index - 1
											? openCallIds[index]
											: position === index
												? openCallIds[index - 1]
												: value
									))}><ArrowUpIcon /></button
							>
							<button
								type="button"
								class="picker-icon-button"
								aria-label={`Move ${call?.title || id} down`}
								title="Move down"
								disabled={index === openCallIds.length - 1}
								onclick={() =>
									(openCallIds = openCallIds.map((value, position) =>
										position === index + 1
											? openCallIds[index]
											: position === index
												? openCallIds[index + 1]
												: value
									))}><ArrowDownIcon /></button
							>
							<button
								type="button"
								class="picker-icon-button danger"
								aria-label={`Remove ${call?.title || id}`}
								title="Remove"
								onclick={() => (openCallIds = openCallIds.filter((value) => value !== id))}
								><TrashIcon /></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="text-xs opacity-60">Up to {maxOpenCallReferences} published open calls.</p>
			{#if openCallLimitReached}<p role="alert" class="text-sm text-error">
					Remove an open call before adding another.
				</p>{/if}
			<div class="max-h-40 overflow-y-auto rounded border border-base-300">
				{#each matchingOpenCalls as call (call.id)}
					<button
						type="button"
						class="block min-h-11 w-full px-3 text-left text-sm hover:bg-base-200"
						onclick={() => addOpenCall(call.id)}>{call.title} · {call.id}</button
					>
				{/each}
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm btn-primary"
					disabled={!openCallIds.length}
					onclick={saveOpenCalls}>Save open calls</button
				>
				<button type="button" class="btn btn-sm" onclick={() => (openCallPickerOpen = false)}
					>Cancel</button
				>
			</div>
		</div>
	{/if}
	<dialog
		bind:this={componentDialog}
		class="modal"
		aria-labelledby="content-component-editor-title"
		onkeydown={(event) => {
			event.stopPropagation();
		}}
		onclose={() => {
			componentEditorKind = undefined;
			componentEditorError = '';
			componentEditorTarget = undefined;
		}}
	>
		<div class="modal-box max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto">
			<h2 id="content-component-editor-title" class="text-lg font-semibold">
				{componentEditorKind === 'profiles'
					? 'Edit profile cards'
					: componentEditorKind === 'logos'
						? 'Edit logo grid'
						: componentEditorKind === 'facts'
							? 'Edit project facts'
							: componentEditorKind === 'actions'
								? 'Edit action links'
								: componentEditorKind === 'callout'
									? 'Edit callout'
									: componentEditorKind === 'columns'
										? 'Edit columns'
										: componentEditorKind === 'expandable'
											? 'Edit expandable section'
											: 'Edit image'}
			</h2>
			<p class="mt-1 text-sm opacity-70">
				Save applies this component to your draft. Use Save changes on the page to persist it.
			</p>
			{#if componentEditorKind === 'profiles'}
				<div class="component-form-list">
					{#each draftProfiles as profile, index (index)}
						<fieldset class="component-form-card" disabled={mediaBusy}>
							<legend>Profile {index + 1}</legend>
							<div class="component-form-actions">
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === 0}
									onclick={() => moveComponentItem('profiles', index, -1)}>Move up</button
								>
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === draftProfiles.length - 1}
									onclick={() => moveComponentItem('profiles', index, 1)}>Move down</button
								>
								<button
									type="button"
									class="btn text-error btn-ghost btn-xs"
									onclick={() => removeComponentItem('profiles', index)}>Remove</button
								>
							</div>
							{#if transferBlocks.length}<label
									>Move to profile block<select
										class="select w-full"
										bind:value={profileDestinations[index]}
										><option value={-1}>Keep in this block</option
										>{#each transferBlocks as block (block.position)}<option value={block.position}
												>{block.label}</option
											>{/each}</select
									></label
								>{/if}
							<label
								>Name<input
									class="input-bordered input w-full"
									maxlength="120"
									required
									bind:value={profile.name}
								/></label
							>
							<label
								>Role or affiliation<input
									class="input-bordered input w-full"
									maxlength="120"
									bind:value={profile.role}
								/></label
							>
							<label
								>Biography<textarea
									class="textarea-bordered textarea w-full"
									maxlength="500"
									bind:value={profile.bio}
								></textarea></label
							>
							<MediaImageField
								bind:src={profile.image}
								bind:alt={profile.alt}
								{uploadImage}
								libraryEnabled={cmsComponents}
								bind:busy={mediaBusy}
							/>
							<fieldset class="component-link-list">
								<legend>Links</legend>
								{#each profile.links as link, linkIndex (linkIndex)}
									<div class="component-link-row">
										<label
											>Label<input
												class="input-bordered input w-full"
												maxlength="80"
												required
												bind:value={link.label}
											/></label
										>
										<label
											>Destination<input
												class="input-bordered input w-full"
												type="text"
												inputmode="url"
												maxlength="2048"
												required
												bind:value={link.href}
											/></label
										>
										<div class="component-form-actions">
											<button
												type="button"
												class="btn btn-ghost btn-xs"
												disabled={linkIndex === 0}
												onclick={() => moveProfileLink(index, linkIndex, -1)}>Move up</button
											>
											<button
												type="button"
												class="btn btn-ghost btn-xs"
												disabled={linkIndex === profile.links.length - 1}
												onclick={() => moveProfileLink(index, linkIndex, 1)}>Move down</button
											>
											<button
												type="button"
												class="btn text-error btn-ghost btn-xs"
												onclick={() => removeProfileLink(index, linkIndex)}>Remove</button
											>
										</div>
									</div>
								{/each}
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									disabled={profile.links.length >= maxProfileLinks}
									onclick={() => addProfileLink(index)}>Add link</button
								>
							</fieldset>
						</fieldset>
					{/each}
				</div>
				<button
					type="button"
					class="btn mt-3 btn-sm"
					disabled={mediaBusy || draftProfiles.length >= maxProfileCards}
					onclick={() => addComponentItem('profiles')}>Add profile</button
				>
			{:else if componentEditorKind === 'logos'}
				<div class="component-form-list">
					{#each draftLogos as logo, index (index)}
						<fieldset class="component-form-card" disabled={mediaBusy}>
							<legend>Logo {index + 1}</legend>
							<div class="component-form-actions">
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === 0}
									onclick={() => moveComponentItem('logos', index, -1)}>Move up</button
								>
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === draftLogos.length - 1}
									onclick={() => moveComponentItem('logos', index, 1)}>Move down</button
								>
								<button
									type="button"
									class="btn text-error btn-ghost btn-xs"
									onclick={() => removeComponentItem('logos', index)}>Remove</button
								>
							</div>
							<label
								>Name<input
									class="input-bordered input w-full"
									maxlength="120"
									required
									bind:value={logo.name}
								/></label
							>
							<MediaImageField
								bind:src={logo.image}
								bind:alt={logo.alt}
								{uploadImage}
								libraryEnabled={cmsComponents}
								bind:busy={mediaBusy}
							/>
							<label
								>Link<input
									class="input-bordered input w-full"
									type="text"
									inputmode="url"
									maxlength="2048"
									bind:value={logo.href}
								/></label
							>
						</fieldset>
					{/each}
				</div>
				<button
					type="button"
					class="btn mt-3 btn-sm"
					disabled={mediaBusy || draftLogos.length >= maxLogoItems}
					onclick={() => addComponentItem('logos')}>Add logo</button
				>
			{:else if componentEditorKind === 'facts'}
				<div class="component-form-list">
					{#each draftFacts as fact, index (index)}
						<fieldset class="component-form-card">
							<legend>Fact {index + 1}</legend>
							<div class="component-form-actions">
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === 0}
									onclick={() => moveComponentItem('facts', index, -1)}>Move up</button
								>
								<button
									type="button"
									class="btn btn-ghost btn-xs"
									disabled={index === draftFacts.length - 1}
									onclick={() => moveComponentItem('facts', index, 1)}>Move down</button
								>
								<button
									type="button"
									class="btn text-error btn-ghost btn-xs"
									onclick={() => removeComponentItem('facts', index)}>Remove</button
								>
							</div>
							<label
								>Label<input
									class="input-bordered input w-full"
									maxlength="120"
									required
									bind:value={fact.label}
								/></label
							>
							<label
								>Value<textarea
									class="textarea-bordered textarea w-full"
									maxlength="500"
									required
									bind:value={fact.value}
								></textarea></label
							>
						</fieldset>
					{/each}
				</div>
				<button
					type="button"
					class="btn mt-3 btn-sm"
					disabled={draftFacts.length >= maxProjectFacts}
					onclick={() => addComponentItem('facts')}>Add fact</button
				>
			{:else if componentEditorKind === 'image'}
				<div class="component-form-list">
					<label
						>Image title<input
							class="input w-full"
							maxlength="240"
							bind:value={draftImageTitle}
						/></label
					>
					<MediaImageField
						bind:src={draftImage.src}
						bind:alt={draftImage.alt}
						{uploadImage}
						libraryEnabled={cmsComponents}
						bind:busy={mediaBusy}
					/>
					{#if !draftImage.src && componentEditorTarget}<p class="text-sm">
							Save to remove this image from the document, or Cancel to keep it.
						</p>{/if}
					<label
						>Caption<textarea
							class="textarea-bordered textarea w-full"
							maxlength="500"
							bind:value={draftImage.caption}
						></textarea></label
					>
				</div>
			{:else if componentEditorKind === 'actions'}
				<div class="component-form-list">
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="btn btn-sm"
							disabled={!draftActions.secondaryLabel}
							onclick={() => {
								draftActions = {
									primaryLabel: draftActions.secondaryLabel,
									primaryHref: draftActions.secondaryHref,
									secondaryLabel: draftActions.primaryLabel,
									secondaryHref: draftActions.primaryHref
								};
							}}>Swap action order</button
						>
						<button
							type="button"
							class="btn btn-sm"
							disabled={!draftActions.secondaryLabel && !draftActions.secondaryHref}
							onclick={() => {
								draftActions.secondaryLabel = '';
								draftActions.secondaryHref = '';
							}}>Remove secondary action</button
						>
					</div>
					<label
						>Primary action label<input
							class="input w-full"
							maxlength="120"
							bind:value={draftActions.primaryLabel}
						/></label
					>
					<label
						>Primary action destination<input
							class="input w-full"
							maxlength="2048"
							bind:value={draftActions.primaryHref}
						/></label
					>
					<label
						>Secondary action label (optional)<input
							class="input w-full"
							maxlength="120"
							bind:value={draftActions.secondaryLabel}
						/></label
					>
					<label
						>Secondary action destination (optional)<input
							class="input w-full"
							maxlength="2048"
							bind:value={draftActions.secondaryHref}
						/></label
					>
				</div>
			{:else if componentEditorKind === 'callout'}
				<label class="mt-3 block"
					>Callout style<select class="select w-full" bind:value={draftStyle}
						>{#each calloutStyles as style (style)}<option value={style}>{style}</option
							>{/each}</select
					></label
				>
				<p class="mt-3 text-sm">Edit the callout text directly in the document.</p>
			{:else if componentEditorKind === 'columns'}
				<label class="mt-3 block"
					>Column count<select class="select w-full" bind:value={draftColumnCount}
						><option value={2}>2 columns</option><option value={3}>3 columns</option><option
							value={4}>4 columns</option
						></select
					></label
				>
				<p class="mt-3 text-sm">
					Edit text and nested components directly in each column. Reducing the count moves content
					into the final column without deleting it.
				</p>
			{:else if componentEditorKind === 'expandable'}
				<label class="mt-3 block"
					>Section title<input class="input w-full" bind:value={draftSummary} /></label
				>
				<p class="mt-3 text-sm">Edit the section content directly in the document.</p>
			{/if}
			{#if componentEditorError}<p class="mt-3 text-sm text-error" role="alert">
					{componentEditorError}
				</p>{/if}
			<div class="modal-action">
				<button type="button" class="btn" onclick={closeComponentEditor}>Cancel</button>
				<button
					type="button"
					class="btn btn-primary"
					disabled={mediaBusy}
					onclick={saveComponentEditor}>Save</button
				>
			</div>
		</div>
	</dialog>

	<!-- Editor content -->
	<div class="relative">
		{#if isUploadingImage}
			<div
				class="absolute top-2 right-2 z-10 inline-flex items-center gap-2 rounded bg-base-100 px-3 py-1 text-xs shadow"
			>
				<span class="loading loading-xs loading-spinner"></span>
				Uploading image...
			</div>
		{/if}
		<div
			bind:this={element}
			inert={editionPickerOpen || openCallPickerOpen}
			class="editor-wrapper prose prose-sm max-w-none p-4 focus-within:outline-none"
			style:--editor-min-h={minHeight}
			onpaste={handlePaste}
		></div>
	</div>
</div>

<style>
	.editor-wrapper :global(.cms-component-node) {
		min-width: 0;
		margin: 1rem 0;
		padding: 0.5rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	.editor-wrapper :global(.cms-component-node.ProseMirror-selectednode) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.editor-wrapper :global(.cms-component-controls) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
		padding: 0.25rem;
		border-radius: 0.375rem;
		background: var(--color-base-200);
		font-size: 0.75rem;
	}
	.editor-wrapper :global(.cms-component-controls strong) {
		margin-right: auto;
		padding: 0.25rem;
	}
	.editor-wrapper :global(.cms-component-controls button) {
		min-height: 2rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-base-300);
		border-radius: 0.375rem;
		background: var(--color-base-100);
		color: var(--color-base-content);
		cursor: pointer;
	}
	.editor-wrapper :global(.cms-component-controls button:hover:not(:disabled)) {
		background: var(--color-base-300);
	}
	.editor-wrapper :global(.cms-component-controls button:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.editor-wrapper :global(.cms-component-controls button:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.editor-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem;
		border-bottom: 1px solid var(--color-base-300);
		background: var(--color-base-200);
	}
	.toolbar-group,
	.cms-toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}
	.toolbar-button,
	.picker-icon-button {
		display: inline-flex;
		width: 2rem;
		height: 2rem;
		flex: 0 0 2rem;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		color: color-mix(in oklch, var(--color-base-content) 78%, transparent);
		transition:
			background-color 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
	}
	.toolbar-button:hover:not(:disabled),
	.picker-icon-button:hover:not(:disabled) {
		border-color: var(--color-base-300);
		background: var(--color-base-100);
		color: var(--color-base-content);
	}
	.toolbar-button.is-active {
		border-color: color-mix(in oklch, var(--color-primary) 30%, transparent);
		background: color-mix(in oklch, var(--color-primary) 14%, var(--color-base-100));
		color: var(--color-primary);
	}
	.toolbar-button:focus-visible,
	.picker-icon-button:focus-visible,
	.component-menu button:focus-visible,
	.callout-style select:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.toolbar-button:disabled,
	.picker-icon-button:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}
	.toolbar-button :global(svg),
	.picker-icon-button :global(svg),
	.callout-style :global(svg),
	.component-menu :global(svg) {
		width: 1rem;
		height: 1rem;
		stroke-width: 1.8;
	}
	.toolbar-divider {
		width: 1px;
		height: 1.25rem;
		margin: 0 0.125rem;
		background: var(--color-base-300);
	}
	.toolbar-menu-button {
		width: 2.5rem;
		flex-basis: 2.5rem;
		gap: 0.125rem;
		list-style: none;
		cursor: pointer;
	}
	.toolbar-menu-button::-webkit-details-marker {
		display: none;
	}
	.toolbar-menu-button :global(.chevron) {
		width: 0.75rem;
		height: 0.75rem;
		transition: transform 120ms ease;
	}
	details[open] .toolbar-menu-button :global(.chevron) {
		transform: rotate(180deg);
	}
	.component-menu {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.375rem);
		right: 0;
		display: grid;
		width: 14rem;
		max-width: calc(100vw - 2rem);
		gap: 0.25rem;
		padding: 0.375rem;
		border: 1px solid var(--color-base-300);
		border-radius: 0.625rem;
		background: var(--color-base-100);
		box-shadow: 0 12px 30px color-mix(in oklch, var(--color-base-content) 14%, transparent);
	}
	.component-menu button {
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		text-align: left;
		font-size: 0.875rem;
	}
	.component-menu button:hover {
		background: var(--color-base-200);
	}
	.column-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		padding: 0.25rem 0;
	}
	.column-options-label {
		grid-column: 1 / -1;
		padding: 0 0.625rem;
		color: color-mix(in oklch, var(--color-base-content) 65%, transparent);
		font-size: 0.75rem;
	}
	.component-menu .column-options button {
		justify-content: center;
		gap: 0.375rem;
		padding-inline: 0.25rem;
		background: var(--color-base-200);
	}
	.component-menu .column-options button:hover {
		background: var(--color-base-300);
	}
	.callout-style {
		display: flex;
		height: 2rem;
		align-items: center;
		gap: 0.25rem;
		padding-left: 0.5rem;
		border: 1px solid var(--color-base-300);
		border-radius: 0.375rem;
		background: var(--color-base-100);
	}
	.callout-style select {
		height: 100%;
		padding: 0 1.5rem 0 0.25rem;
		border: 0;
		background: transparent;
		font-size: 0.75rem;
		text-transform: capitalize;
	}
	.picker-icon-button {
		border-color: var(--color-base-300);
		background: var(--color-base-100);
	}
	.picker-icon-button.danger {
		color: var(--color-error);
	}
	@media (max-width: 40rem) {
		.cms-toolbar-group {
			width: 100%;
		}
		.component-menu {
			position: fixed;
			top: auto;
			bottom: 1rem;
			left: 1rem;
			right: auto;
			width: calc(100vw - 2rem);
		}
	}
	.editor-wrapper :global(iframe) {
		width: 100%;
		aspect-ratio: 16/9;
		border: 0;
	}
	.editor-wrapper :global(.tiptap) {
		min-height: var(--editor-min-h, 200px);
		outline: none;
	}
	.editor-wrapper :global([data-cms-callout]) {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border-left: 0.25rem solid var(--color-info);
		border-radius: var(--radius-box);
		background: color-mix(in oklch, var(--color-info) 10%, transparent);
	}
	.editor-wrapper :global([data-cms-callout='success']) {
		border-color: var(--color-success);
		background: color-mix(in oklch, var(--color-success) 10%, transparent);
	}
	.editor-wrapper :global([data-cms-callout='warning']) {
		border-color: var(--color-warning);
		background: color-mix(in oklch, var(--color-warning) 12%, transparent);
	}
	.editor-wrapper :global(.cms-editor-actions),
	.editor-wrapper :global(.cms-editor-edition-grid),
	.editor-wrapper :global(.cms-editor-open-calls) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px dashed var(--color-base-content);
		border-radius: var(--radius-box);
		background: var(--color-base-200);
		cursor: pointer;
	}
	.editor-wrapper :global(.cms-editor-actions) {
		background: var(--color-base-content);
		color: var(--color-base-100);
	}
	.editor-wrapper :global(.cms-editor-edition-grid span),
	.editor-wrapper :global(.cms-editor-open-calls span) {
		width: 100%;
		font-size: 0.875rem;
	}
	.editor-wrapper :global([data-cms-columns]) {
		display: grid;
		grid-template-columns: repeat(var(--cms-columns, 2), minmax(0, 1fr));
		gap: 1rem;
		margin: 1rem 0;
	}
	.editor-wrapper :global([data-cms-columns='2']) {
		--cms-columns: 2;
	}
	.editor-wrapper :global([data-cms-columns='3']) {
		--cms-columns: 3;
	}
	.editor-wrapper :global([data-cms-columns='4']) {
		--cms-columns: 4;
	}
	.editor-wrapper :global([data-cms-column]) {
		min-width: 0;
		padding: 0.75rem;
		border: 1px dashed var(--color-base-300);
		border-radius: var(--radius-box);
	}
	.editor-wrapper :global([data-cms-columns]:focus-within) {
		outline: 2px solid var(--color-primary);
		outline-offset: 0.25rem;
	}
	.editor-wrapper :global([data-cms-profiles]),
	.editor-wrapper :global([data-cms-logo-grid]),
	.editor-wrapper :global([data-cms-project-facts]) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.editor-wrapper :global([data-cms-profile]),
	.editor-wrapper :global([data-cms-logo]),
	.editor-wrapper :global([data-cms-project-fact]),
	.editor-wrapper :global(figure[data-content-image]) {
		min-width: 0;
		margin: 0;
		padding: 0.75rem;
		border: 1px dashed var(--color-base-300);
		border-radius: var(--radius-box);
		background: var(--color-base-200);
	}
	.editor-wrapper :global([data-cms-profile] > img) {
		width: 4rem;
		height: 4rem;
		margin: 0 0 0.75rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.editor-wrapper :global([data-cms-profile-links]) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.editor-wrapper :global([data-cms-profile-link]) {
		font-size: 0.875rem;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.editor-wrapper :global([data-cms-logo] img),
	.editor-wrapper :global(figure[data-content-image] img) {
		display: block;
		max-width: 100%;
		height: auto;
		margin: 0 auto;
	}
	.editor-wrapper :global([data-cms-logo] figcaption),
	.editor-wrapper :global(figure[data-content-image] figcaption) {
		margin-top: 0.5rem;
		font-size: 0.875rem;
	}
	.component-form-list {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}
	.component-form-card {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	.component-form-card legend {
		padding: 0 0.25rem;
		font-weight: 600;
	}
	.component-form-card label,
	.component-form-list > label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.component-form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.editor-wrapper :global(details[data-cms-expandable]) {
		margin: 1rem 0;
		padding: 0.75rem;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	.editor-wrapper :global(.cms-editor-expandable-content) {
		padding-top: 0.5rem;
	}
	@media (min-width: 40.0625rem) and (max-width: 64rem) {
		.editor-wrapper :global([data-cms-columns='3']),
		.editor-wrapper :global([data-cms-columns='4']) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 40rem) {
		.editor-wrapper :global([data-cms-columns]) {
			grid-template-columns: 1fr;
		}
	}
</style>
