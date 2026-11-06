/**
 * PURE3D animation bridge. Voyager 0.59 binds actions to its first mesh rather
 * than the loaded glTF scene. Use its existing mixer with the glTF root so clips
 * targeting child nodes bind correctly. Voyager owns timing and rendering.
 * Configuration is stored as ordinary Voyager metadata actions. No vendor edits.
 */
const ACTION_PREFIX = 'pure3d-animation-';
const LOOP_ONCE = 2200;
const LOOP_REPEAT = 2201;

/**
 * @param {import('./animation-controls').AnimationApplication} application
 * @param {HTMLElement} host
 * @param {{ editable?: boolean, onchange?: () => void }} options
 */
export function mountAnimationControls(application, host, options = {}) {
	const components = application?.system?.components;
	const manager = /** @type {import('./animation-controls').AnimationManager | undefined} */ (
		components?.get('CVActionManager')
	);
	const empty = { refresh() {}, prepareSave() {}, dispose() {} };
	if (!components || !manager?._mixer || !Array.isArray(manager._activeClips)) return empty;

	/** @typedef {{ key: string, model: import('./animation-controls').AnimationModel, root: import('./animation-controls').AnimationObject, clip: import('./animation-controls').AnimationClip }} Entry */
	/** @type {Entry[]} */
	let entries = [];
	/** @type {Map<string, { entry: Entry, playback: import('./animation-controls').PlaybackClip }>} */
	const playing = new Map();
	let selected = '';
	let loop = true;
	let autoplay = false;
	let disposed = false;
	/** @type {ReturnType<typeof setInterval> | undefined} */
	let statusTimer;
	const owner = {};
	const originalPlay = manager.playAnimation;
	const panel = document.createElement('div');
	panel.className = 'pure3d-animation-controls';
	panel.hidden = true;
	panel.setAttribute('role', 'group');
	panel.setAttribute('aria-label', 'Model animation');
	const style = document.createElement('style');
	style.textContent = `
		.pure3d-animation-controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:12px; background:var(--color-base-200,#303030); color:var(--color-base-content,#fff); font:inherit; }
		.pure3d-animation-controls[hidden] { display:none; }
		.pure3d-animation-controls label { display:flex; gap:8px; align-items:center; min-width:0; flex-wrap:wrap; }
		.pure3d-animation-controls select { min-width:0; max-width:100%; }
		.pure3d-animation-controls select, .pure3d-animation-controls button { font:inherit; color:inherit; background:transparent; border:1px solid currentColor; border-radius:4px; padding:8px 12px; }
		.pure3d-animation-controls option { color:#181818; background:#fff; }
		.pure3d-animation-controls button { cursor:pointer; }
		.pure3d-animation-controls button:hover { background:var(--color-base-300,#454545); }
		.pure3d-animation-controls :focus-visible { outline:2px solid currentColor; outline-offset:2px; }
		.pure3d-animation-controls .animation-error { flex-basis:100%; }
		.pure3d-animation-controls .animation-error:empty { display:none; }
	`;
	const label = document.createElement('label');
	const labelText = document.createTextNode('Animation');
	label.append(labelText);
	const select = document.createElement('select');
	label.append(select);
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.textContent = 'Play';
	const loopLabel = document.createElement('label');
	const loopInput = document.createElement('input');
	loopInput.type = 'checkbox';
	loopInput.checked = loop;
	loopLabel.append(loopInput, 'Loop');
	const autoLabel = document.createElement('label');
	const autoInput = document.createElement('input');
	autoInput.type = 'checkbox';
	autoLabel.append(autoInput, 'Play on load');
	const error = document.createElement('span');
	error.className = 'animation-error';
	error.setAttribute('role', 'status');
	panel.append(label, toggle, loopLabel);
	if (options.editable) panel.append(autoLabel);
	panel.append(error);
	host.append(style, panel);

	/** @param {import('./animation-controls').AnimationModel} model @param {boolean} create */
	function metadata(model, create = false) {
		const meta = model.node.getComponent('CVMeta', true) ||
			(create ? model.node.createComponent('CVMeta') : undefined);
		return meta?.actions;
	}
	/** @param {Entry} entry */
	function savedAction(entry) {
		return metadata(entry.model)?.items.find((action) => action.id.startsWith(ACTION_PREFIX));
	}
	function updateButton() {
		const item = entries.find((entry) => entry.key === selected);
		const playback = item && playing.get(item.key)?.playback;
		toggle.textContent = playback && !playback.paused && playback.isRunning() ? 'Pause' : 'Play';
	}
	/** @param {string} key */
	function stop(key) {
		const current = playing.get(key);
		if (!current) return;
		current.playback.stop();
		manager._activeClips = manager._activeClips.filter((item) => item.clip !== current.playback);
		manager._mixer.uncacheAction(current.entry.clip, current.entry.root);
		playing.delete(key);
	}
	/** @param {Entry} entry @param {import('./animation-controls').AnimationAction} action */
	function play(entry, action) {
		try {
			error.textContent = '';
			const playback = manager._mixer.clipAction(entry.clip, entry.root);
			playback.reset();
			playback.paused = false;
			playback.clampWhenFinished = action.style !== 'Loop';
			playback.setLoop(action.style === 'Loop' ? LOOP_REPEAT : LOOP_ONCE, action.style === 'Loop' ? Infinity : 1);
			playback.play();
			if (!manager._activeClips.some((item) => item.clip === playback))
				manager._activeClips.push({ id: action.id, clip: playback });
			playing.set(entry.key, { entry, playback });
		} catch {
			error.textContent = 'Could not play this animation in Voyager.';
		}
		updateButton();
	}
	// Route our saved native actions through the correct glTF root as well.
	manager.playAnimation = function (model, action) {
		if (!action.id.startsWith(ACTION_PREFIX)) return originalPlay.call(this, model, action);
		if (action.trigger === 'OnLoad' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		refresh();
		const entry = entries.find((item) => item.model === model && item.clip.name === action.animation);
		if (entry) play(entry, action);
	};
	const bridgedPlay = manager.playAnimation;
	function prepareSave() {
		const entry = entries.find((item) => item.key === selected);
		if (!options.editable || !entry) return;
		const actions = metadata(entry.model, true);
		if (!actions) throw new Error('Could not save animation settings in this scene.');
		const previous = savedAction(entry);
		const action = {
			id: previous?.id || `${ACTION_PREFIX}${entry.model.node.id}`,
			type: 'PlayAnimation',
			trigger: autoplay ? 'OnLoad' : 'OnClick',
			animation: entry.clip.name,
			style: loop ? 'Loop' : 'Single'
		};
		actions.insert(action);
	}
	function changed() {
		try {
			prepareSave();
			options.onchange?.();
		} catch {
			error.textContent = 'Could not save animation settings in this scene.';
		}
	}
	select.onchange = () => {
		stop(selected);
		selected = select.value;
		error.textContent = '';
		changed();
		updateButton();
	};
	loopInput.onchange = () => {
		loop = loopInput.checked;
		const current = playing.get(selected);
		if (current) current.playback.setLoop(loop ? LOOP_REPEAT : LOOP_ONCE, loop ? Infinity : 1);
		changed();
	};
	autoInput.onchange = () => {
		autoplay = autoInput.checked;
		changed();
	};
	toggle.onclick = () => {
		const entry = entries.find((item) => item.key === selected);
		if (!entry) return;
		const current = playing.get(selected);
		if (current?.playback.isRunning()) current.playback.paused = true;
		else if (current?.playback.paused && manager._activeClips.some((item) => item.clip === current.playback)) current.playback.paused = false;
		else play(entry, { id: `${ACTION_PREFIX}${entry.model.node.id}`, type: 'PlayAnimation', trigger: 'OnClick', animation: entry.clip.name, style: loop ? 'Loop' : 'Single' });
		updateButton();
	};
	/** @type {Set<import('./animation-controls').AnimationModel>} */
	const watched = new Set();
	function refresh() {
		if (disposed) return;
		/** @type {Entry[]} */
		const next = [];
		for (const model of components.getArray('CVModel2')) {
			if (!watched.has(model)) {
				watched.add(model);
				model.on('model-load', refresh, owner);
			}
			const root = model.activeDerivative?.model;
			if (!root) continue;
			const seen = new Set();
			root.traverse((object) => {
				for (const clip of object.animations || []) {
					if (!clip.name || seen.has(clip.uuid) || !(clip.duration > 0)) continue;
					seen.add(clip.uuid);
					next.push({ key: `${model.node.id}:${clip.uuid}`, model, root, clip });
				}
			});
		}
		for (const [key, current] of playing)
			if (!next.some((entry) => entry.key === key && entry.root === current.entry.root)) stop(key);
		const unchanged = next.length === entries.length && next.every((entry, index) => entry.key === entries[index].key && entry.root === entries[index].root);
		entries = next;
		panel.hidden = !entries.length;
		if (entries.length && !statusTimer) statusTimer = setInterval(updateButton, 500);
		if (!entries.length && statusTimer) {
			clearInterval(statusTimer);
			statusTimer = undefined;
		}
		if (unchanged) return;
		if (!entries.some((entry) => entry.key === selected)) {
			const preferred = entries.find((entry) => savedAction(entry)?.animation === entry.clip.name) || entries[0];
			selected = preferred?.key || '';
			const action = preferred && savedAction(preferred);
			loop = action ? action.style === 'Loop' : true;
			autoplay = action?.trigger === 'OnLoad';
		}
		select.replaceChildren(...entries.map((entry, index) => {
			const option = document.createElement('option');
			option.value = entry.key;
			option.textContent = components.getArray('CVModel2').length > 1 ? `${entry.model.node.name || `Model ${index + 1}`} · ${entry.clip.name}` : entry.clip.name;
			return option;
		}));
		select.value = selected;
		select.hidden = entries.length === 1;
		labelText.textContent = entries.length === 1 ? `Animation · ${entries[0].clip.name}` : 'Animation';
		loopInput.checked = loop;
		autoInput.checked = autoplay;
		updateButton();
	}
	/** @param {{ object: import('./animation-controls').AnimationModel, add?: boolean, remove?: boolean }} event */
	function modelChanged(event) {
		if (event.remove) {
			event.object.off('model-load', refresh, owner);
			watched.delete(event.object);
		}
		refresh();
	}
	components.on('CVModel2', modelChanged, owner);
	refresh();
	// Saved OnLoad actions may have fired before the bridge was installed.
	for (const entry of entries) {
		const action = savedAction(entry);
		if (action?.animation !== entry.clip.name || action.trigger !== 'OnLoad') continue;
		for (const item of [...manager._activeClips])
			if (item.id === action.id) {
				item.clip.stop();
				manager._activeClips = manager._activeClips.filter((active) => active !== item);
			}
		if (!matchMedia('(prefers-reduced-motion: reduce)').matches) play(entry, action);
	}
	return {
		refresh,
		prepareSave,
		dispose() {
			disposed = true;
			clearInterval(statusTimer);
			components.off('CVModel2', modelChanged, owner);
			for (const model of watched) model.off('model-load', refresh, owner);
			for (const key of playing.keys()) stop(key);
			if (manager.playAnimation === bridgedPlay) manager.playAnimation = originalPlay;
			panel.remove();
			style.remove();
		}
	};
}
