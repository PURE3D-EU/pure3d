export const paletteFields = [
	['background', 'Background'],
	['surface', 'Surface'],
	['surfaceAlt', 'Raised surface'],
	['text', 'Text'],
	['primary', 'Primary'],
	['secondary', 'Secondary'],
	['accent', 'Accent'],
	['neutral', 'Neutral'],
	['border', 'Borders']
] as const;

export type PaletteKey = (typeof paletteFields)[number][0];
export type Palette = Record<PaletteKey, string>;

function palette(
	id: string,
	name: string,
	background: string,
	surface: string,
	surfaceAlt: string,
	text: string,
	primary: string,
	secondary: string,
	accent: string,
	neutral: string,
	border: string
) {
	return {
		id,
		name,
		colors: { background, surface, surfaceAlt, text, primary, secondary, accent, neutral, border }
	};
}

export const palettes = [
	palette(
		'pure3d',
		'Original',
		'#f4f1eb',
		'#f4f1eb',
		'#ece7dd',
		'#141413',
		'#293e30',
		'#555249',
		'#d94f26',
		'#2b2a27',
		'#e2dccf'
	),
	palette(
		'pure3d-classic',
		'PURE3D Classic',
		'#ffffff',
		'#ffffff',
		'#f3f3f3',
		'#293744',
		'#387fc1',
		'#209fb9',
		'#167e79',
		'#293744',
		'#dddddd'
	),
	palette(
		'porcelain',
		'Porcelain',
		'#f8fafc',
		'#ffffff',
		'#edf2f7',
		'#172534',
		'#254c73',
		'#626582',
		'#b74e37',
		'#334155',
		'#d6dfe8'
	),
	palette(
		'sage',
		'Sage',
		'#eef2eb',
		'#f7f9f3',
		'#e1e8db',
		'#202c22',
		'#38563c',
		'#647250',
		'#a75232',
		'#3f4d3c',
		'#ced8c6'
	),
	palette(
		'sandstone',
		'Sandstone',
		'#f5eee3',
		'#fffbf3',
		'#eadfcd',
		'#352a22',
		'#775332',
		'#7d655b',
		'#a43f35',
		'#534438',
		'#d9c9b3'
	),
	palette(
		'lavender',
		'Lavender',
		'#f3f0f8',
		'#fcfaff',
		'#e9e2f2',
		'#2c2339',
		'#655082',
		'#74617c',
		'#ad4468',
		'#4c3e5b',
		'#d8cde5'
	),
	palette(
		'ocean',
		'Ocean',
		'#edf5f5',
		'#f8fdfd',
		'#dcebed',
		'#173137',
		'#24606b',
		'#476c7c',
		'#b54a31',
		'#354f57',
		'#c3dadd'
	),
	palette(
		'rose',
		'Rose',
		'#faf0ef',
		'#fff9f7',
		'#f1dfdf',
		'#38272b',
		'#874254',
		'#7c626c',
		'#a34d28',
		'#594047',
		'#e4c9cc'
	),
	palette(
		'midnight',
		'Midnight',
		'#111923',
		'#192432',
		'#223143',
		'#edf2f8',
		'#a4c8eb',
		'#b9b1dc',
		'#ffa887',
		'#a7b8cb',
		'#36485c'
	),
	palette(
		'charcoal',
		'Charcoal',
		'#191b1a',
		'#222623',
		'#2c322e',
		'#eef2ec',
		'#b7cda8',
		'#bfb6a4',
		'#f1aa83',
		'#aebbb0',
		'#414a43'
	),
	palette(
		'aubergine',
		'Aubergine',
		'#211925',
		'#2c2232',
		'#392c40',
		'#f5edf7',
		'#d4b0e2',
		'#bcb3db',
		'#f3b18d',
		'#c0adca',
		'#503e59'
	),
	palette(
		'terracotta',
		'Terracotta',
		'#f5eae2',
		'#fff8f0',
		'#ecd8ca',
		'#362720',
		'#94462e',
		'#716044',
		'#875034',
		'#584237',
		'#ddbeaa'
	),
	palette(
		'cobalt',
		'Cobalt',
		'#f1f4fa',
		'#ffffff',
		'#e2e8f4',
		'#1b2942',
		'#2954a3',
		'#586e94',
		'#a64938',
		'#354760',
		'#ccd6e8'
	),
	palette(
		'indigo',
		'Indigo',
		'#f2f1fa',
		'#fbfaff',
		'#e5e2f3',
		'#28243d',
		'#51418d',
		'#6d668b',
		'#9b4c6d',
		'#443c5d',
		'#d3cee6'
	),
	palette(
		'glacier',
		'Glacier',
		'#eff7fa',
		'#fcfeff',
		'#dfeef3',
		'#233940',
		'#21647d',
		'#557e89',
		'#a64b41',
		'#3b555e',
		'#c5dce5'
	),
	palette(
		'eucalyptus',
		'Eucalyptus',
		'#f0f5f1',
		'#fafffa',
		'#e0ebe2',
		'#23372c',
		'#356a4f',
		'#657b60',
		'#ab523a',
		'#3e5546',
		'#cbdccd'
	),
	palette(
		'olive',
		'Olive',
		'#f4f3e9',
		'#fdfcf3',
		'#e9e7d5',
		'#303323',
		'#5b6535',
		'#78704d',
		'#a14532',
		'#4d5039',
		'#d9d7bc'
	),
	palette(
		'moss',
		'Moss',
		'#edf1e7',
		'#f8faf2',
		'#dde5d1',
		'#283223',
		'#485e32',
		'#6b7652',
		'#98532e',
		'#45513a',
		'#c9d4bb'
	),
	palette(
		'linen',
		'Linen',
		'#f8f5ef',
		'#fffdf8',
		'#eee8dd',
		'#373129',
		'#665344',
		'#7d7563',
		'#9d523c',
		'#534a3e',
		'#ded5c6'
	),
	palette(
		'parchment',
		'Parchment',
		'#f4ecd8',
		'#fff8e8',
		'#e9dec2',
		'#393022',
		'#6a4d2b',
		'#7b714c',
		'#a13f2d',
		'#564937',
		'#d6c8a5'
	),
	palette(
		'clay',
		'Clay',
		'#f6eeea',
		'#fff9f5',
		'#ecddd4',
		'#3c2c28',
		'#945745',
		'#7a6658',
		'#904350',
		'#5c443b',
		'#ddc7bb'
	),
	palette(
		'ochre',
		'Ochre',
		'#f7f1e3',
		'#fffaf0',
		'#eee1c7',
		'#3c3020',
		'#8b6321',
		'#77704c',
		'#a14430',
		'#5b4931',
		'#dfcda9'
	),
	palette(
		'burgundy',
		'Burgundy',
		'#f8eff1',
		'#fff9fb',
		'#efdee4',
		'#3a2530',
		'#803551',
		'#796273',
		'#98632c',
		'#563d49',
		'#dec5d0'
	),
	palette(
		'plum',
		'Plum',
		'#f6f0f7',
		'#fffaff',
		'#eadfec',
		'#36263b',
		'#75447d',
		'#746680',
		'#a44d41',
		'#513d57',
		'#d9c8df'
	),
	palette(
		'heather',
		'Heather',
		'#f2f1f5',
		'#fdfcff',
		'#e5e2eb',
		'#302b3b',
		'#655777',
		'#6f7087',
		'#a45349',
		'#4d465c',
		'#d2cddd'
	),
	palette(
		'graphite',
		'Graphite',
		'#f3f4f4',
		'#ffffff',
		'#e7e9e9',
		'#242a2c',
		'#3c4e54',
		'#687277',
		'#9c4e3b',
		'#414b50',
		'#d2d7d9'
	),
	palette(
		'monochrome',
		'Monochrome',
		'#f5f5f5',
		'#ffffff',
		'#e9e9e9',
		'#202020',
		'#303030',
		'#606060',
		'#484848',
		'#454545',
		'#d3d3d3'
	),
	palette(
		'marine',
		'Marine',
		'#101e29',
		'#192b38',
		'#223b4a',
		'#eef5fa',
		'#9dcde8',
		'#a4bbc9',
		'#ffb38d',
		'#b2c9d7',
		'#355465'
	),
	palette(
		'deep-teal',
		'Deep teal',
		'#102525',
		'#193332',
		'#244442',
		'#e8f5ef',
		'#9bd8c9',
		'#a8c9ba',
		'#f5ba96',
		'#b0cfc6',
		'#375b56'
	),
	palette(
		'pine',
		'Pine',
		'#15241c',
		'#203229',
		'#2b4435',
		'#edf4e9',
		'#b6d399',
		'#c9c6a0',
		'#f0b48f',
		'#b7c9b3',
		'#425b48'
	),
	palette(
		'night-olive',
		'Night olive',
		'#22251a',
		'#2e3224',
		'#3d4230',
		'#f1f2e5',
		'#d0d69b',
		'#c3c6ae',
		'#f4b193',
		'#c5cab2',
		'#535a40'
	),
	palette(
		'espresso',
		'Espresso',
		'#251d19',
		'#322722',
		'#44352c',
		'#f8efe4',
		'#ddbc91',
		'#c8b7a0',
		'#f2ad8d',
		'#d0bca9',
		'#5b473b'
	),
	palette(
		'oxblood',
		'Oxblood',
		'#281b20',
		'#37262d',
		'#49323b',
		'#faedf1',
		'#e4b1bf',
		'#c9b5c7',
		'#f3bd91',
		'#d2b9c2',
		'#654551'
	),
	palette(
		'violet-night',
		'Violet night',
		'#1e1c2e',
		'#29273e',
		'#383453',
		'#f1eefb',
		'#c3b8ef',
		'#aabfdf',
		'#f4bb9c',
		'#c1badb',
		'#4f496d'
	),
	palette(
		'slate-night',
		'Slate night',
		'#1c222b',
		'#272f3a',
		'#343e4c',
		'#eff3f8',
		'#acc8e5',
		'#b7c1d4',
		'#efb798',
		'#bfcbd9',
		'#4a5768'
	),
	palette(
		'copper-night',
		'Copper night',
		'#241e1b',
		'#322925',
		'#44372e',
		'#f7eee7',
		'#e5b28e',
		'#cbc0a7',
		'#edaa91',
		'#d4bfae',
		'#604c3e'
	)
];

export function isPalette(value: unknown): value is Palette {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return paletteFields.every(([key]) => {
		const color = record[key];
		return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
	});
}

function luminance(hex: string) {
	const channels = [1, 3, 5].map((offset) => {
		const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function readableText(hex: string) {
	const light = luminance(hex);
	const whiteContrast = 1.05 / (light + 0.05);
	const darkContrast = (light + 0.05) / (luminance('#141413') + 0.05);
	if (whiteContrast >= darkContrast) return '#ffffff';
	return darkContrast >= 4.5 ? '#141413' : '#000000';
}

function contrastText(foreground: string, background: string) {
	const a = luminance(foreground);
	const b = luminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5
		? foreground
		: readableText(background);
}

function buttonColor(hex: string) {
	// Keep white labels on mid-tone brand colors, darkening just enough for WCAG AA.
	if (luminance(hex) > 0.4) return hex;
	let color = hex;
	while (1.05 / (luminance(color) + 0.05) < 4.5) {
		color =
			'#' +
			[1, 3, 5]
				.map((offset) =>
					Math.floor(parseInt(color.slice(offset, offset + 2), 16) * 0.96)
						.toString(16)
						.padStart(2, '0')
				)
				.join('');
	}
	return color;
}

export function applyPalette(colors: Palette, darkHero = true) {
	const {
		background,
		surface,
		surfaceAlt,
		text: requestedText,
		primary,
		secondary,
		accent,
		neutral,
		border
	} = colors;
	const text = contrastText(requestedText, background);
	const muted = contrastText(
		'#' +
			[1, 3, 5]
				.map((offset) =>
					Math.round(
						parseInt(text.slice(offset, offset + 2), 16) * 0.72 +
							parseInt(background.slice(offset, offset + 2), 16) * 0.28
					)
						.toString(16)
						.padStart(2, '0')
				)
				.join(''),
		background
	);
	const faint = muted;
	const actionPrimary = buttonColor(primary);
	const actionSecondary = buttonColor(secondary);
	const actionAccent = buttonColor(accent);
	const actionNeutral = buttonColor(neutral);
	const heroBackground = darkHero ? '#121211' : background;
	const heroText = darkHero ? '#f4f1eb' : text;
	const heroAccent = darkHero
		? '#' +
			[1, 3, 5]
				.map((offset) =>
					Math.round(parseInt(accent.slice(offset, offset + 2), 16) * 0.55 + 255 * 0.45)
						.toString(16)
						.padStart(2, '0')
				)
				.join('')
		: accent;
	const tokens: Record<string, string> = {
		'color-hero-bg': heroBackground,
		'color-hero-content': heroText,
		'color-hero-glow': `color-mix(in srgb, ${primary} 18%, ${heroBackground})`,
		'color-hero-accent': contrastText(heroAccent, heroBackground),
		'color-panel-bg': neutral,
		'color-panel-content': readableText(neutral),
		'color-base-100': background,
		'color-surface': surface,
		'color-surface-content': contrastText(requestedText, surface),
		'color-base-200': surfaceAlt,
		'color-base-300': border,
		'color-base-content': text,
		'color-primary': actionPrimary,
		'color-secondary': actionSecondary,
		'color-accent': actionAccent,
		'color-neutral': actionNeutral,
		'color-primary-content': readableText(actionPrimary),
		'color-secondary-content': readableText(actionSecondary),
		'color-accent-content': readableText(actionAccent),
		'color-neutral-content': readableText(actionNeutral),
		'color-paper': surface,
		'color-paper-2': surfaceAlt,
		'color-paper-3': border,
		'color-ink': text,
		'color-ink-2': muted,
		'color-ink-3': muted,
		'color-ink-4': faint,
		'color-forest': actionPrimary,
		'color-forest-hover': `color-mix(in srgb, ${actionPrimary} 85%, ${text})`,
		'color-vermillion': actionAccent,
		'color-vermillion-ink': contrastText(accent, background),
		'color-vermillion-wash': `color-mix(in srgb, ${accent} 10%, ${background})`,
		'ds-paper': surface,
		'ds-paper-bg': background,
		'ds-paper-2': surfaceAlt,
		'ds-paper-3': border,
		'ds-ink': text,
		'ds-ink-2': muted,
		'ds-ink-3': muted,
		'ds-ink-4': faint,
		'ds-rule': border,
		'ds-rule-strong': `color-mix(in srgb, ${text} 30%, ${background})`,
		'ds-primary': actionPrimary,
		'ds-primary-content': readableText(actionPrimary),
		'ds-secondary': actionSecondary,
		'ds-secondary-content': readableText(actionSecondary),
		'ds-accent': actionAccent,
		'ds-accent-content': readableText(actionAccent),
		'ds-vermillion': actionAccent,
		'ds-vermillion-ink': contrastText(accent, background),
		'ds-vermillion-wash': `color-mix(in srgb, ${accent} 10%, ${background})`
	};
	const root = document.documentElement;
	root.dataset.theme = 'pure3d';
	const colorScheme = readableText(background) === '#ffffff' ? 'dark' : 'light';
	root.style.colorScheme = colorScheme;
	root.dataset.colorScheme = colorScheme;
	for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
}
