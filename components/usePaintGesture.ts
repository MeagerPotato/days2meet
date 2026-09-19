'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * One paint gesture for every grid in the app: the availability time grid, the
 * whole-day calendar and the date picker on the create form.
 *
 * A mouse paints the moment the button goes down, exactly as it always has.
 *
 * A finger cannot work that way. On a phone the grid is taller than the screen,
 * so a grid that turns every touch into paint leaves nowhere to put a thumb to
 * scroll — the bug this replaces. Here the browser keeps the touch until the
 * finger has held still on one cell for `HOLD_MS`:
 *
 *   - swipe          → the page scrolls natively, with momentum, and nothing is painted;
 *   - tap            → toggles the one cell;
 *   - press and hold → the cell lights up, the phone buzzes where it can, and
 *                      from then on dragging paints, exactly like a mouse drag.
 *
 * The one thing pointer events cannot do is take back a scroll the browser has
 * decided on, and `touch-action` is fixed for a gesture the moment it starts.
 * So the surface carries a non-passive `touchmove` listener that cancels the
 * browser's scroll only while a paint is live. Before the hold fires it does
 * nothing, which is what leaves the native scroll alone.
 */

/** Long enough that a deliberate scroll never trips it, short enough not to feel like waiting. */
export const HOLD_MS = 300;
/** A finger that drifts further than this before the hold fires is scrolling, not pressing. */
export const SLOP_PX = 10;
/** A touch this soon after the page last moved is stopping momentum, not tapping a cell. */
const MOMENTUM_MS = 120;
/** How close to a viewport edge a painting finger has to get before the page scrolls to follow. */
const EDGE_TOP_PX = 96;
const EDGE_BOTTOM_PX = 64;
const EDGE_SIDE_PX = 40;
const MAX_AUTOSCROLL_PX = 16;

/* One capture listener for the whole page, however many grids are mounted.
   Scroll events do not bubble, so capture is what also catches the grid's own
   horizontal scroller. */
let lastScrollAt = Number.NEGATIVE_INFINITY;
let scrollWatchers = 0;
const noteScroll = () => {
  lastScrollAt = performance.now();
};

function watchScroll(): () => void {
  if (scrollWatchers++ === 0) {
    document.addEventListener('scroll', noteScroll, { capture: true, passive: true });
  }
  return () => {
    if (--scrollWatchers === 0) document.removeEventListener('scroll', noteScroll, { capture: true });
  };
}

function autoscrollSpeed(depth: number): number {
  return Math.min(MAX_AUTOSCROLL_PX, 2 + depth * 0.3);
}

export interface PaintGestureOptions<K extends string | number> {
  /** False turns every handler into a no-op, for read-only grids. */
  enabled: boolean;
  /** The element holding the cells. It gets the native `touchmove` and `contextmenu` listeners. */
  surfaceRef: RefObject<HTMLElement | null>;
  /** The key of the paintable cell at or around `element`, or null. */
  keyOf: (element: Element | null) => K | null;
  /** Paint starts on `key`. For a mouse this is pointerdown; for a finger, the end of the hold. */
  onBegin: (key: K, pointerType: string) => void;
  /** The pointer has moved onto a different cell. Never called twice in a row for the same one. */
  onExtend: (key: K) => void;
  /** The paint is over and should be committed. */
  onEnd: () => void;
  /** A finger tapped `key` without holding. */
  onTap: (key: K) => void;
  /** A horizontal scroller around the grid, nudged when a painting finger reaches its sides. */
  scrollerRef?: RefObject<HTMLElement | null>;
}

interface MouseGesture {
  kind: 'mouse';
  pointerId: number;
  lastKey: string | number;
}

interface TouchGesture {
  kind: 'touch';
  pointerId: number;
  pointerType: string;
  key: string | number;
  lastKey: string | number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  phase: 'pending' | 'painting';
  /** Where the finger was when the hold engaged; autoscroll only follows a move away from it. */
  engageX: number;
  engageY: number;
  /** The touch landed on a page that was still scrolling. */
  stopper: boolean;
  /** The pointer was cancelled mid-paint while the touch itself carried on. */
  pointerLost: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

type Gesture = MouseGesture | TouchGesture;

export interface PaintGesture {
  /** Attach to the surface. Handles every pointer type. */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Attach to the surface. Only the mouse path uses it; touch listens on the window. */
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  /** A finger is painting right now, for feedback that only touch needs. */
  touchPainting: boolean;
}

export function usePaintGesture<K extends string | number>(
  options: PaintGestureOptions<K>,
): PaintGesture {
  // Handlers are read through a ref so the window listeners, which live for
  // the length of one gesture, always call the current render's closures.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef(0);
  const [touchPainting, setTouchPainting] = useState(false);

  const keyAt = (x: number, y: number): K | null =>
    optionsRef.current.keyOf(document.elementFromPoint(x, y));

  /* ---------------------------------------------------------- touch plumbing */

  const detachRef = useRef<(() => void) | null>(null);

  const stopTouch = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture?.kind === 'touch' && gesture.timer) clearTimeout(gesture.timer);
    gestureRef.current = null;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    detachRef.current?.();
    detachRef.current = null;
    setTouchPainting(false);
  }, []);

  /** Ends a touch gesture, committing it if it had got as far as painting. */
  const finishTouch = useCallback(() => {
    const gesture = gestureRef.current;
    const painting = gesture?.kind === 'touch' && gesture.phase === 'painting';
    stopTouch();
    if (painting) optionsRef.current.onEnd();
  }, [stopTouch]);

  const extendTouchAt = useCallback((x: number, y: number) => {
    const gesture = gestureRef.current;
    if (gesture?.kind !== 'touch' || gesture.phase !== 'painting') return;
    const key = optionsRef.current.keyOf(document.elementFromPoint(x, y));
    if (key === null || key === gesture.lastKey) return;
    gesture.lastKey = key;
    optionsRef.current.onExtend(key);
  }, []);

  // A finger held near an edge scrolls the page (or the grid sideways) under
  // it, so a block taller than the screen can be painted in one stroke. The
  // page cannot scroll itself while the paint is cancelling touchmove, which is
  // why this has to be done by hand.
  const autoscroll = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture?.kind !== 'touch' || gesture.phase !== 'painting') {
      frameRef.current = 0;
      return;
    }

    const viewport = window.visualViewport;
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = top + (viewport ? viewport.height : window.innerHeight);

    // Only a finger that has travelled toward an edge asks for a scroll. A
    // paint that merely starts near the top of the screen must stay put.
    const up = gesture.lastY < gesture.engageY - SLOP_PX;
    const down = gesture.lastY > gesture.engageY + SLOP_PX;
    let dy = 0;
    if (up && gesture.lastY < top + EDGE_TOP_PX) dy = -autoscrollSpeed(top + EDGE_TOP_PX - gesture.lastY);
    else if (down && gesture.lastY > bottom - EDGE_BOTTOM_PX)
      dy = autoscrollSpeed(gesture.lastY - (bottom - EDGE_BOTTOM_PX));

    let moved = false;
    if (dy !== 0) {
      const before = window.scrollY;
      window.scrollBy({ top: dy, behavior: 'instant' });
      moved = window.scrollY !== before;
    }

    const scroller = optionsRef.current.scrollerRef?.current;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const box = scroller.getBoundingClientRect();
      const left = gesture.lastX < gesture.engageX - SLOP_PX;
      const right = gesture.lastX > gesture.engageX + SLOP_PX;
      let dx = 0;
      if (left && gesture.lastX < box.left + EDGE_SIDE_PX)
        dx = -autoscrollSpeed(box.left + EDGE_SIDE_PX - gesture.lastX);
      else if (right && gesture.lastX > box.right - EDGE_SIDE_PX)
        dx = autoscrollSpeed(gesture.lastX - (box.right - EDGE_SIDE_PX));
      if (dx !== 0) {
        const before = scroller.scrollLeft;
        scroller.scrollLeft += dx;
        moved = moved || scroller.scrollLeft !== before;
      }
    }

    if (moved) extendTouchAt(gesture.lastX, gesture.lastY);
    frameRef.current = requestAnimationFrame(autoscroll);
  }, [extendTouchAt]);

  const engage = useCallback(() => {
    const gesture = gestureRef.current;
    if (gesture?.kind !== 'touch' || gesture.phase !== 'pending') return;
    gesture.timer = null;
    gesture.phase = 'painting';
    gesture.engageX = gesture.lastX;
    gesture.engageY = gesture.lastY;
    optionsRef.current.onBegin(gesture.key as K, gesture.pointerType);
    setTouchPainting(true);
    // Android only; iOS Safari has no vibration API, which is why the anchor
    // cell also lights up. Chrome refuses it before the first tap on the page.
    try {
      if ('vibrate' in navigator) navigator.vibrate(10);
    } catch {
      /* feedback, not function */
    }
    if (!frameRef.current) frameRef.current = requestAnimationFrame(autoscroll);
  }, [autoscroll]);

  /* ------------------------------------------------------------- mouse end */

  // Pointer capture keeps a mouse drag's events flowing to the surface, but a
  // cancel or a pointerup over another element still has to commit, so the
  // listener lives on the window — the same arrangement the grids always had.
  useEffect(() => {
    if (!options.enabled) return;
    const finish = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture?.kind !== 'mouse') return;
      if (event.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      optionsRef.current.onEnd();
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [options.enabled]);

  /* -------------------------------------------- native listeners on the surface */

  const { enabled, surfaceRef } = options;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || !surface) return;

    // Non-passive, and so added here rather than as a React prop, which React
    // registers as passive. Returning early costs the scroll nothing; cancelling
    // is only ever done once a paint has engaged.
    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (gesture?.kind !== 'touch') return;

      if (gesture.phase === 'pending') {
        // A second finger is a pinch, and a move the browser will not let us
        // cancel means it has already started scrolling. Either way this was
        // never a press.
        if (event.touches.length > 1 || !event.cancelable) stopTouch();
        return;
      }

      // Uncancelable means the browser is scrolling after all. Stop before it
      // slides cells under the finger that nobody meant to paint.
      if (!event.cancelable) {
        finishTouch();
        return;
      }
      event.preventDefault();
      // Belt and braces: if the browser ever stops sending pointermove for a
      // touch it has decided to keep, the touch stream still drives the paint.
      const touch = event.touches[0];
      if (touch) {
        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;
        extendTouchAt(touch.clientX, touch.clientY);
      }
    };

    // Android fires contextmenu on a long press; left alone it can open the
    // selection UI and cancel the touch partway through a paint. Only touch is
    // blocked — a right-click on the desktop grid still gets its menu.
    const onContextMenu = (event: Event) => {
      const fromTouch =
        gestureRef.current?.kind === 'touch' ||
        (event as PointerEvent).pointerType === 'touch' ||
        (event as PointerEvent).pointerType === 'pen';
      if (fromTouch) event.preventDefault();
    };

    // Only needed once the pointer has been lost: otherwise pointerup, which
    // comes first, has already finished the gesture.
    const onTouchEnd = () => {
      const gesture = gestureRef.current;
      if (gesture?.kind === 'touch' && gesture.pointerLost) finishTouch();
    };

    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    surface.addEventListener('touchend', onTouchEnd);
    surface.addEventListener('touchcancel', onTouchEnd);
    surface.addEventListener('contextmenu', onContextMenu);
    const unwatch = watchScroll();
    return () => {
      surface.removeEventListener('touchmove', onTouchMove);
      surface.removeEventListener('touchend', onTouchEnd);
      surface.removeEventListener('touchcancel', onTouchEnd);
      surface.removeEventListener('contextmenu', onContextMenu);
      unwatch();
    };
  }, [enabled, surfaceRef, stopTouch, finishTouch, extendTouchAt]);

  // Unmounting or going read-only mid-gesture must not leave a timer or a
  // window listener behind.
  useEffect(() => {
    if (!enabled) stopTouch();
    return () => stopTouch();
  }, [enabled, stopTouch]);

  /* --------------------------------------------------------------- handlers */

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const { enabled: on, keyOf, onBegin } = optionsRef.current;
    if (!on) return;

    if (event.pointerType === 'mouse') {
      const key = keyOf(event.target as Element);
      if (key === null) return;
      event.preventDefault();
      gestureRef.current = { kind: 'mouse', pointerId: event.pointerId, lastKey: key };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation for drags that leave the grid. If the
        // pointer is already gone, the window listeners still end the paint.
      }
      onBegin(key, 'mouse');
      return;
    }

    // Touch and pen. A second finger while the first is still deciding is a
    // pinch; while the first is painting it is ignored. A gesture whose pointer
    // was lost and whose touchend never came is over — it must never be able
    // to block the grid.
    const current = gestureRef.current;
    if (current?.kind === 'touch' && current.pointerLost) {
      finishTouch();
    } else if (current) {
      if (current.kind === 'touch' && current.phase === 'pending') stopTouch();
      return;
    }

    const key = keyOf(event.target as Element);
    if (key === null) return;

    const gesture: TouchGesture = {
      kind: 'touch',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      key,
      lastKey: key,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      phase: 'pending',
      engageX: event.clientX,
      engageY: event.clientY,
      stopper: performance.now() - lastScrollAt < MOMENTUM_MS,
      pointerLost: false,
      timer: null,
    };
    gesture.timer = setTimeout(engage, HOLD_MS);
    gestureRef.current = gesture;

    const onMove = (moveEvent: PointerEvent) => {
      const live = gestureRef.current;
      if (live?.kind !== 'touch' || moveEvent.pointerId !== live.pointerId) return;
      live.lastX = moveEvent.clientX;
      live.lastY = moveEvent.clientY;
      if (live.phase === 'pending') {
        const drift = Math.hypot(moveEvent.clientX - live.startX, moveEvent.clientY - live.startY);
        if (drift > SLOP_PX) stopTouch();
        return;
      }
      extendTouchAt(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = (upEvent: PointerEvent) => {
      const live = gestureRef.current;
      if (live?.kind !== 'touch' || upEvent.pointerId !== live.pointerId) return;
      if (live.phase === 'painting') {
        finishTouch();
        return;
      }
      stopTouch();
      if (!live.stopper) optionsRef.current.onTap(live.key as K);
    };

    // Before the hold, a cancel means the browser took the touch for a scroll
    // or a zoom, and that is simply the answer. After it, the scroll has been
    // refused, so a cancel is something else — iOS can drop the pointer of a
    // long press while the touch goes on — and the touch stream carries the
    // paint to its touchend. A pen has no touch stream; its paint ends here,
    // keeping what is on screen, since that is what the stroke meant.
    const onCancel = (cancelEvent: PointerEvent) => {
      const live = gestureRef.current;
      if (live?.kind !== 'touch' || cancelEvent.pointerId !== live.pointerId) return;
      if (live.phase === 'painting' && live.pointerType === 'touch') {
        live.pointerLost = true;
        detachRef.current?.();
        detachRef.current = null;
        return;
      }
      finishTouch();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.kind !== 'mouse' || event.pointerId !== gesture.pointerId) return;
    const key = keyAt(event.clientX, event.clientY);
    if (key === null || key === gesture.lastKey) return;
    gesture.lastKey = key;
    optionsRef.current.onExtend(key);
  };

  return { onPointerDown, onPointerMove, touchPainting };
}
