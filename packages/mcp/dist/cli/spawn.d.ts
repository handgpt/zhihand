import type { CLITool } from "./detect.ts";
export interface SpawnOptions {
    model?: string;
    timeout?: number;
}
/**
 * Spawn a CLI tool interactively, inheriting stdio.
 * Returns the exit code.
 */
export declare function spawnInteractive(command: string, args: string[], options?: {
    timeout?: number;
    env?: Record<string, string>;
}): Promise<number>;
/**
 * Launch a CLI tool with a prompt. For Gemini, uses interactive mode (-i).
 * For others, uses their respective prompt flags.
 */
export declare function launchCLI(tool: CLITool, prompt: string, options?: SpawnOptions): Promise<number>;
/**
 * Non-interactive spawn that captures output (for MCP-initiated tasks).
 * Uses spawnSync with argument arrays to avoid shell injection.
 */
export declare function spawnCLITask(tool: CLITool, prompt: string): string;
