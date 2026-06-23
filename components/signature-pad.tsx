"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  /** Returns the pad's PNG as a raw base64 string (no data: prefix). */
  toBase64: () => string | null;
  clear: () => void;
  hasInk: () => boolean;
}

interface SignaturePadProps {
  onChange?: (hasContent: boolean) => void;
  width?: number;
  height?: number;
  className?: string;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad(
    { onChange, width = 500, height = 180, className },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const hasInkRef = useRef(false);

    useImperativeHandle(ref, () => ({
      toBase64: () => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const url = canvas.toDataURL("image/png");
        const idx = url.indexOf(",");
        return idx >= 0 ? url.slice(idx + 1) : url;
      },
      clear: () => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        if (hasInkRef.current) {
          hasInkRef.current = false;
          onChange?.(false);
        }
      },
      hasInk: () => hasInkRef.current,
    }));

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, []);

    const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current!;
      const rect = c.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (c.width / rect.width),
        y: (e.clientY - rect.top) * (c.height / rect.height),
      };
    };

    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      drawingRef.current = true;
      canvasRef.current?.setPointerCapture(e.pointerId);
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!hasInkRef.current) {
        hasInkRef.current = true;
        onChange?.(true);
      }
    };
    const end = () => {
      drawingRef.current = false;
    };

    const clear = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      if (hasInkRef.current) {
        hasInkRef.current = false;
        onChange?.(false);
      }
    };

    return (
      <div className="space-y-2">
        <div className={`overflow-hidden rounded-md border bg-white ${className ?? ""}`}>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="block w-full touch-none"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerLeave={end}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Ký bằng chuột / ngón tay trên khung trên</span>
          <button
            type="button"
            onClick={clear}
            className="text-primary hover:underline"
          >
            Xóa
          </button>
        </div>
      </div>
    );
  },
);
