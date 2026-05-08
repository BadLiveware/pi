import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { defaultCompatConfig, loadCompatConfig } from "./src/config.ts";
import { resolveCompatState } from "./src/resolver.ts";
import type { LoadedCompatConfig } from "./src/types.ts";

function tempRepo(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-multi-harness-compat-"));
}

function write(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

function loaded(config: LoadedCompatConfig["config"], repoRoot?: string): LoadedCompatConfig {
	return { config, paths: [], diagnostics: [], repoRoot };
}

function makeRepo(root: string): void {
	fs.mkdirSync(path.join(root, ".git"), { recursive: true });
}

describe("multi-harness compatibility resolver", () => {
	it("honors profile overrides that disable Claude and Cursor resources", () => {
		const cwd = tempRepo();
		write(path.join(cwd, "AGENTS.md"), "# Agent rules");
		write(path.join(cwd, "CLAUDE.md"), "# Claude rules");
		write(path.join(cwd, ".cursor", "rules", "org.mdc"), "Always use org rules");

		const state = resolveCompatState(cwd, loaded({ defaultProfile: "private", profiles: { private: { pi: true, claude: false, cursor: false } } }, cwd));

		assert.equal(state.activeProfile.name, "private");
		assert.equal(state.loaded.filter((item) => item.type === "cursor-rule").length, 0);
		assert.match(state.contextText, /Agent rules/);
		assert.doesNotMatch(state.contextText, /Claude rules/);
	});

	it("activates an org profile by cwd path and loads Cursor rules", () => {
		const cwd = tempRepo();
		write(path.join(cwd, "AGENTS.md"), "# Agent rules");
		write(path.join(cwd, ".cursor", "rules", "typescript.mdc"), "Use strict TypeScript.");

		const state = resolveCompatState(cwd, loaded({
			defaultProfile: "private",
			profiles: {
				org: { match: { paths: [`${cwd}/**`] }, pi: true, cursor: true },
				private: { pi: true, cursor: false },
			},
		}, cwd));

		assert.equal(state.activeProfile.name, "org");
		assert.equal(state.loaded.filter((item) => item.type === "cursor-rule").length, 1);
		assert.match(state.contextText, /Use strict TypeScript/);
	});

	it("collapses CLAUDE.md when it is an alias to AGENTS.md", () => {
		const cwd = tempRepo();
		write(path.join(cwd, "AGENTS.md"), "# Shared rules");
		write(path.join(cwd, "CLAUDE.md"), "@AGENTS.md\n");

		const state = resolveCompatState(cwd, loaded({ defaultProfile: "org", profiles: { org: { pi: true, claude: true } } }, cwd));

		assert.equal(state.loaded.filter((item) => item.type === "context").length, 1);
		assert.equal(state.suppressed.some((item) => item.path.endsWith("CLAUDE.md") && item.reason === "alias include"), true);
		assert.match(state.contextText, /Shared rules/);
	});

	it("deduplicates skills by frontmatter name", () => {
		const cwd = tempRepo();
		write(path.join(cwd, ".claude", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review code.\n---\n# Review\n");
		write(path.join(cwd, ".cursor", "skills", "review-copy", "SKILL.md"), "---\nname: review\ndescription: Review code too.\n---\n# Review copy\n");

		const state = resolveCompatState(cwd, loaded({ defaultProfile: "org", profiles: { org: { pi: true, claude: true, cursor: true, agents: true } } }, cwd));

		assert.equal(state.skillPaths.length, 1);
		assert.equal(state.suppressed.some((item) => item.type === "skill" && item.reason === "duplicate skill name review"), true);
	});

	it("loads in-repo neutral, Claude, and Cursor resources by default from a subdirectory", () => {
		const root = tempRepo();
		const cwd = path.join(root, "packages", "app");
		makeRepo(root);
		fs.mkdirSync(cwd, { recursive: true });
		write(path.join(root, "AGENTS.md"), "# Repo agent rules");
		write(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
		write(path.join(root, ".agents", "skills", "neutral", "SKILL.md"), "---\nname: neutral\ndescription: Neutral skill.\n---\n# Neutral\n");
		write(path.join(root, ".claude", "skills", "claude-only", "SKILL.md"), "---\nname: claude-only\ndescription: Claude skill.\n---\n# Claude\n");
		write(path.join(root, ".cursor", "rules", "repo.mdc"), "Use repo Cursor rules.");

		const state = resolveCompatState(cwd, loaded(defaultCompatConfig(), root));

		assert.equal(state.repoRoot, root);
		assert.match(state.contextText, /Repo agent rules/);
		assert.match(state.contextText, /Use repo Cursor rules/);
		assert.equal(state.suppressed.some((item) => item.path.endsWith("CLAUDE.md") && item.reason === "alias include"), true);
		assert.equal(state.skillPaths.length, 2);
		assert.equal(state.loaded.some((item) => item.kind === "agents" && item.name === "neutral"), true);
		assert.equal(state.loaded.some((item) => item.kind === "claude" && item.name === "claude-only"), true);
	});

	it("merges inherited template profiles", () => {
		const cwd = tempRepo();
		const skillFile = path.join(cwd, "standalone", "odd-parent", "SKILL.md");
		write(skillFile, "---\nname: inherited-skill\ndescription: Inherited skill.\n---\n# Inherited\n");

		const state = resolveCompatState(cwd, loaded({
			defaultProfile: "personal",
			profiles: {
				global: { skillDirs: [skillFile], cursor: false },
				personal: { inherit: ["global"], cursor: true },
			},
		}, cwd));

		assert.equal(state.activeProfile.name, "personal");
		assert.equal(state.loaded.some((item) => item.type === "skill" && item.name === "inherited-skill"), true);
		assert.equal(state.activeProfile.profile.cursor, true);
	});

	it("loads exact standalone skill files configured in skillDirs", () => {
		const cwd = tempRepo();
		const skillFile = path.join(cwd, "standalone", "odd-parent", "SKILL.md");
		write(skillFile, "---\nname: standalone-skill\ndescription: Standalone skill.\n---\n# Standalone\n");

		const state = resolveCompatState(cwd, loaded({ defaultProfile: "personal", profiles: { personal: { skillDirs: [skillFile] } } }, cwd));

		assert.equal(state.skillPaths.length, 1);
		assert.equal(state.loaded.some((item) => item.type === "skill" && item.name === "standalone-skill" && item.realPath === skillFile), true);
	});

	it("loads repo config while starting from a nested directory", () => {
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		const agentDir = tempRepo();
		const root = tempRepo();
		const cwd = path.join(root, "src", "feature");
		try {
			process.env.PI_CODING_AGENT_DIR = agentDir;
			makeRepo(root);
			fs.mkdirSync(cwd, { recursive: true });
			write(path.join(root, ".pi", "multi-harness-compatibility.json"), JSON.stringify({ profiles: { private: { pi: true, claude: false, cursor: false, agents: false } } }));
			write(path.join(root, "AGENTS.md"), "# Repo rules");
			write(path.join(root, "CLAUDE.md"), "# Should be disabled");
			write(path.join(root, ".cursor", "rules", "disabled.mdc"), "Should be disabled");

			const config = loadCompatConfig(cwd);
			const state = resolveCompatState(cwd, config);

			assert.deepEqual(config.paths, [path.join(root, ".pi", "multi-harness-compatibility.json")]);
			assert.equal(config.repoRoot, root);
			assert.match(state.contextText, /Repo rules/);
			assert.doesNotMatch(state.contextText, /Should be disabled/);
			assert.equal(state.loaded.some((item) => item.type === "cursor-rule"), false);
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});
});
