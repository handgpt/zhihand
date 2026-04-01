export declare function isAlreadyRunning(): number | null;
export declare function startDaemon(options?: {
    port?: number;
    deviceName?: string;
}): Promise<void>;
export declare function stopDaemon(): boolean;
