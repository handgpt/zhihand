import type { BackendName } from "../core/config.ts";
/**
 * Configure MCP for the selected backend and remove from others.
 */
export declare function configureMCP(backend: BackendName, previousBackend: BackendName | null): {
    configured: boolean;
    removed: boolean;
};
export declare function displayName(backend: BackendName): string;
