// Keep an agent or group chat on its newest message only while the reader is
// following it. Both chats poll the host and replace their message list every
// few seconds; scrolling to the bottom on each refresh threw anyone reading
// further up straight back down. Same direction rules as the Code chat's
// transcript (transcript-pin.ts), including the iPhone's finger hold.

import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { isPhone } from "../platform";
import {
  followsOutput,
  pinAfterScroll,
  pinAfterTouchScroll,
  pinAfterWheel,
  TOUCH_SETTLE_MS,
} from "../transcript-pin";

/** Handlers for the scrolling message list, spread onto its element. */
export interface FollowLatestHandlers {
  onScroll: () => void;
  onWheel: (e: React.WheelEvent<HTMLElement>) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export interface FollowLatest {
  /** Whether the reader is following the newest message right now. */
  following: () => boolean;
  /** Scroll to the newest message, if the reader is following it. */
  catchUp: () => void;
  /** Follow again from here on (the reader sent a message, or a new chat opened). */
  follow: () => void;
  handlers: FollowLatestHandlers;
}

export function useFollowLatest(logRef: React.RefObject<HTMLElement | null>): FollowLatest {
  const pinnedRef = useRef(true);
  // The offset as last seen by a scroll event or left by our own jump: the
  // baseline that tells an up-scroll from a down-scroll.
  const lastTopRef = useRef(0);
  // iPhone: a finger on the list, or the fling it left behind, holds it.
  const heldRef = useRef(false);
  const touchingRef = useRef(false);
  const settleRef = useRef<number | null>(null);

  const jump = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, [logRef]);

  const catchUp = useCallback(() => {
    if (followsOutput(pinnedRef.current, heldRef.current)) jump();
  }, [jump]);

  const follow = useCallback(() => {
    pinnedRef.current = true;
    catchUp();
  }, [catchUp]);

  const release = useCallback(() => {
    settleRef.current = null;
    heldRef.current = false;
    catchUp();
  }, [catchUp]);

  const settle = useCallback(() => {
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(release, TOUCH_SETTLE_MS);
  }, [release]);

  useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    pinnedRef.current = isPhone()
      ? pinAfterTouchScroll(pinnedRef.current, lastTopRef.current, el, heldRef.current)
      : pinAfterScroll(pinnedRef.current, lastTopRef.current, el);
    lastTopRef.current = el.scrollTop;
    // A fling still running after the finger lifted keeps the hold on.
    if (heldRef.current && !touchingRef.current) settle();
  }, [logRef, settle]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      const el = logRef.current;
      if (el) pinnedRef.current = pinAfterWheel(pinnedRef.current, e, el);
    },
    [logRef],
  );

  const onTouchStart = useCallback(() => {
    heldRef.current = true;
    touchingRef.current = true;
    if (settleRef.current !== null) {
      window.clearTimeout(settleRef.current);
      settleRef.current = null;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    touchingRef.current = false;
    settle();
  }, [settle]);

  const following = useCallback(() => pinnedRef.current, []);

  return {
    following,
    catchUp,
    follow,
    handlers: { onScroll, onWheel, onTouchStart, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
