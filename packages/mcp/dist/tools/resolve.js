import { registry } from "../core/registry.js";
export function resolveTargetDevice(deviceId) {
    const online = registry.listOnline();
    if (deviceId) {
        const s = registry.get(deviceId);
        if (!s) {
            return { error: `Device '${deviceId}' not found. Call zhihand_list_devices.` };
        }
        if (!s.online) {
            return { error: `Device '${deviceId}' is offline. Call zhihand_list_devices for online devices.` };
        }
        return { state: s };
    }
    if (online.length === 0) {
        return { error: "No devices online. Ask user to open the ZhiHand app." };
    }
    if (online.length === 1) {
        return { state: online[0] };
    }
    const ids = online.map((d) => `${d.credentialId} (${d.label})`).join(", ");
    return { error: `Multiple devices online — pass device_id. Online: ${ids}` };
}
