/** What can be told about the device from the browser, gathered in one place so the rules can be tested. */
export interface DeviceHints {
  userAgent: string;
  maxTouchPoints: number;
  /** The main pointer is a finger (CSS `pointer: coarse`) and nothing can hover. */
  coarse: boolean;
}

/** Reads the hints from the browser. Safe where there is no browser (tests): everything comes back empty. */
export function deviceHints(): DeviceHints {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  let coarse = false;
  try {
    coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    // No media queries: go by the user agent alone.
  }
  return { userAgent: nav?.userAgent ?? '', maxTouchPoints: nav?.maxTouchPoints ?? 0, coarse };
}

/**
 * A phone: touch only, a small screen, and a fraction of the graphics power the default quality was tuned
 * for. Tablets are not counted (an iPad says it is a Mac, and the bigger ones cope with more).
 */
export function isPhone(d: DeviceHints): boolean {
  const ua = d.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/Android/.test(ua)) return /Mobile/.test(ua);
  return /Windows Phone|IEMobile|BlackBerry|Opera Mini/.test(ua);
}

/** Touch is the main way in (phones and tablets): the on-screen controller is there from the start. */
export function isTouchFirst(d: DeviceHints): boolean {
  if (isPhone(d)) return true;
  const ua = d.userAgent;
  // iPadOS asks for desktop sites by calling itself a Mac; real Macs have no touch points.
  if (/iPad|Android/.test(ua) || (/Macintosh/.test(ua) && d.maxTouchPoints > 1)) return true;
  return d.maxTouchPoints > 0 && d.coarse;
}
