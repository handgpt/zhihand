export declare function isZhiHandPluginInstalled(): Promise<boolean>;
export declare function installZhiHandPlugin(options?: {
    timeoutMs?: number;
    autoConfirm?: boolean;
}): Promise<boolean>;
export declare function detectAndSetupOpenClaw(): Promise<void>;
