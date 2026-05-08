export type SourceKind = "pi" | "claude" | "cursor" | "agents";

export interface CompatMatchConfig {
	paths?: string[];
	gitRemotes?: string[];
	markerFiles?: string[];
}

export interface CompatProfileConfig {
	inherit?: string[];
	match?: CompatMatchConfig;
	roots?: string[];
	pi?: boolean;
	claude?: boolean;
	cursor?: boolean;
	agents?: boolean;
	includeGlobalPiContext?: boolean;
	contextFiles?: string[];
	skillDirs?: string[];
	cursorRuleDirs?: string[];
}

export interface CompatConfig {
	defaultProfile?: string;
	profiles?: Record<string, CompatProfileConfig>;
}

export interface LoadedCompatConfig {
	config: CompatConfig;
	paths: string[];
	diagnostics: string[];
	repoRoot?: string;
}

export interface ActiveProfile {
	name: string;
	profile: CompatProfileConfig;
	reason: string;
}

export interface CompatResource {
	kind: SourceKind;
	type: "context" | "skill" | "cursor-rule";
	path: string;
	realPath?: string;
	name?: string;
	contentHash?: string;
	status: "loaded" | "suppressed";
	reason?: string;
	aliasTarget?: string;
}

export interface ResolvedCompatState {
	cwd: string;
	repoRoot?: string;
	activeProfile: ActiveProfile;
	contextText: string;
	skillPaths: string[];
	loaded: CompatResource[];
	suppressed: CompatResource[];
	diagnostics: string[];
}
