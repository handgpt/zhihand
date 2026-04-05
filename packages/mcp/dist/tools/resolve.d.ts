import { type DeviceState } from "../core/registry.ts";
export type ResolveResult = {
    state: DeviceState;
} | {
    error: string;
};
export declare function resolveTargetDevice(deviceId: string | undefined): ResolveResult;
