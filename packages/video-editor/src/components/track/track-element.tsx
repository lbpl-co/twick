import { useState, useEffect, useRef, useMemo } from "react";
import { useDrag } from "@use-gesture/react";
import { motion, HTMLMotionProps } from "framer-motion";
import {
  MIN_DURATION,
  DRAG_TYPE,
  SNAP_THRESHOLD_PX,
} from "../../helpers/constants";
import { ELEMENT_COLORS } from "../../helpers/editor.utils";
import {
  FrameEffect,
  getDecimalNumber,
  TrackElement,
  TIMELINE_ELEMENT_TYPE,
  canSplitElement,
  snapTime,
  pxToSecThreshold,
} from "@twick/timeline";
import { ElementColors } from "../../helpers/types";
import "../../styles/timeline.css";
import { TrackElementContextMenu } from "./track-element-context-menu";
import { AudioWaveform } from "./audio-waveform";
import { ImageTimelineStrip, VideoTimelineStrip } from "./timeline-media-strip";

export interface TrackElementDragPayload {
  element: TrackElement;
  dragType: string;
  updates: { start: number; end: number };
}

export interface DropPointer {
  clientX: number;
  clientY: number;
}

export const TrackElementView: React.FC<{
  element: TrackElement;
  selectedItem: TrackElement | null;
  selectedIds: Set<string>;
  parentWidth: number;
  duration: number;
  nextStart: number | null;
  prevEnd: number;
  allowOverlap: boolean;
  onSelection: (element: TrackElement, event: React.MouseEvent) => void;
  onDrag: (payload: TrackElementDragPayload, dropPointer?: DropPointer) => void;
  onDragStateChange?: (isDragging: boolean, element?: TrackElement) => void;
  elementColors?: ElementColors;
  /** Playhead time (seconds); used for “Split at playhead” */
  currentTime?: number;
  /** Selects this element when opening the context menu */
  onContextMenuTarget?: (element: TrackElement) => void;
  onDeleteElement?: (element: TrackElement) => void;
  onSplitElement?: (element: TrackElement, splitTime: number) => void;
  /** Collects snap target times (seconds) for the current drag, excluding this element. */
  getSnapTargets?: (excludeElementId: string) => number[];
  /** Timeline scale (px per second); used to derive the snap threshold in seconds. */
  pixelsPerSecond?: number;
  /** Reports the active snap guide time (seconds), or null when nothing is snapping. */
  onSnapChange?: (time: number | null) => void;
}> = ({
  element,
  parentWidth,
  duration,
  nextStart,
  prevEnd,
  selectedItem,
  selectedIds,
  onSelection,
  onDrag,
  allowOverlap = false,
  onDragStateChange,
  elementColors,
  currentTime = 0,
  onContextMenuTarget,
  onDeleteElement,
  onSplitElement,
  getSnapTargets,
  pixelsPerSecond,
  onSnapChange,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragType = useRef<string | null>(null);
  const lastPosRef = useRef<{ start: number; end: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number } | null>(
    null
  );

  const [position, setPosition] = useState({
    start: 0,
    end: 0,
  });
  // Mirror of `position` kept in sync so drag handlers can read/write the latest
  // value synchronously within a single gesture event (needed to compute snapping
  // and notify the parent in the same tick, rather than inside a setState updater).
  const posRef = useRef({ start: 0, end: 0 });
  // Snap targets are collected once per drag and cached for its duration.
  const snapTargetsRef = useRef<number[] | null>(null);
  // Last guide time reported, so we only fire haptics when a *new* edge snaps.
  const lastGuideRef = useRef<number | null>(null);

  const commitPosition = (next: { start: number; end: number }) => {
    posRef.current = next;
    setPosition(next);
  };

  useEffect(() => {
    commitPosition({
      start: element.getStart(),
      end: element.getEnd(),
    });
  }, [element.getStart(), element.getEnd(), parentWidth, duration]);

  // Snap distance in seconds, derived from the timeline scale (constant on-screen px).
  const getThresholdSec = () =>
    pixelsPerSecond && pixelsPerSecond > 0
      ? pxToSecThreshold(SNAP_THRESHOLD_PX, pixelsPerSecond)
      : 0;

  // Lazily collect (and cache) the snap targets for the current drag.
  const ensureSnapTargets = (bypass: boolean): number[] => {
    if (bypass || !getSnapTargets) return [];
    if (snapTargetsRef.current === null) {
      snapTargetsRef.current = getSnapTargets(element.getId());
    }
    return snapTargetsRef.current;
  };

  // Report the active guide and pulse haptics on a freshly-snapped edge.
  const notifySnap = (guide: number | null) => {
    if (guide !== null && guide !== lastGuideRef.current) {
      try {
        navigator.vibrate?.(8);
      } catch {
        /* unsupported — visual guide is the primary feedback */
      }
    }
    lastGuideRef.current = guide;
    onSnapChange?.(guide);
  };

  const isMediaElement =
    element.getType() === TIMELINE_ELEMENT_TYPE.VIDEO ||
    element.getType() === TIMELINE_ELEMENT_TYPE.AUDIO;

  // Clamp a candidate clip start (move) to the same bounds the unsnapped path uses.
  const clampMoveStart = (raw: number, curEnd: number, span: number) => {
    let v = Math.max(0, Math.min(raw, curEnd - MIN_DURATION));
    if (!allowOverlap) {
      if (prevEnd !== null && v < prevEnd) {
        v = prevEnd;
      } else if (nextStart !== null && v + span > nextStart) {
        v = nextStart - span;
      }
    }
    return Math.max(0, Math.min(v, duration - span));
  };

  // Clamp a candidate start edge (trim-start) to its bounds.
  const clampTrimStart = (raw: number, curEnd: number) => {
    let v = Math.max(0, Math.min(raw, curEnd - MIN_DURATION));
    if (prevEnd !== null && !allowOverlap && v < prevEnd) {
      v = prevEnd;
    }
    return Math.max(0, Math.min(v, curEnd - MIN_DURATION));
  };

  // Clamp a candidate end edge (trim-end) to its bounds.
  const clampTrimEnd = (raw: number, curStart: number) => {
    let v = Math.max(raw, curStart + MIN_DURATION);
    if (!allowOverlap && nextStart !== null && v > nextStart) {
      v = nextStart;
    }
    // Video/audio have an intrinsic media length, so they can't extend past the
    // current timeline. Text/image/shapes have no inherent duration — let them
    // extend beyond the timeline end (which grows totalDuration on drop).
    const maxEnd = isMediaElement ? duration : v;
    return Math.max(curStart + MIN_DURATION, Math.min(v, maxEnd));
  };

  const bind = useDrag(({ delta: [dx], event }) => {
    if (!parentWidth) return;
    if (dx == 0) return;
    if (!isDragging) {
      setIsDragging(true);
      onDragStateChange?.(true, element);
    }
    dragType.current = DRAG_TYPE.MOVE;
    const cur = posRef.current;
    const span = cur.end - cur.start;
    const bypass = !!(event as PointerEvent | undefined)?.altKey;
    let newStart = clampMoveStart(
      cur.start + (dx / parentWidth) * duration,
      cur.end,
      span
    );

    // Snap whichever edge (start or end) lands closest to a target, then shift
    // the whole clip so that edge aligns. Re-clamp; if the snap would break the
    // bounds, ignore it and clear the guide.
    let guide: number | null = null;
    const targets = ensureSnapTargets(bypass);
    const thr = getThresholdSec();
    if (targets.length && thr > 0) {
      const sStart = snapTime(newStart, targets, thr);
      const sEnd = snapTime(newStart + span, targets, thr);
      let best = Infinity;
      let snappedStart: number | null = null;
      if (sStart.didSnap) {
        best = Math.abs(newStart - sStart.time);
        snappedStart = sStart.time;
        guide = sStart.time;
      }
      if (sEnd.didSnap && Math.abs(newStart + span - sEnd.time) < best) {
        snappedStart = sEnd.time - span;
        guide = sEnd.time;
      }
      if (snappedStart !== null) {
        const clamped = clampMoveStart(snappedStart, cur.end, span);
        if (Math.abs(clamped - snappedStart) < 1e-4) {
          newStart = clamped;
        } else {
          guide = null;
        }
      }
    }

    commitPosition({ start: newStart, end: newStart + span });
    notifySnap(guide);
  });

  const bindStartHandle = useDrag(({ delta: [dx], event }) => {
    if (event) {
      event.stopPropagation();
    }
    if (dx === 0) return;
    if (isDragging) {
      setIsDragging(false);
      onDragStateChange?.(false, element);
    }
    dragType.current = DRAG_TYPE.START;
    const cur = posRef.current;
    const bypass = !!(event as PointerEvent | undefined)?.altKey;
    let newStart = clampTrimStart(
      cur.start + (dx / parentWidth) * duration,
      cur.end
    );

    let guide: number | null = null;
    const targets = ensureSnapTargets(bypass);
    const thr = getThresholdSec();
    if (targets.length && thr > 0) {
      const s = snapTime(newStart, targets, thr);
      if (s.didSnap) {
        const clamped = clampTrimStart(s.time, cur.end);
        if (Math.abs(clamped - s.time) < 1e-4) {
          newStart = clamped;
          guide = s.time;
        }
      }
    }

    commitPosition({ start: newStart, end: cur.end });
    notifySnap(guide);
  });

  const bindEndHandle = useDrag(({ delta: [dx], event }) => {
    if (event) {
      event.stopPropagation();
    }
    if (dx === 0) return;
    if (isDragging) {
      setIsDragging(false);
      onDragStateChange?.(false, element);
    }
    dragType.current = DRAG_TYPE.END;
    const cur = posRef.current;
    const bypass = !!(event as PointerEvent | undefined)?.altKey;
    let newEnd = clampTrimEnd(
      cur.end + (dx / parentWidth) * duration,
      cur.start
    );

    let guide: number | null = null;
    const targets = ensureSnapTargets(bypass);
    const thr = getThresholdSec();
    if (targets.length && thr > 0) {
      const s = snapTime(newEnd, targets, thr);
      if (s.didSnap) {
        const clamped = clampTrimEnd(s.time, cur.start);
        if (Math.abs(clamped - s.time) < 1e-4) {
          newEnd = clamped;
          guide = s.time;
        }
      }
    }

    commitPosition({ start: cur.start, end: newEnd });
    notifySnap(guide);
  });

  const setLastPos = () => {
    lastPosRef.current = position;
    // Fresh targets for each new gesture.
    snapTargetsRef.current = null;
  };

  const sendUpdate = (e?: React.MouseEvent | React.TouchEvent) => {
    let dropPointer: DropPointer | undefined;
    if (e) {
      if ("clientX" in e) {
        dropPointer = { clientX: e.clientX, clientY: e.clientY };
      } else if ("changedTouches" in e && e.changedTouches?.[0]) {
        const t = e.changedTouches[0];
        dropPointer = { clientX: t.clientX, clientY: t.clientY };
      }
    }
    setIsDragging(false);
    onDragStateChange?.(false, element);
    // Drag finished — clear the snap guide and drop cached targets.
    snapTargetsRef.current = null;
    notifySnap(null);
    const payload: TrackElementDragPayload = {
      element,
      updates: {
        start: getDecimalNumber(position.start),
        end: getDecimalNumber(position.end),
      },
      dragType: dragType.current || "",
    };
    const didChange =
      lastPosRef.current?.start !== position.start ||
      lastPosRef.current?.end !== position.end;
    if (didChange || dropPointer) {
      onDrag(payload, dropPointer);
    }
  };

  const getElementColor = (elementType: string) => {
    const colors = elementColors || ELEMENT_COLORS;

    const key =
      elementType === TIMELINE_ELEMENT_TYPE.VIDEO
        ? "video"
        : elementType === TIMELINE_ELEMENT_TYPE.AUDIO
        ? "audio"
        : elementType === TIMELINE_ELEMENT_TYPE.IMAGE
        ? "image"
        : elementType === TIMELINE_ELEMENT_TYPE.TEXT
        ? "text"
        : elementType === TIMELINE_ELEMENT_TYPE.CAPTION
        ? "caption"
        : elementType === TIMELINE_ELEMENT_TYPE.RECT
        ? "rect"
        : elementType === TIMELINE_ELEMENT_TYPE.CIRCLE
        ? "circle"
        : elementType === TIMELINE_ELEMENT_TYPE.ICON
        ? "icon"
        : elementType === TIMELINE_ELEMENT_TYPE.EMOJI
        ? "emoji"
        : elementType === TIMELINE_ELEMENT_TYPE.EFFECT
        ? "effect"
        : "element";

    if (key in colors) {
      return colors[key as keyof typeof colors];
    }
    return ELEMENT_COLORS.element;
  };

  const isSelected = useMemo(() => {
    return selectedIds.has(element.getId());
  }, [selectedIds, element]);

  const isAudioElement = element.getType() === TIMELINE_ELEMENT_TYPE.AUDIO;
  const isVideoElement = element.getType() === TIMELINE_ELEMENT_TYPE.VIDEO;
  const isImageElement = element.getType() === TIMELINE_ELEMENT_TYPE.IMAGE;
  const elementLabel =
    element.getType() === TIMELINE_ELEMENT_TYPE.EFFECT
      ? (element as any).getProps?.()?.effectKey ?? "Effect"
      : (element as any).getText
      ? (element as any).getText()
      : element.getName() || element.getType();
  const mediaSrc =
    (isAudioElement || isVideoElement || isImageElement) && (element as any).getSrc
      ? (element as any).getSrc()
      : undefined;
  const mediaOffsetSec =
    isVideoElement && (element as any).getStartAt ? (element as any).getStartAt() : 0;
  const playbackRate =
    isVideoElement && (element as any).getPlaybackRate ? (element as any).getPlaybackRate() : 1;
  const mediaDurationSec =
    isVideoElement && (element as any).getMediaDuration ? (element as any).getMediaDuration() : undefined;
  const elementWidthPx = Math.max(
    1,
    ((position.end - position.start) / Math.max(duration, MIN_DURATION)) * parentWidth
  );

  const hasHandles =
    selectedItem?.getId() === element.getId();

  const contextActionsEnabled = Boolean(
    onDeleteElement && onSplitElement && onContextMenuTarget
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!contextActionsEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenuTarget?.(element);
    setClipMenu({ x: e.clientX, y: e.clientY });
  };

  const motionProps: HTMLMotionProps<"div"> = {
    ref,
    className: `twick-track-element ${
      isSelected
        ? "twick-track-element-selected"
        : "twick-track-element-default"
    } ${isDragging ? "twick-track-element-dragging" : ""} ${
      isAudioElement ? "twick-track-element-audio" : ""
    }`,
    onMouseDown: (e) => {
      if (e.target === ref.current) {
        setLastPos();
      }
    },
    onTouchStart: (e) => {
      if (e.target === ref.current) {
        setLastPos();
      }
    },
    onMouseUp: (e) => sendUpdate(e),
    onTouchEnd: (e) => sendUpdate(e),
    onClick: (e: React.MouseEvent) => {
      if (onSelection) {
        onSelection(element, e);
      }
    },
    onContextMenu: handleContextMenu,
    style: {
      backgroundColor: getElementColor(element.getType()),
      width: `${((position.end - position.start) / duration) * 100}%`,
      left: `${(position.start / duration) * 100}%`,
      touchAction: "none",
    },
  };

  return (
    <motion.div {...motionProps}>
      {clipMenu && contextActionsEnabled ? (
        <TrackElementContextMenu
          x={clipMenu.x}
          y={clipMenu.y}
          canSplit={canSplitElement(element, currentTime)}
          onSplit={() => onSplitElement?.(element, currentTime)}
          onDelete={() => onDeleteElement?.(element)}
          onClose={() => setClipMenu(null)}
        />
      ) : null}
      <div style={{ touchAction: "none", height: "100%" }} {...bind()}>
        {hasHandles ? (
          <div
            style={{ touchAction: "none" , zIndex: isSelected? 100 : 1}}
            {...bindStartHandle()}
            className="twick-track-element-handle twick-track-element-handle-start"
          />
        ) : null}
        <div
          className={`twick-track-element-content ${
            isAudioElement ? "twick-track-element-content-audio" : ""
          }`}
        >
          {isAudioElement ? (
            <AudioWaveform
              src={mediaSrc}
              widthPx={elementWidthPx}
              heightPx={46}
              label={elementLabel}
            />
          ) : isVideoElement && mediaSrc ? (
            <VideoTimelineStrip
              src={mediaSrc}
              widthPx={elementWidthPx}
              heightPx={46}
              durationSec={Math.max(0, element.getDuration())}
              mediaOffsetSec={mediaOffsetSec}
              playbackRate={playbackRate}
              mediaDurationSec={mediaDurationSec}
            />
          ) : isImageElement && mediaSrc ? (
            <ImageTimelineStrip
              src={mediaSrc}
              widthPx={elementWidthPx}
              heightPx={46}
            />
          ) : (
            elementLabel
          )}
        </div>
        {hasHandles ? (
          <div
            style={{ touchAction: "none", zIndex: isSelected? 100 : 1 }}
            {...bindEndHandle()}
            className="twick-track-element-handle twick-track-element-handle-end"
          />
        ) : null}
        {(element as any).getFrameEffects
          ? (element as any)
              .getFrameEffects()
              .map((frameEffect: FrameEffect) => {
                return (
                  <div
                    className="twick-track-element-frame-effect"
                    key={frameEffect.s + frameEffect.e}
                    style={{
                      backgroundColor: getElementColor("frameEffect"),
                      width: `${
                        ((frameEffect.e - frameEffect.s) /
                          element.getDuration()) *
                        100
                      }%`,
                      left: `${(frameEffect.s / element.getDuration()) * 100}%`,
                    }}
                  ></div>
                );
              })
          : null}
      </div>
    </motion.div>
  );
};

export default TrackElementView;
