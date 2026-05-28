"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function MinecraftTooltip({
  label,
  children,
}: {
  label?: string | string[];
  children: ReactNode;
}) {
  const lines = useMemo(
    () => (Array.isArray(label) ? label : label ? label.split("\n") : []),
    [label],
  );
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>();
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPositionRef = useRef<{ x: number; y: number } | undefined>(undefined);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const handleMouseMove = (event: MouseEvent) => {
    if (lines.length === 0) {
      return;
    }

    if (event.buttons !== 0) {
      pendingPositionRef.current = undefined;
      if (position !== undefined) {
        setPosition(undefined);
      }
      return;
    }

    pendingPositionRef.current = {
      x: Math.min(event.clientX + 12, window.innerWidth - 260),
      y: Math.min(event.clientY + 12, window.innerHeight - 80),
    };

    if (frameRef.current !== undefined) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      const nextPosition = pendingPositionRef.current;
      if (!nextPosition) {
        return;
      }

      setPosition((currentPosition) =>
        currentPosition &&
        Math.abs(currentPosition.x - nextPosition.x) < 2 &&
        Math.abs(currentPosition.y - nextPosition.y) < 2
          ? currentPosition
          : nextPosition,
      );
    });
  };

  const clearTooltip = () => {
    pendingPositionRef.current = undefined;
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (position !== undefined) {
      setPosition(undefined);
    }
  };

  return (
    <span
      className="contents"
      onMouseEnter={handleMouseMove}
      onMouseMove={handleMouseMove}
      onMouseLeave={clearTooltip}
    >
      {children}
      {position && lines.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[9999] max-w-[260px] border-2 border-[#2a005f] bg-[#100010] px-2 py-1 font-mono text-[16px] leading-[18px] text-white shadow-[inset_1px_1px_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_rgba(0,0,0,0.8)] [text-shadow:2px_2px_0_#3f3f3f]"
              style={{ left: position.x, top: position.y }}
            >
              {lines.map((line, index) => (
                <div
                  key={`${line}-${index}`}
                  className={index === 0 ? "text-white" : "text-[#aaaaff]"}
                >
                  {line}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
