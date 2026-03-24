export const ZHIHAND_PLUGIN_ID = "zhihand";
export const LEGACY_ZHIHAND_PLUGIN_ID = "openclaw";
export const ZHIHAND_CLAWHUB_PACKAGE_NAME = "zhihand";

export function formatPluginConfigPath(pluginId: string = ZHIHAND_PLUGIN_ID): string {
  return `plugins.entries.${pluginId}.config`;
}

export function formatPluginConfigSettingPath(
  setting: string,
  pluginId: string = ZHIHAND_PLUGIN_ID
): string {
  return `${formatPluginConfigPath(pluginId)}.${setting}`;
}
