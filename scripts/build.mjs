/**
 * Local fork build: transpiles src/client.ts -> lib/client.js (the browser
 * bundle served through the `dsh.client` manifest).
 *
 * The upstream npm package ships only `lib`, `src` and `cordis.patch.yml`,
 * so the original build script was not vendored. This one reproduces the
 * shipped output shape: a single `window.__ModuleLoader__.load({...})`
 * wrapper with type annotations stripped and ESM/TS syntax lowered.
 *
 * Usage: node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Resolve TypeScript from any nearby install (project-local, then fallbacks). */
function loadTypeScript() {
	const require = createRequire(import.meta.url);
	const candidates = [
		"typescript",
		`${process.env.HOME}/easy-coder/node_modules/typescript`,
		`${process.env.HOME}/.dsh/runtime/node_modules/typescript`
	];
	for (const id of candidates) {
		try {
			return require(id);
		} catch {}
	}
	throw new Error("typescript not found; install it or set an explicit path");
}

const ts = loadTypeScript();

function transpile({ input, output, module, validate }) {
	const source = readFileSync(resolve(root, input), "utf8");
	const result = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2020,
			module,
			removeComments: false,
			newLine: ts.NewLineKind.LineFeed
		},
		fileName: input,
		reportDiagnostics: true
	});
	const errors = (result.diagnostics ?? []).filter((d) => d.category === 1);
	if (errors.length > 0) {
		for (const d of errors) {
			console.error("error:", ts.flattenDiagnosticMessageText(d.messageText, " "));
		}
		process.exit(1);
	}
	validate?.(result.outputText);
	writeFileSync(resolve(root, output), result.outputText);
	console.log(`built ${input} -> ${output} (${result.outputText.length} bytes, typecheck OK)`);
}

mkdirSync(resolve(root, "lib"), { recursive: true });

transpile({
	input: "src/index.ts",
	output: "lib/index.js",
	module: ts.ModuleKind.ES2020
});

transpile({
	input: "src/client.ts",
	output: "lib/client.js",
	module: ts.ModuleKind.None,
	validate: (output) => {
		if (!output.includes("__ModuleLoader__")) {
			throw new Error("client build produced no ModuleLoader wrapper — refusing to write");
		}
	}
});
