/**
 * Makes the page behave like a game rather than a document on a touch screen, Mobile Safari above all: no
 * scrolling or rubber-band bounce, no pinch or double-tap zoom, no text selection or long-press menu, the
 * drawing surface kept in step with the visible area as the address bar comes and goes or the phone is turned.
 *
 * All of it is done from script so index.html and the main stylesheet stay as they are; the CSS half is in
 * touch.css under `html.q03-page`.
 */

/** `viewport-fit=cover` lets the game run under the notch; the controller keeps itself inside the safe area. */
export const VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

let prepared = false;
let seenWidth = 0;
let seenHeight = 0;

/** True if `target` sits inside something that scrolls (a list in a menu): those keep their native scrolling. */
function inScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(style.overflowY) || /auto|scroll/.test(style.overflowX)) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Call once a touch screen is known to be in use. Safe to call again. */
export function prepareTouchPage(): void {
  if (prepared || typeof document === 'undefined') return;
  prepared = true;
  document.documentElement.classList.add('q03-page');

  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', VIEWPORT);

  const stop = (e: Event) => e.preventDefault();
  // Safari's own pinch events; other browsers go by touch-action in the stylesheet.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  // Two fingers anywhere is a pinch; one finger outside a scrolling list would drag (bounce) the page.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 || !inScroller(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  // Long press: no "copy / look up" bubble, no context menu.
  document.addEventListener('contextmenu', stop);
  document.addEventListener('selectstart', stop);

  seenWidth = window.innerWidth;
  seenHeight = window.innerHeight;
  window.addEventListener('resize', () => {
    seenWidth = window.innerWidth;
    seenHeight = window.innerHeight;
  });
  // iOS reports the old size for a moment after turning the phone: look again shortly afterwards.
  const later = () => {
    for (const ms of [60, 300, 800]) setTimeout(watchViewport, ms);
  };
  window.addEventListener('orientationchange', later);
  window.visualViewport?.addEventListener('resize', later);
  later();
}

/**
 * The renderer and the HUD size themselves from window 'resize'. Mobile Safari does not always send one when
 * the address bar slides away or the phone turns, so the size is checked (cheaply, once a frame) and the event
 * sent for it when it was missed. Also undoes any stray scroll offset the browser has given the page.
 */
export function watchViewport(): void {
  if (!prepared) return;
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  if (window.innerWidth === seenWidth && window.innerHeight === seenHeight) return;
  seenWidth = window.innerWidth;
  seenHeight = window.innerHeight;
  window.dispatchEvent(new Event('resize'));
}
