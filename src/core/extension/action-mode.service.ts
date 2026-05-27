export type ExtensionActionMode = "popup" | "sidepanel";

const ACTION_MODE_STORAGE_KEY = "simple.actionMode";

export async function getExtensionActionMode(): Promise<ExtensionActionMode> {
  const result = await chrome.storage.local.get(ACTION_MODE_STORAGE_KEY);
  const value = result[ACTION_MODE_STORAGE_KEY];

  return value === "sidepanel" ? "sidepanel" : "popup";
}

export async function setExtensionActionMode(
  mode: ExtensionActionMode,
): Promise<void> {
  await chrome.storage.local.set({
    [ACTION_MODE_STORAGE_KEY]: mode,
  });

  await applyExtensionActionMode(mode);
}

export async function applyExtensionActionMode(
  mode?: ExtensionActionMode,
): Promise<void> {
  const resolvedMode = mode ?? (await getExtensionActionMode());

  await chrome.action.setPopup({
    popup:
      resolvedMode === "sidepanel"
        ? "sidepanel-launcher.html"
        : "popup.html",
  });
}
