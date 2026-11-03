const editionIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const pocketbaseIdPattern = /^[a-z0-9]{15}$/;
function attribute(tag, name) {
	const match = tag.match(new RegExp(`(?:^|\\s)${name}=(['"])(.*?)\\1`, 'i'));
	return match ? match[2] : null;
}
function hasUnsafeUrlCharacters(value) {
	return (
		/\s/.test(value) ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	);
}
function safeRelativeComponentUrl(value) {
	if (!/^\/(?![\\/])/.test(value) || value.length > 2048 || hasUnsafeUrlCharacters(value))
		return false;
	try {
		return /^\/(?![\\/])/.test(decodeURIComponent(value));
	} catch {
		return false;
	}
}
function safeComponentUrl(value) {
	if (typeof value !== 'string' || value.length > 2048 || hasUnsafeUrlCharacters(value))
		return false;
	if (safeRelativeComponentUrl(value)) return true;
	return safeHttpComponentUrl(value) || /^mailto:[^@\s]+@[^@\s]+$/i.test(value);
}
// PocketBase's JSVM does not expose the browser URL constructor.
function safeHttpComponentUrl(value) {
	return /^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]{1,5})?(?:[/?#][^\s]*)?$/i.test(
		value
	);
}
function safeComponentImageUrl(value) {
	if (typeof value !== 'string' || value.length > 2048 || hasUnsafeUrlCharacters(value))
		return false;
	return safeRelativeComponentUrl(value) || safeHttpComponentUrl(value);
}
function componentText(value, maxLength) {
	return (
		typeof value === 'string' && value.trim() && value.length <= maxLength && !/[<>]/.test(value)
	);
}
function validOpenCallIds(value) {
	if (typeof value !== 'string') return false;
	const ids = value.split(',');
	return (
		ids.length >= 1 &&
		ids.length <= 24 &&
		new Set(ids).size === ids.length &&
		ids.every((id) => pocketbaseIdPattern.test(id))
	);
}
function validateComponentHtml(html) {
	for (const match of html.matchAll(/\sdata-cms-[\w-]+=(['"])(.*?)\1/gi)) {
		if (/[<>]/.test(match[2])) return 'Invalid content component.';
	}
	for (const tag of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
		const [, tagName] = tag;
		const profile = tagName === 'article' && attribute(tag[0], 'data-cms-profile') === 'true';
		const logo = tagName === 'figure' && attribute(tag[0], 'data-cms-logo') === 'true';
		const fact = tagName === 'div' && attribute(tag[0], 'data-cms-project-fact') === 'true';
		const openCalls = tagName === 'div' && attribute(tag[0], 'data-cms-open-calls') === 'true';
		for (const match of tag[0].matchAll(
			/\s(data-(?:cms-[\w-]+|open-call-ids|name|role|bio|image|alt|href|link-label|label|value|content-image))=(['"])(.*?)\2/gi
		)) {
			const [, name, , value] = match;
			if (
				(name === 'data-cms-callout' &&
					tagName === 'aside' &&
					['info', 'success', 'warning'].includes(value)) ||
				(name === 'data-cms-actions' && tagName === 'div' && value === 'true') ||
				(name === 'data-cms-action' &&
					tagName === 'a' &&
					['primary', 'secondary'].includes(value)) ||
				(name === 'data-cms-expandable' && tagName === 'details' && value === 'true') ||
				(name === 'data-cms-editions' &&
					tagName === 'div' &&
					value.split(',').length <= 24 &&
					value.split(',').every((id) => editionIdPattern.test(id.trim()))) ||
				(name === 'data-cms-open-calls' && tagName === 'div' && value === 'true') ||
				(name === 'data-open-call-ids' && openCalls && validOpenCallIds(value)) ||
				(name === 'data-cms-columns' && tagName === 'section' && ['2', '3', '4'].includes(value)) ||
				(name === 'data-cms-column' && tagName === 'div' && value === 'true') ||
				(name === 'data-cms-profiles' && tagName === 'section' && value === 'true') ||
				(name === 'data-cms-profile' && tagName === 'article' && value === 'true') ||
				(name === 'data-cms-profile-links' && tagName === 'div' && value === 'true') ||
				(name === 'data-cms-profile-link' && tagName === 'a' && value === 'true') ||
				(name === 'data-cms-logo-grid' && tagName === 'div' && value === 'true') ||
				(name === 'data-cms-logo' && tagName === 'figure' && value === 'true') ||
				(name === 'data-cms-project-facts' && tagName === 'dl' && value === 'true') ||
				(name === 'data-cms-project-fact' && tagName === 'div' && value === 'true') ||
				(name === 'data-name' && (profile || logo) && componentText(value, 120)) ||
				(name === 'data-role' && profile && componentText(value, 120)) ||
				(name === 'data-bio' && profile && componentText(value, 500)) ||
				(name === 'data-image' && (profile || logo) && safeComponentImageUrl(value)) ||
				(name === 'data-alt' && (profile || logo) && componentText(value, 240)) ||
				(name === 'data-href' && (profile || logo) && safeComponentUrl(value)) ||
				(name === 'data-link-label' && profile && componentText(value, 80)) ||
				(name === 'data-label' && fact && componentText(value, 120)) ||
				(name === 'data-value' && fact && componentText(value, 500)) ||
				(name === 'data-content-image' && tagName === 'figure' && value === 'true')
			)
				continue;
			return 'Invalid content component.';
		}
	}
	let withoutOpenCalls = html;
	for (const tag of html.matchAll(/<div\b[^>]*\bdata-cms-open-calls=(['"])true\1[^>]*><\/div>/gi)) {
		const ids = attribute(tag[0], 'data-open-call-ids');
		if (!validOpenCallIds(ids)) return 'Invalid open calls component.';
		withoutOpenCalls = withoutOpenCalls.replace(tag[0], '');
	}
	if (/\bdata-cms-open-calls=|\bdata-open-call-ids=/i.test(withoutOpenCalls))
		return 'Invalid open calls component.';
	// Profile cards also use <section>; match the column layout's own closing tag,
	// not the first nested section's closing tag.
	const sections = [];
	for (const tag of html.matchAll(/<\/?section\b[^>]*>/gi)) {
		if (!/^<\//.test(tag[0])) {
			sections.push({
				count: attribute(tag[0], 'data-cms-columns'),
				start: tag.index + tag[0].length
			});
			continue;
		}
		const section = sections.pop();
		if (!section || section.count === null) continue;
		const contents = html.slice(section.start, tag.index);
		const columns = contents.match(/<div\b[^>]*\bdata-cms-column=(['"])true\1[^>]*>/gi) || [];
		if (columns.length !== Number(section.count) || /data-cms-columns/i.test(contents))
			return 'Invalid content component.';
	}
	if (sections.some((section) => section.count !== null)) return 'Invalid content component.';
	const containers = [
		['section', 'data-cms-profiles', 'article', 'data-cms-profile', 12],
		['div', 'data-cms-logo-grid', 'figure', 'data-cms-logo', 24],
		['dl', 'data-cms-project-facts', 'div', 'data-cms-project-fact', 16]
	];
	for (const [containerTag, containerAttribute, itemTag, itemAttribute, maximum] of containers) {
		const pattern = new RegExp(
			`<${containerTag}\\b[^>]*\\b${containerAttribute}=(['"])true\\1[^>]*>([\\s\\S]*?)<\\/${containerTag}>`,
			'gi'
		);
		let withoutContainers = html;
		for (const match of html.matchAll(pattern)) {
			const items =
				match[2].match(
					new RegExp(`<${itemTag}\\b[^>]*\\b${itemAttribute}=(['"])true\\1[^>]*>`, 'gi')
				) || [];
			if (!items.length || items.length > maximum) return 'Invalid content component.';
			withoutContainers = withoutContainers.replace(match[0], '');
		}
		if (new RegExp(`\\b${itemAttribute}=`, 'i').test(withoutContainers))
			return 'Invalid content component.';
	}
	for (const tag of html.matchAll(/<article\b[^>]*\bdata-cms-profile=(['"])true\1[^>]*>/gi)) {
		const value = tag[0];
		if (
			!componentText(attribute(value, 'data-name'), 120) ||
			(attribute(value, 'data-image') && !safeComponentImageUrl(attribute(value, 'data-image'))) ||
			(attribute(value, 'data-href') && !safeComponentUrl(attribute(value, 'data-href')))
		)
			return 'Invalid content component.';
	}
	let withoutProfiles = html;
	for (const profile of html.matchAll(
		/<article\b[^>]*\bdata-cms-profile=(['"])true\1[^>]*>([\s\S]*?)<\/article>/gi
	)) {
		let withoutLinkContainers = profile[2];
		for (const container of profile[2].matchAll(
			/<div\b[^>]*\bdata-cms-profile-links=(['"])true\1[^>]*>([\s\S]*?)<\/div>/gi
		)) {
			const links =
				container[2].match(/<a\b[^>]*\bdata-cms-profile-link=(['"])true\1[^>]*>/gi) || [];
			if (!links.length || links.length > 8) return 'Invalid content component.';
			withoutLinkContainers = withoutLinkContainers.replace(container[0], '');
		}
		if (/\bdata-cms-profile-link=|\bdata-cms-profile-links=/i.test(withoutLinkContainers))
			return 'Invalid content component.';
		withoutProfiles = withoutProfiles.replace(profile[0], '');
	}
	if (/\bdata-cms-profile-link=|\bdata-cms-profile-links=/i.test(withoutProfiles))
		return 'Invalid content component.';
	for (const tag of html.matchAll(
		/<a\b[^>]*\bdata-cms-profile-link=(['"])true\1[^>]*>([\s\S]*?)<\/a>/gi
	)) {
		const href = attribute(tag[0], 'href');
		if (!href || !safeComponentUrl(href) || !componentText(tag[2].replace(/<[^>]+>/g, ''), 80))
			return 'Invalid content component.';
	}
	for (const tag of html.matchAll(/<figure\b[^>]*\bdata-cms-logo=(['"])true\1[^>]*>/gi)) {
		const value = tag[0];
		if (
			!componentText(attribute(value, 'data-name'), 120) ||
			!safeComponentImageUrl(attribute(value, 'data-image') || '')
		)
			return 'Invalid content component.';
	}
	for (const figure of html.matchAll(
		/<figure\b[^>]*\bdata-content-image=(['"])true\1[^>]*>([\s\S]*?)<\/figure>/gi
	)) {
		const image = figure[2].match(/<img\b[^>]*>/i)?.[0];
		if (!image || !safeComponentImageUrl(attribute(image, 'src') || ''))
			return 'Invalid content component.';
	}
	for (const tag of html.matchAll(/<div\b[^>]*\bdata-cms-project-fact=(['"])true\1[^>]*>/gi)) {
		const value = tag[0];
		if (
			!componentText(attribute(value, 'data-label'), 120) ||
			!componentText(attribute(value, 'data-value'), 500)
		)
			return 'Invalid content component.';
	}
	for (const tag of html.matchAll(
		/<a\b[^>]*\bdata-cms-action=(['"])(?:primary|secondary)\1[^>]*>/gi
	)) {
		const href = attribute(tag[0], 'href');
		if (!href || !safeComponentUrl(href)) return 'Unsafe content component link.';
	}
	return null;
}
function validateContent(e) {
	const r = e.record,
		kind = r.getString('kind'),
		layout = r.getString('layout');
	// Reordering does not change HTML. Avoid rescanning it in the JSVM for metadata-only saves.
	if (r.getString('body') !== r.original().getString('body')) {
		const componentError = validateComponentHtml(r.getString('body'));
		if (componentError) throw new BadRequestError(componentError);
	}
	if (
		r.original().getString('slug') === 'documentation' &&
		r.original().getString('layout') === 'guide' &&
		(r.getString('slug') !== 'documentation' || layout !== 'guide' || r.getString('parent'))
	)
		throw new BadRequestError(
			'The documentation landing URL and root position are reserved. Its title and content remain editable.'
		);
	if (
		(kind === 'post' && layout !== 'article') ||
		(kind === 'page' && !['standard', 'guide'].includes(layout))
	)
		throw new BadRequestError('Choose a valid page or post layout.');
	let parent = r.getString('parent');
	const seen = new Set([r.id]);
	if (kind === 'post' && parent) throw new BadRequestError('Posts cannot have parent pages.');
	while (parent) {
		if (seen.has(parent)) throw new BadRequestError('Page hierarchy cannot contain a cycle.');
		seen.add(parent);
		const node = e.app.findRecordById('content', parent);
		if (node.getString('kind') !== 'page' || node.getString('layout') !== layout)
			throw new BadRequestError('Parent page must use the same layout.');
		if (r.getBool('isPublished') && !node.getBool('isPublished'))
			throw new BadRequestError('Publish the parent page first.');
		parent = node.getString('parent');
	}
	const children = e.app.findRecordsByFilter('content', 'parent = {:id}', '', 0, 0, { id: r.id });
	if (children.some((c) => c.getString('layout') !== layout))
		throw new BadRequestError('Move child pages before changing this layout.');
	if (!r.getBool('isPublished') && children.some((c) => c.getBool('isPublished')))
		throw new BadRequestError('Unpublish child pages first.');
	e.next();
}
function validateOpenCall(e) {
	const body = e.record.getString('body');
	if (/\bdata-cms-open-calls=/i.test(body))
		throw new BadRequestError('Open calls cannot contain another open calls component.');
	const componentError = validateComponentHtml(body);
	if (componentError) throw new BadRequestError(componentError);
	e.next();
}
function validateMenu(e) {
	let config;
	try {
		config = JSON.parse(e.record.getString('config'));
	} catch {
		throw new BadRequestError('Invalid menu configuration.');
	}
	const ids = new Set();
	const live = e.record.collection().name === 'cms_menus';
	function identity(item) {
		if (
			!item ||
			typeof item.id !== 'string' ||
			!item.id ||
			ids.has(item.id) ||
			typeof item.label !== 'string' ||
			!item.label.trim()
		)
			throw new BadRequestError('Menu items need unique IDs and labels.');
		ids.add(item.id);
	}
	function link(item, active = true) {
		identity(item);
		const t = item.target;
		// Retain incomplete inactive drafts, but never retain an unsafe external URL.
		if (!active && t?.type !== 'external') return;
		if (
			!t ||
			!['content', 'category', 'collection', 'edition', 'route', 'external'].includes(t.type) ||
			typeof t.value !== 'string' ||
			!t.value
		)
			throw new BadRequestError('Select a valid link destination.');
		if (
			t.type === 'external' &&
			!(
				/^https?:\/\/[^\s]+$/i.test(t.value) ||
				/^mailto:[^\s]+$/i.test(t.value) ||
				/^\/(?!\/)[^\\\s]*$/.test(t.value)
			)
		)
			throw new BadRequestError('Unsafe link URL.');
		if (
			t.type === 'route' &&
			![
				'/',
				'/collections',
				'/editions',
				'/resources',
				'/learning-materials',
				'/resources/contact',
				'/demo',
				'/profile',
				'/reviews'
			].includes(t.value)
		)
			throw new BadRequestError('Unknown application route.');
		const collection =
			t.type === 'content'
				? 'content'
				: t.type === 'category'
					? 'cms_categories'
					: t.type === 'collection'
						? 'collections'
						: t.type === 'edition'
							? 'editions'
							: '';
		if (collection && active) {
			let record;
			try {
				record = e.app.findRecordById(collection, t.value);
			} catch {
				// Keep deleted destinations repairable in drafts; live menus must resolve every link.
				if (!live) return;
				throw new BadRequestError(
					`“${item.label}” points to a destination that no longer exists. Choose another destination.`
				);
			}
			if (
				live &&
				((t.type === 'content' && !record.getBool('isPublished')) ||
					(t.type === 'collection' && !record.getBool('isVisible')) ||
					(t.type === 'edition' && !record.getBool('isPublished')))
			)
				throw new BadRequestError('Publish the link destination before publishing this menu.');
		}
	}
	function introduction(item) {
		if (
			item != null &&
			(typeof item !== 'object' ||
				typeof item.heading !== 'string' ||
				!item.heading.trim() ||
				typeof item.description !== 'string' ||
				!item.description.trim())
		)
			throw new BadRequestError('Menu introductions need a heading and description.');
	}
	if (!config || !Array.isArray(config.items) || config.items.length > 30)
		throw new BadRequestError('Invalid menu configuration.');
	for (const item of config.items) {
		identity(item);
		if (
			item.style !== undefined &&
			!['default', 'primary', 'secondary', 'outline'].includes(item.style)
		)
			throw new BadRequestError('Invalid menu style.');
		if (!Array.isArray(item.groups) || item.groups.length > 20)
			throw new BadRequestError('Invalid menu groups.');
		introduction(item.introduction);
		if (item.direct && item.landing)
			throw new BadRequestError('A direct menu cannot also have a landing link.');
		if (item.direct) link(item.direct);
		if (item.landing) link(item.landing);
		// Retained submenu targets are only required to exist when the submenu is active.
		for (const group of item.groups) {
			identity(group);
			if (!Array.isArray(group.links) || group.links.length > 200)
				throw new BadRequestError('Invalid menu links.');
			if (group.landing) link(group.landing, !item.direct);
			group.links.forEach((entry) => link(entry, !item.direct));
		}
		if (item.featured) link(item.featured.link, !item.direct);
	}
	if (config.primary) link(config.primary);
	if (config.helpLink) link(config.helpLink);
	e.next();
}
function enforceMenuVersion(e) {
	const expected = e.requestInfo().headers['x_pure3d_menu_version'];
	e.app.runInTransaction((tx) => {
		e.app = tx;
		const current = tx.findRecordById(e.record.collection().name, e.record.id);
		if (!expected || expected !== current.getString('updated'))
			throw new BadRequestError('This menu changed. Reload before saving.');
		e.next();
	});
}
function enforceContentVersion(e) {
	const expected = e.requestInfo().headers['x_pure3d_content_version'];
	if (!expected) return e.next();
	e.app.runInTransaction((tx) => {
		e.app = tx;
		const current = tx.findRecordById('content', e.record.id);
		if (expected !== current.getString('updated'))
			throw new BadRequestError('This content changed. Reload before saving.');
		e.next();
	});
}
function enforceOpenCallVersion(e) {
	const expected = e.requestInfo().headers['x_pure3d_open_call_version'];
	e.app.runInTransaction((tx) => {
		e.app = tx;
		const current = tx.findRecordById('open_calls', e.record.id);
		if (!expected || expected !== current.getString('updated'))
			throw new BadRequestError(
				'This open call changed. Reload before saving. Your changes have not been saved.'
			);
		e.next();
	});
}
function deleteOpenCall(e) {
	e.app.runInTransaction((tx) => {
		e.app = tx;
		if (
			tx.findRecordsByFilter('content', 'body ~ {:id}', '', 1, 0, { id: e.record.id }).length ||
			tx.findRecordsByFilter('editions', 'proposalOpenCall = {:id}', '', 1, 0, { id: e.record.id })
				.length
		)
			throw new BadRequestError(
				'This open call is used by a page or proposal. Unpublish it, or remove its references before deleting it.'
			);
		e.next();
	});
}
function deleteContent(e) {
	if (e.record.getString('layout') === 'guide' && e.record.getString('slug') === 'documentation')
		throw new BadRequestError(
			'The documentation landing page is required. Edit or unpublish it instead.'
		);
	if (e.app.findRecordsByFilter('content', 'parent = {:id}', '', 1, 0, { id: e.record.id }).length)
		throw new BadRequestError('Move or delete child pages first.');
	e.next();
}
function deleteMedia(e) {
	const needle = '/' + e.record.id + '/';
	if (
		e.app.findRecordsByFilter('content', 'body ~ {:needle} || coverUrl ~ {:needle}', '', 1, 0, {
			needle
		}).length
	)
		throw new BadRequestError('This file is used by a page or post. Remove its references first.');
	e.next();
}
module.exports = {
	validateContent,
	validateOpenCall,
	validateComponentHtml,
	validateMenu,
	enforceMenuVersion,
	enforceContentVersion,
	enforceOpenCallVersion,
	deleteOpenCall,
	deleteContent,
	deleteMedia
};
