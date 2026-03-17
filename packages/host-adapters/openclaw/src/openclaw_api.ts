export type OpenClawLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type OpenClawRuntime = {
  state: {
    resolveStateDir: () => string;
  };
  stt?: {
    transcribeAudioFile: (input: { path: string }) => Promise<{ text?: string } | string>;
  };
};

export type OpenClawCommandContext = {
  args?: string;
};

export type OpenClawToolRegistration = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type OpenClawPluginApi = {
  logger: OpenClawLogger;
  runtime: OpenClawRuntime;
  pluginConfig?: Record<string, unknown>;
  registerService: (service: { id: string; start: () => Promise<void>; stop: () => Promise<void> }) => void;
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: OpenClawCommandContext) => Promise<{ text: string }>;
  }) => void;
  registerTool: (tool: OpenClawToolRegistration, options?: { optional?: boolean }) => void;
};
