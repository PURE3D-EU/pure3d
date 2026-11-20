export const QUESTIONNAIRE_WORD_LIMIT = 300;
export const MODEL_RIGHTS_QUESTION =
	'Do you have the necessary rights or permissions to include, reproduce, adapt, and publish the 3D model(s) and all other multimedia materials intended for the 3D edition? If not, please explain.';
export const OBJECT_LINKS_LABEL = 'Links to the object you want to use for your 3D Edition';

export const PROPOSAL_AUDIENCES = [
	['general-public', 'General public'],
	['academics', 'Academics'],
	['specialists', 'Specialists / non-academics'],
	['primary-students', 'Primary students'],
	['secondary-students', 'Secondary students'],
	['university-students', 'University students']
] as const;

export const MODEL_SOURCES = [
	['computer-graphic-reconstruction', 'Computer graphic reconstruction'],
	['structured-light-scan', 'Structured light scan'],
	['medical-xray-computed-tomography', 'Medical X-ray computed tomography'],
	['photogrammetry', 'Photogrammetry'],
	['ct-scan', 'CT scan'],
	['magnetic-resonance-imaging', 'Magnetic resonance imaging'],
	['confocal-image-stacking', 'Confocal image stacking'],
	['infrared-scanning', 'Infrared scanning'],
	['micro-xray-computed-tomography', 'Micro X-ray computed tomography']
] as const;

export type ProposalData = {
	proposalOpenCall: string;
	title: string;
	credits: Array<{ role?: string }>;
	purpose: string;
	modelReferences: string;
	argument: string;
	threeDRationale: string;
	audiences: string[];
	contextualMaterial: string;
	hasExistingModel: boolean;
	modelSources: string[];
	copyrightOwnership: string;
	digitisationSituation: string;
	hasModelFile: boolean;
	supportingLinks?: string[];
};

export type ProposalOpenCallSnapshot = {
	id: string;
	title: string;
	deadline: string;
};

export function formatOpenCallDeadline(deadline: string): string {
	const date = new Date(deadline);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}

const writtenFields: Array<
	[
		keyof Pick<
			ProposalData,
			'purpose' | 'modelReferences' | 'argument' | 'threeDRationale' | 'contextualMaterial'
		>,
		string
	]
> = [
	['purpose', 'Purpose'],
	['modelReferences', 'Model links and published materials'],
	['argument', 'Narrative or story'],
	['threeDRationale', 'Why 3D is appropriate'],
	['contextualMaterial', 'Contextual material description']
];

export function wordCount(value: string): number {
	return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function proposalErrors(proposal: ProposalData): string[] {
	if (!proposal.title.trim()) return ['Title is required.'];
	if (!proposal.credits.some((credit) => credit.role === 'creator'))
		return ['Add at least one author.'];
	for (const [field, label] of writtenFields) {
		if (field !== 'modelReferences' && !proposal[field].trim()) return [`${label} is required.`];
		if (wordCount(proposal[field]) > QUESTIONNAIRE_WORD_LIMIT)
			return [`${label} must be ${QUESTIONNAIRE_WORD_LIMIT} words or fewer.`];
	}
	if (proposal.audiences.length === 0) return ['Select at least one intended audience.'];
	if (proposal.hasExistingModel) {
		if (!proposal.hasModelFile) return ['Upload an existing 3D model before submitting.'];
		if (proposal.modelSources.length === 0) return ['Select at least one model source.'];
		if (!proposal.copyrightOwnership.trim())
			return ['Explain rights and permissions.'];
		if (wordCount(proposal.copyrightOwnership) > 150)
			return ['Rights and permissions must be 150 words or fewer.'];
	} else {
		if (!proposal.digitisationSituation.trim()) return ['Describe the digitisation situation.'];
		if (wordCount(proposal.digitisationSituation) > 150)
			return ['Digitisation situation must be 150 words or fewer.'];
	}
	if (proposal.supportingLinks?.some((link) => !isProposalLink(link)))
		return ['Supporting links must be valid HTTP or HTTPS URLs.'];
	return [];
}

export function isProposalLink(value: string): boolean {
	try {
		const url = new URL(value);
		return ['https:', 'http:'].includes(url.protocol);
	} catch {
		return false;
	}
}

export function proposalIsDirty(saved: string, current: string): boolean {
	return saved !== current;
}
