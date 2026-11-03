/**
 * Point clouds for the landing-page artwork. Edition forms are pre-sampled from published meshes;
 * the remaining forms are conceptual examples of the objects that 3D editions document.
 */

export interface ParticleForm {
	id: string;
	label: string;
	title: string;
	note: string;
	sourceSlug?: string;
	sourceTitle?: string;
}

export const EDITION_PARTICLE_FORMS: ParticleForm[] = [
	{
		id: 'rembrandts-birthplace',
		label: "Rembrandt's home",
		title: "Rembrandt's Birthplace",
		note: 'Surface points sampled from the published edition building mesh. Orange highlights are conceptual and do not represent its annotations.',
		sourceSlug: '2boeb1g2jhgrzfx',
		sourceTitle: "Rembrandt's Birthplace"
	},
	{
		id: 'petrol-lamp',
		label: 'Mining lamp',
		title: 'Petrol Lamp: Safety and Hazards in the Mines',
		note: 'Surface points sampled from the published edition mesh. Orange highlights are conceptual and do not represent its annotations.',
		sourceSlug: '8mlt1kcw2pimn3c',
		sourceTitle: 'Petrol Lamp'
	},
	{
		id: 'whale-bottle-shoe',
		label: 'Whale-bottle-shoe',
		title: 'Whale-bottle-shoe',
		note: 'Surface points sampled from the published edition’s exterior mesh.',
		sourceSlug: '6o2lzuxngvx24nf',
		sourceTitle: 'Whale-bottle-shoe'
	},
	{
		id: 'otoscopy-head',
		label: 'Otoscopy head',
		title: 'Otoscopy Training Head',
		note: 'Surface points sampled from the published training-head mesh, excluding separate document models.',
		sourceSlug: 'j16rjyx1w2fzj74',
		sourceTitle: 'Otoscopy Training Head'
	},
	{
		id: 'akua-ba',
		label: 'Akua’ba child figure',
		title: 'Akua’ba child figure',
		note: 'Surface points sampled from the published edition’s figure mesh.',
		sourceSlug: '4ze4q66v8wbs87n',
		sourceTitle: 'Akua’ba child figure'
	},
	{
		id: 'muffin',
		label: 'Muffin’s bones',
		title: 'Muffin’s Journey',
		note: 'Surface points sampled from the eleven published bone meshes in their edition positions, excluding photographs and maps.',
		sourceSlug: 'q24p5va0h2j106l',
		sourceTitle: 'Muffin’s Journey'
	},
	{
		id: 'bolex',
		label: 'Bolex',
		title: 'Bolex L8 Double 8mm Cine Film Camera',
		note: 'Surface points sampled from the published camera mesh, excluding documentary images and comparison models.',
		sourceSlug: 'a85366846edebc1',
		sourceTitle: 'Bolex L8'
	},
	{
		id: 'duwelsteene',
		label: '3D Düwelsteene',
		title: '3D Düwelsteene',
		note: 'Surface points sampled from the published 2017 monument mesh, excluding alternative reconstructions and maps.',
		sourceSlug: 'vidpkd5s7dp09oe',
		sourceTitle: '3D Düwelsteene'
	},
	{
		id: 'mexican-doll',
		label: 'Mexican doll',
		title: 'Lelé, the Mexican Rag Doll',
		note: 'Surface points sampled from the published doll mesh, excluding the map.',
		sourceSlug: 'q6kzym3qu84b030',
		sourceTitle: 'Lelé, the Mexican Rag Doll'
	},
	{
		id: 'diaconie-weeshuis',
		label: 'Diaconie Weeshuis',
		title: 'Diaconie Weeshuis',
		note: 'Surface points sampled from the published old-phase building reconstruction, excluding historical image planes.',
		sourceSlug: '9b6vrxpd42ezxq0',
		sourceTitle: 'Diaconie Weeshuis'
	}
];

export const CONCEPTUAL_PARTICLE_FORMS: ParticleForm[] = [
	{
		id: 'vessel',
		label: 'Vessel',
		title: 'A turned vessel',
		note: 'Surface points gathered in horizontal passes, the way a scanner records a ceramic object.'
	},
	{
		id: 'column',
		label: 'Column',
		title: 'An architectural member',
		note: 'A fluted column on its stylobate, at the scale of a building survey.'
	},
	{
		id: 'site',
		label: 'Site',
		title: 'An excavated landscape',
		note: 'Terrain, trenches, survey grid and wall footings, as photogrammetry records a site.'
	},
	{
		id: 'arch',
		label: 'Arch',
		title: 'A monumental arch',
		note: 'Piers, vault, voussoirs and attic of a single-bay arch, as a monument survey records them.'
	},
	{
		id: 'codex',
		label: 'Codex',
		title: 'An open manuscript',
		note: 'Two written pages lifted from the gutter, as close-range capture records a bound book.'
	},
	{
		id: 'fossil',
		label: 'Fossil',
		title: 'A coiled ammonite',
		note: 'A ribbed spiral shell on its mount, the kind of specimen natural-history collections digitise.'
	},
	{
		id: 'theatre',
		label: 'Theatre',
		title: 'A stepped theatre',
		note: 'Tiers of seating around an orchestra, divided by stairs, at the scale of an aerial survey.'
	}
];

export const PARTICLE_FORMS = [...EDITION_PARTICLE_FORMS, ...CONCEPTUAL_PARTICLE_FORMS];

export interface ParticleCloud {
	count: number;
	formDefinitions: ParticleForm[];
	/** One xyz array per form, in the order of `PARTICLE_FORMS`. */
	forms: Float32Array[];
	/** Unit vectors each particle travels along when the cloud disperses. */
	directions: Float32Array;
	/**
	 * x: stagger seed in 0..1, y: 1 for annotation-marker particles, z: 1 for the ambient dust that
	 * fills the space around the form.
	 */
	meta: Float32Array;
}

type Random = () => number;
type Sampler = (random: Random, out: Float32Array, index: number) => void;

const TAU = Math.PI * 2;
const SCAN_PASSES = 56;
const ANCHORS = 5;
const ANCHOR_POINTS = 36;
/** Share of the form particles that trace the turntable ring under every form. */
const RING_SHARE = 0.05;
const RING_RADIUS = 1.2;
const RING_Y = -1.04;
const RING_TICKS = 72;

function mulberry32(seed: number): Random {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function write(out: Float32Array, index: number, x: number, y: number, z: number) {
	out[index * 3] = x;
	out[index * 3 + 1] = y;
	out[index * 3 + 2] = z;
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Snaps a coordinate to the nearest scanner pass so parts of each form read as scan lines. */
function scanPass(value: number) {
	return Math.round(value * SCAN_PASSES) / SCAN_PASSES;
}

function boxPoint(
	random: Random,
	[cx, cy, cz]: readonly number[],
	[hx, hy, hz]: readonly number[]
): [number, number, number] {
	const faceX = hy * hz;
	const faceY = hx * hz;
	const pick = random() * (faceX + faceY + hx * hy);
	const side = random() < 0.5 ? -1 : 1;
	let x = (random() * 2 - 1) * hx;
	let y = (random() * 2 - 1) * hy;
	let z = (random() * 2 - 1) * hz;
	if (pick < faceX) x = side * hx;
	else if (pick < faceX + faceY) y = side * hy;
	else z = side * hz;
	return [cx + x, cy + y, cz + z];
}

function sampleBox(
	random: Random,
	out: Float32Array,
	index: number,
	centre: readonly number[],
	half: readonly number[]
) {
	write(out, index, ...boxPoint(random, centre, half));
}

// ---------- vessel ----------

const VESSEL_HEIGHT = 1.9;
const VESSEL_MAX_RADIUS = 0.56;

/** Profile radius from foot (0) to rim (1). */
function vesselRadius(t: number) {
	const belly = VESSEL_MAX_RADIUS * Math.pow(Math.sin(Math.PI * Math.min(t / 0.8, 1)), 0.7);
	const neck = t > 0.55 ? 0.13 + 0.1 * smoothstep(0.9, 1, t) : 0;
	const foot = t < 0.04 ? 0.17 : 0;
	return Math.max(belly, neck, foot);
}

const vesselY = (t: number) => (t - 0.5) * VESSEL_HEIGHT;

const sampleVessel: Sampler = (random, out, index) => {
	if (random() < 0.1) {
		// Handles: a quadratic curve from neck to shoulder, mirrored on both sides.
		const s = random();
		const u = 1 - s;
		const side = random() < 0.5 ? -1 : 1;
		const x = u * u * 0.13 + 2 * u * s * 0.6 + s * s * 0.41;
		const y = u * u * vesselY(0.86) + 2 * u * s * vesselY(1) + s * s * vesselY(0.63);
		write(
			out,
			index,
			side * x + (random() - 0.5) * 0.06,
			y + (random() - 0.5) * 0.06,
			(random() - 0.5) * 0.06
		);
		return;
	}
	// Sample the height in proportion to the circumference so the surface density stays even.
	let t = random();
	while (random() * VESSEL_MAX_RADIUS > vesselRadius(t)) t = random();
	if (random() < 0.45) t = scanPass(t);
	const radius = vesselRadius(t);
	const angle = random() * TAU;
	write(out, index, radius * Math.cos(angle), vesselY(t), radius * Math.sin(angle));
};

// ---------- column ----------

const SHAFT_BOTTOM = -0.66;
const SHAFT_HEIGHT = 1.2;

const sampleColumn: Sampler = (random, out, index) => {
	const pick = random();
	if (pick < 0.1) return sampleBox(random, out, index, [0, -0.9, 0], [0.72, 0.05, 0.56]);
	if (pick < 0.18) return sampleBox(random, out, index, [0, -0.8, 0], [0.58, 0.05, 0.46]);
	const angle = random() * TAU;
	if (pick < 0.24) {
		// Torus moulding at the foot of the shaft.
		const tube = random() * TAU;
		const ring = 0.34 + 0.05 * Math.cos(tube);
		write(out, index, ring * Math.cos(angle), -0.7 + 0.05 * Math.sin(tube), ring * Math.sin(angle));
		return;
	}
	if (pick < 0.74) {
		// Tapering shaft with twenty flutes.
		let y = SHAFT_BOTTOM + random() * SHAFT_HEIGHT;
		if (random() < 0.4) y = scanPass(y);
		const radius =
			0.3 - (0.05 * (y - SHAFT_BOTTOM)) / SHAFT_HEIGHT - 0.02 * Math.abs(Math.sin(10 * angle));
		write(out, index, radius * Math.cos(angle), y, radius * Math.sin(angle));
		return;
	}
	if (pick < 0.84) {
		// Echinus flaring out to the abacus.
		const s = random();
		const radius = 0.25 + 0.15 * Math.sqrt(s);
		write(out, index, radius * Math.cos(angle), 0.54 + s * 0.12, radius * Math.sin(angle));
		return;
	}
	sampleBox(random, out, index, [0, 0.72, 0], [0.42, 0.06, 0.42]);
};

// ---------- site ----------

const TRENCHES = [
	[-0.05, -0.25],
	[0.33, -0.25],
	[-0.05, 0.13],
	[0.33, 0.13]
];
const TRENCH_HALF = 0.16;
const TRENCH_DEPTH = 0.16;
const SITE_TILT = 0.5;
const SITE_SCALE = 0.92;

function terrain(x: number, z: number) {
	return (
		0.1 * Math.sin(1.7 * x + 0.4) * Math.cos(1.3 * z) +
		0.05 * Math.sin(3.1 * x + 2.3 * z) +
		0.025 * Math.sin(6.3 * z - 1.2 * x)
	);
}

function inTrench(x: number, z: number) {
	return TRENCHES.some(
		([cx, cz]) => Math.abs(x - cx) < TRENCH_HALF && Math.abs(z - cz) < TRENCH_HALF
	);
}

const sampleSite: Sampler = (random, out, index) => {
	const pick = random();
	let x: number;
	let y: number;
	let z: number;
	if (pick < 0.12) {
		// Vertical trench sections.
		const [cx, cz] = TRENCHES[Math.floor(random() * TRENCHES.length)];
		const side = Math.floor(random() * 4);
		const along = (random() * 2 - 1) * TRENCH_HALF;
		x = cx + (side === 0 ? -TRENCH_HALF : side === 1 ? TRENCH_HALF : along);
		z = cz + (side === 2 ? -TRENCH_HALF : side === 3 ? TRENCH_HALF : along);
		y = terrain(x, z) - random() * TRENCH_DEPTH;
	} else if (pick < 0.22) {
		// Low wall footings of a rectangular building.
		const walk = random() * 4;
		const side = Math.floor(walk);
		const f = walk - side;
		const [x0, x1, z0, z1] = [-0.85, -0.45, 0.3, 0.8];
		x = side === 0 ? x0 + (x1 - x0) * f : side === 1 ? x1 : side === 2 ? x1 - (x1 - x0) * f : x0;
		z = side === 0 ? z0 : side === 1 ? z0 + (z1 - z0) * f : side === 2 ? z1 : z1 - (z1 - z0) * f;
		x += (random() - 0.5) * 0.05;
		z += (random() - 0.5) * 0.05;
		y = terrain(x, z) + random() * 0.09;
	} else {
		x = random() * 2 - 1;
		z = random() * 2 - 1;
		// Part of the ground snaps to a survey grid draped over the terrain.
		if (random() < 0.35) {
			if (random() < 0.5) x = Math.round(x * 10) / 10;
			else z = Math.round(z * 10) / 10;
		}
		y = terrain(x, z) - (inTrench(x, z) ? TRENCH_DEPTH : 0);
	}
	// Tilt the plan towards the viewer so the excavation reads from the default camera.
	const cos = Math.cos(SITE_TILT);
	const sin = Math.sin(SITE_TILT);
	y -= 0.1;
	write(
		out,
		index,
		x * SITE_SCALE,
		(y * cos - z * sin) * SITE_SCALE,
		(y * sin + z * cos) * SITE_SCALE
	);
};

// ---------- arch ----------

const ARCH_HALF_WIDTH = 0.8;
const ARCH_DEPTH = 0.2;
const ARCH_BASE = -0.92;
const ARCH_TOP = 0.58;
const OPENING = 0.34;
/** Height at which the vault springs from the piers. */
const SPRING = 0.02;
const EXTRADOS = 0.52;
const VOUSSOIRS = 9;

function inOpening(x: number, y: number) {
	return y < SPRING ? Math.abs(x) < OPENING : x * x + (y - SPRING) ** 2 < OPENING ** 2;
}

const sampleArch: Sampler = (random, out, index) => {
	const pick = random();
	const face = random() < 0.5 ? -ARCH_DEPTH : ARCH_DEPTH;
	const height = ARCH_TOP - ARCH_BASE;
	if (pick < 0.42) {
		// Front and back faces of the piers and spandrels.
		let x: number;
		let y: number;
		do {
			x = (random() * 2 - 1) * ARCH_HALF_WIDTH;
			y = ARCH_BASE + random() * height;
			if (random() < 0.35) y = scanPass(y);
		} while (inOpening(x, y));
		write(out, index, x, y, face);
		return;
	}
	if (pick < 0.48) {
		// Outer ends of the piers.
		const side = random() < 0.5 ? -1 : 1;
		const y = ARCH_BASE + random() * height;
		write(out, index, side * ARCH_HALF_WIDTH, y, (random() * 2 - 1) * ARCH_DEPTH);
		return;
	}
	if (pick < 0.62) {
		// Soffit: the inner faces of the piers and the underside of the vault.
		const pier = SPRING - ARCH_BASE;
		const along = random() * (2 * pier + Math.PI * OPENING);
		let x = along < pier ? -OPENING : OPENING;
		let y = ARCH_BASE + (along % pier);
		if (along >= 2 * pier) {
			const angle = (along - 2 * pier) / OPENING;
			x = OPENING * Math.cos(angle);
			y = SPRING + OPENING * Math.sin(angle);
		}
		write(out, index, x, y, (random() * 2 - 1) * ARCH_DEPTH);
		return;
	}
	if (pick < 0.74) {
		// Voussoir joints and the extrados, cut into both faces.
		const joint = random() < 0.6;
		const angle = joint
			? (Math.ceil(random() * (VOUSSOIRS - 1)) / VOUSSOIRS) * Math.PI
			: random() * Math.PI;
		const radius = joint ? OPENING + random() * (EXTRADOS - OPENING) : EXTRADOS;
		write(out, index, radius * Math.cos(angle), SPRING + radius * Math.sin(angle), face * 1.02);
		return;
	}
	const side = random() < 0.5 ? -1 : 1;
	if (pick < 0.82) {
		// Engaged half-columns framing the opening.
		const angle = random() * Math.PI;
		write(
			out,
			index,
			side * 0.57 + 0.07 * Math.cos(angle),
			ARCH_BASE + random() * height,
			face + Math.sign(face) * 0.07 * Math.sin(angle)
		);
		return;
	}
	if (pick < 0.93) {
		// Attic storey above the vault.
		sampleBox(random, out, index, [0, ARCH_TOP + 0.13, 0], [0.88, 0.13, 0.26]);
	} else {
		// Plinths under the piers.
		sampleBox(random, out, index, [side * 0.57, ARCH_BASE - 0.04, 0], [0.27, 0.04, 0.26]);
	}
};

// ---------- codex ----------

const PAGE_WIDTH = 0.8;
const PAGE_HEIGHT = 1.36;
const TEXT_LINES = 22;
/** Leans the open book towards the viewer, as on a lectern. */
const BOOK_TILT = 1.02;

/** Height of a page above the boards, from the gutter (0) to the fore-edge (1). */
const pageLift = (u: number) => 0.2 * Math.sqrt(u) * (1 - 0.4 * u);

const sampleCodex: Sampler = (random, out, index) => {
	const pick = random();
	let side = random() < 0.5 ? -1 : 1;
	let u = random();
	let v = random() * 2 - 1;
	let y: number;
	if (pick < 0.34) {
		// Lines of writing inside the margins, broken into words.
		do {
			u = 0.12 + random() * 0.76;
			v = -0.84 + (Math.floor(random() * TEXT_LINES) / (TEXT_LINES - 1)) * 1.64;
		} while (Math.sin(u * 41 + v * 23 + side * 3) > 0.55);
		y = pageLift(u) + 0.004;
	} else if (pick < 0.66) {
		y = pageLift(u);
	} else if (pick < 0.8) {
		// The page block seen at the head, tail and fore-edge, one line per gathering.
		if (random() < 0.4) u = 1;
		else v = random() < 0.5 ? -1 : 1;
		y = (pageLift(u) * Math.round(random() * 6)) / 6;
	} else if (pick < 0.96) {
		// Boards, a little larger than the pages.
		u *= 1.07;
		v *= 1.05;
		y = -0.03;
	} else {
		// A ribbon marker laid across the right-hand page and hanging past the tail.
		side = 1;
		v = -1 + random() * 2.25;
		u = 0.3 + 0.06 * v;
		y = v > 1 ? -0.03 : pageLift(u) + 0.008;
	}
	const x = side * u * PAGE_WIDTH;
	const z = (v * PAGE_HEIGHT) / 2;
	const lifted = y - 0.05;
	const cos = Math.cos(BOOK_TILT);
	const sin = Math.sin(BOOK_TILT);
	write(out, index, x, lifted * cos - z * sin, lifted * sin + z * cos);
};

// ---------- fossil ----------

const SHELL_TURNS = 3.2;
/** Each whorl is 2.2 times the size of the one inside it. */
const SHELL_GROWTH = Math.log(2.2) / TAU;
const SHELL_RADIUS = 0.7;
const SHELL_RIBS = 26;
const SHELL_Y = 0.04;

const sampleFossil: Sampler = (random, out, index) => {
	if (random() < 0.06) return sampleBox(random, out, index, [0, -0.93, 0], [0.24, 0.03, 0.11]);
	const end = SHELL_TURNS * TAU;
	// Surface area grows with the square of the coil radius, so the angle is sampled to match.
	let theta = Math.log(1 + random() * (Math.exp(2 * SHELL_GROWTH * end) - 1)) / (2 * SHELL_GROWTH);
	// Part of the shell snaps to rib positions, which draws the ribs.
	if (random() < 0.45) {
		theta = Math.min(end, (Math.round((theta / TAU) * SHELL_RIBS) * TAU) / SHELL_RIBS);
	}
	const coil = SHELL_RADIUS * Math.exp(SHELL_GROWTH * (theta - end));
	const tube = coil * 0.3;
	// The inner side of each whorl lies against the previous one, so it is left out.
	const phi = (random() * 2 - 1) * Math.PI * 0.7;
	const radial = coil + tube * Math.cos(phi);
	write(
		out,
		index,
		radial * Math.cos(theta),
		SHELL_Y + radial * Math.sin(theta),
		tube * 0.85 * Math.sin(phi)
	);
};

// ---------- theatre ----------

const TIERS = 11;
const CAVEA_INNER = 0.34;
const CAVEA_OUTER = 1;
const TIER_RISE = 0.07;
const THEATRE_BASE = -0.6;
/** The seating wraps a little past a half circle, as in a Greek theatre. */
const CAVEA_SPREAD = 0.2;
const WEDGES = 7;
const THEATRE_TILT = 0.28;

const sampleTheatre: Sampler = (random, out, index) => {
	const pick = random();
	const span = Math.PI + 2 * CAVEA_SPREAD;
	const top = THEATRE_BASE + TIERS * TIER_RISE;
	let x: number;
	let y: number;
	let z: number;
	if (pick < 0.7) {
		// Stepped seating, split into wedges by stairs; the area of a tier grows with its radius.
		let wedge: number;
		do {
			wedge = random() * WEDGES;
		} while (wedge % 1 < 0.07);
		const angle = -CAVEA_SPREAD + (wedge / WEDGES) * span;
		const depth = (CAVEA_OUTER - CAVEA_INNER) / TIERS;
		const radius = Math.sqrt(CAVEA_INNER ** 2 + random() * (CAVEA_OUTER ** 2 - CAVEA_INNER ** 2));
		const tier = Math.min(TIERS - 1, Math.floor((radius - CAVEA_INNER) / depth));
		const riser = random() < 0.35;
		const r = riser ? CAVEA_INNER + tier * depth : radius;
		y = THEATRE_BASE + (tier + (riser ? random() : 1)) * TIER_RISE;
		x = r * Math.cos(angle);
		z = -r * Math.sin(angle);
	} else if (pick < 0.8) {
		// Orchestra floor and its kerb.
		const r = CAVEA_INNER * 0.9 * (random() < 0.4 ? 1 : Math.sqrt(random()));
		const angle = random() * TAU;
		x = r * Math.cos(angle);
		y = THEATRE_BASE;
		z = r * Math.sin(angle);
	} else if (pick < 0.92) {
		// Stage building closing the view.
		[x, y, z] = boxPoint(random, [0, THEATRE_BASE + 0.13, 0.46], [0.78, 0.13, 0.06]);
	} else {
		// Colonnade crowning the top tier: posts and a continuous beam.
		const post = random() < 0.6;
		const angle = -CAVEA_SPREAD + (post ? Math.floor(random() * 25) / 24 : random()) * span;
		x = CAVEA_OUTER * Math.cos(angle);
		y = top + (post ? random() * 0.16 : 0.16);
		z = -CAVEA_OUTER * Math.sin(angle);
	}
	// Centre the plan and tip it towards the viewer so the bowl reads from the default camera.
	z += 0.22;
	const cos = Math.cos(THEATRE_TILT);
	const sin = Math.sin(THEATRE_TILT);
	write(out, index, x, y * cos - z * sin, y * sin + z * cos);
};

const SAMPLERS: Record<string, Sampler> = {
	vessel: sampleVessel,
	column: sampleColumn,
	site: sampleSite,
	arch: sampleArch,
	codex: sampleCodex,
	fossil: sampleFossil,
	theatre: sampleTheatre
};

/** A dashed turntable ring with graduation ticks, shared by every form. */
function sampleRing(random: Random): [number, number, number] {
	if (random() < 0.22) {
		const tick = Math.floor(random() * RING_TICKS);
		const angle = (tick / RING_TICKS) * TAU;
		const length = tick % 6 === 0 ? 0.11 : 0.045;
		const radius = RING_RADIUS + random() * length;
		return [radius * Math.cos(angle), RING_Y, radius * Math.sin(angle)];
	}
	let angle = random() * TAU;
	// Leave short gaps so the ring reads as a measured scale rather than a solid hoop.
	const segment = TAU / 48;
	if (angle % segment > segment * 0.78) angle -= segment * 0.3;
	const radius = RING_RADIUS + (random() - 0.5) * 0.012;
	return [radius * Math.cos(angle), RING_Y, radius * Math.sin(angle)];
}

/**
 * Dust lies in a unit cylinder; the shader scales it to the camera so it fills the frame at any
 * aspect ratio.
 */
function sampleDust(random: Random): [number, number, number] {
	const radius = Math.sqrt(random());
	const angle = random() * TAU;
	return [radius * Math.cos(angle), random() * 2 - 1, radius * Math.sin(angle)];
}

export interface CloudOptions {
	/** Particles gathered into each annotation cluster. */
	anchorPoints?: number;
	/** Radius of an annotation cluster in model space. */
	anchorRadius?: number;
	/** Pre-sampled positions for edition forms, keyed by form id. */
	editionPoints?: Readonly<Record<string, Float32Array>>;
}

/**
 * Builds every form for the same particles, so particle `i` has a place in each form and can travel
 * between them. The first particles gather into small clusters that stand for annotations; the ring
 * and dust keep the same place in every form.
 */
export function buildParticleCloud(
	formCount: number,
	dustCount: number,
	{ anchorPoints = ANCHOR_POINTS, anchorRadius = 0.035, editionPoints = {} }: CloudOptions = {}
): ParticleCloud {
	const random = mulberry32(20260927);
	const count = formCount + dustCount;
	const markers = ANCHORS * anchorPoints;
	const ringEnd = markers + Math.round(formCount * RING_SHARE);
	const fixed = new Float32Array(count * 3);
	for (let i = markers; i < ringEnd; i++) write(fixed, i, ...sampleRing(random));
	for (let i = formCount; i < count; i++) write(fixed, i, ...sampleDust(random));

	const formDefinitions = EDITION_PARTICLE_FORMS.filter(({ id }) => editionPoints[id]?.length);
	const forms = formDefinitions.map(({ id }) => {
		const edition = editionPoints[id];
		const sample = edition
			? (_random: Random, out: Float32Array, index: number) => {
					const source = ((index - ringEnd) % (edition.length / 3)) * 3;
					write(out, index, edition[source], edition[source + 1], edition[source + 2]);
				}
			: SAMPLERS[id];
		if (!sample) throw new Error(`Particle form has no sampler: ${id}`);
		const out = new Float32Array(count * 3);
		out.set(fixed.subarray(markers * 3, ringEnd * 3), markers * 3);
		out.set(fixed.subarray(formCount * 3), formCount * 3);
		for (let i = ringEnd; i < formCount; i++) sample(random, out, i);
		for (let anchor = 0; anchor < ANCHORS; anchor++) {
			const source = (ringEnd + Math.floor(random() * (formCount - ringEnd))) * 3;
			for (let k = 0; k < anchorPoints; k++) {
				const radius = anchorRadius * Math.cbrt(random());
				const angle = random() * TAU;
				const lift = random() * 2 - 1;
				const ring = Math.sqrt(1 - lift * lift) * radius;
				write(
					out,
					anchor * anchorPoints + k,
					out[source] + ring * Math.cos(angle),
					out[source + 1] + lift * radius,
					out[source + 2] + ring * Math.sin(angle)
				);
			}
		}
		return out;
	});

	const directions = new Float32Array(count * 3);
	const meta = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const angle = random() * TAU;
		const lift = random() * 2 - 1;
		const ring = Math.sqrt(1 - lift * lift);
		write(directions, i, ring * Math.cos(angle), lift, ring * Math.sin(angle));
		write(meta, i, random(), i < markers ? 1 : 0, i >= formCount ? 1 : 0);
	}

	return { count, formDefinitions, forms, directions, meta };
}
