/** An embedding page can deny gamepad access even when the API exists. */
export function readGamepad(standardOnly = false): Gamepad | undefined {
  try {
    return navigator.getGamepads?.().find((p): p is Gamepad => !!p?.connected && (!standardOnly || p.mapping === 'standard'));
  } catch {
    return undefined;
  }
}
