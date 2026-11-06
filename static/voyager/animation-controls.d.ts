export interface AnimationClip {
	uuid: string;
	name: string;
	duration: number;
}
export interface AnimationObject {
	animations?: AnimationClip[];
	traverse: (callback: (object: AnimationObject) => void) => void;
}
export interface AnimationAction {
	id: string;
	type: string;
	trigger: string;
	animation: string;
	style: string;
}
export interface AnimationMetadata {
	actions?: {
		items: AnimationAction[];
		insert: (action: AnimationAction) => void;
	};
}
export interface AnimationModel {
	node: {
		id: string;
		name?: string;
		getComponent: (name: string, optional?: boolean) => AnimationMetadata | undefined;
		createComponent: (name: string) => AnimationMetadata;
	};
	activeDerivative?: { model?: AnimationObject };
	on: (type: string, callback: () => void, owner: object) => void;
	off: (type: string, callback: () => void, owner: object) => void;
}
export interface PlaybackClip {
	paused: boolean;
	clampWhenFinished: boolean;
	reset: () => PlaybackClip;
	setLoop: (mode: number, repetitions: number) => PlaybackClip;
	play: () => PlaybackClip;
	stop: () => void;
	isRunning: () => boolean;
}
export interface AnimationManager {
	_mixer: {
		clipAction: (clip: AnimationClip, root: AnimationObject) => PlaybackClip;
		uncacheAction: (clip: AnimationClip, root: AnimationObject) => void;
	};
	_activeClips: { id: string; clip: PlaybackClip }[];
	playAnimation: (model: AnimationModel, action: AnimationAction) => void;
}
export interface AnimationApplication {
	system?: {
		components?: {
			get: (name: string) => unknown;
			getArray: (name: string) => AnimationModel[];
			on: (type: string, callback: (event: { object: AnimationModel; add?: boolean; remove?: boolean }) => void, owner: object) => void;
			off: (type: string, callback: (event: { object: AnimationModel; add?: boolean; remove?: boolean }) => void, owner: object) => void;
		};
	};
}
export function mountAnimationControls(
	application: AnimationApplication,
	host: HTMLElement,
	options?: { editable?: boolean; onchange?: () => void }
): { refresh: () => void; prepareSave: () => void; dispose: () => void };
