export interface CLITool {
    name: "claudecode" | "codex" | "gemini" | "openclaw";
    command: string;
    resolvedPath: string;
    version: string;
    loggedIn: boolean;
    priority: number;
}
export declare function detectCLITools(): Promise<CLITool[]>;
export declare function detectBestCLI(): Promise<CLITool | null>;
export declare function formatDetectedTools(tools: CLITool[]): string;
