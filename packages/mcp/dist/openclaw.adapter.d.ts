type OpenClawLogger = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
};
type OpenClawRuntime = {
    state: {
        resolveStateDir: () => string;
    };
    stt?: {
        transcribeAudioFile: (input: {
            path: string;
        }) => Promise<{
            text?: string;
        } | string>;
    };
};
type OpenClawToolRegistration = {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type OpenClawPluginApi = {
    logger: OpenClawLogger;
    runtime: OpenClawRuntime;
    pluginConfig?: Record<string, unknown>;
    registerService: (service: {
        id: string;
        start: () => Promise<void>;
        stop: () => Promise<void>;
    }) => void;
    registerCommand: (command: {
        name: string;
        description: string;
        acceptsArgs?: boolean;
        handler: (ctx: {
            args?: string;
        }) => Promise<{
            text: string;
        }>;
    }) => void;
    registerTool: (tool: OpenClawToolRegistration, options?: {
        optional?: boolean;
    }) => void;
};
export declare function registerOpenClawTools(api: OpenClawPluginApi, deviceName?: string): void;
export default registerOpenClawTools;
