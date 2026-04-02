/**
 * Resolve an executable by name: first try `which`, then check fallback paths.
 * Supports a single `*` glob segment in fallback paths (for version directories).
 * Returns the full path, or the bare name as last resort.
 */
export declare function resolveExecutable(name: string, fallbackPaths: string[]): string;
/** Platform-specific fallback paths for gemini */
export declare function resolveGemini(): string;
/** Platform-specific fallback paths for claude */
export declare function resolveClaude(): string;
/** Platform-specific fallback paths for codex */
export declare function resolveCodex(): string;
