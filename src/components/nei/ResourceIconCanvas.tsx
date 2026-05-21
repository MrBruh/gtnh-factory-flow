"use client";

import { memo, useEffect, useRef } from "react";
import type { ResourceAmount } from "@/lib/model/types";

interface ResourceIconCanvasProps {
  resource?: Pick<ResourceAmount, "id" | "displayName" | "iconPath" | "iconAtlas">;
  size?: number;
  className?: string;
}

const imageCache = new Map<string, HTMLImageElement>();
const bitmapCache = new Map<string, Promise<ImageBitmap>>();

export const ResourceIconCanvas = memo(function ResourceIconCanvas({
  resource,
  size = 36,
  className = "",
}: ResourceIconCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !resource) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = false;

    const source = resource.iconAtlas?.imagePath ?? resource.iconPath;
    if (!source || source.includes("/textures/rendered/")) {
      return;
    }

    let cancelled = false;
    loadIconImage(source).then(async (image) => {
      if (cancelled) {
        return;
      }

      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;

      if (resource.iconAtlas) {
        const bitmap = await loadIconBitmap(image, {
          cacheKey: `${source}:${resource.iconAtlas.x}:${resource.iconAtlas.y}:${resource.iconAtlas.width}:${resource.iconAtlas.height}`,
          x: resource.iconAtlas.x,
          y: resource.iconAtlas.y,
          width: resource.iconAtlas.width,
          height: resource.iconAtlas.height,
        });
        if (cancelled) {
          return;
        }
        context.drawImage(bitmap, 0, 0, size, size);
        return;
      }

      const bitmap = await loadIconBitmap(image, {
        cacheKey: source,
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      if (cancelled) {
        return;
      }
      context.drawImage(bitmap, 0, 0, size, size);
    });

    return () => {
      cancelled = true;
    };
  }, [resource, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={resource?.displayName ?? resource?.id}
      className={["pixelated-image block", className].join(" ")}
      style={{ imageRendering: "pixelated" }}
    />
  );
});

function loadIconBitmap(
  image: HTMLImageElement,
  source: { cacheKey: string; x: number; y: number; width: number; height: number },
): Promise<ImageBitmap> {
  const cached = bitmapCache.get(source.cacheKey);
  if (cached) {
    return cached;
  }

  const bitmapPromise =
    typeof createImageBitmap === "function"
      ? createImageBitmap(
          image,
          source.x,
          source.y,
          source.width,
          source.height,
        )
      : Promise.resolve(image as unknown as ImageBitmap);

  bitmapCache.set(source.cacheKey, bitmapPromise);
  return bitmapPromise;
}

export function preloadResourceIconCanvas(
  resource?: Pick<ResourceAmount, "iconPath" | "iconAtlas">,
): Promise<ImageBitmap | HTMLImageElement | undefined> {
  const source = resource?.iconAtlas?.imagePath ?? resource?.iconPath;
  if (!source || source.includes("/textures/rendered/")) {
    return Promise.resolve(undefined);
  }

  return loadIconImage(source).then((image) => {
    if (resource?.iconAtlas) {
      return loadIconBitmap(image, {
        cacheKey: `${source}:${resource.iconAtlas.x}:${resource.iconAtlas.y}:${resource.iconAtlas.width}:${resource.iconAtlas.height}`,
        x: resource.iconAtlas.x,
        y: resource.iconAtlas.y,
        width: resource.iconAtlas.width,
        height: resource.iconAtlas.height,
      });
    }

    return loadIconBitmap(image, {
      cacheKey: source,
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  });
}

function loadIconImage(src: string): Promise<HTMLImageElement> {
  const absoluteSrc = new URL(src, window.location.origin).toString();
  const cached = imageCache.get(absoluteSrc);
  if (cached?.complete) {
    return Promise.resolve(cached);
  }

  if (cached) {
    return new Promise((resolve, reject) => {
      cached.addEventListener("load", () => resolve(cached), { once: true });
      cached.addEventListener("error", reject, { once: true });
    });
  }

  const image = new Image();
  image.decoding = "async";
  image.src = absoluteSrc;
  imageCache.set(absoluteSrc, image);

  if (image.complete) {
    return Promise.resolve(image);
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}
