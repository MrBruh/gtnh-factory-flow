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
const resolvedBitmapCache = new Map<string, ImageBitmap>();
const preloadQueue = new Map<
  string,
  {
    resource: Pick<ResourceAmount, "iconPath" | "iconAtlas">;
    callbacks: Set<() => void>;
  }
>();
let idlePreloadScheduled = false;

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

    const draw = () => {
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;
      const bitmap = getCachedResourceIconBitmap(resource);
      if (bitmap) {
        context.drawImage(bitmap, 0, 0, size, size);
      }
    };

    let cancelled = false;
    draw();
    queueResourceIconPreload(resource, () => {
      if (!cancelled) {
        draw();
      }
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
  bitmapPromise.then((bitmap) => resolvedBitmapCache.set(source.cacheKey, bitmap));
  return bitmapPromise;
}

export function getCachedResourceIconBitmap(
  resource?: Pick<ResourceAmount, "iconPath" | "iconAtlas">,
): ImageBitmap | undefined {
  return resolvedBitmapCache.get(getIconBitmapCacheKey(resource));
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
        cacheKey: getIconBitmapCacheKey(resource),
        x: resource.iconAtlas.x,
        y: resource.iconAtlas.y,
        width: resource.iconAtlas.width,
        height: resource.iconAtlas.height,
      });
    }

    return loadIconBitmap(image, {
      cacheKey: getIconBitmapCacheKey(resource),
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  });
}

export function queueResourceIconPreload(
  resource?: Pick<ResourceAmount, "iconPath" | "iconAtlas">,
  onReady?: () => void,
) {
  const source = resource?.iconAtlas?.imagePath ?? resource?.iconPath;
  if (!resource || !source || source.includes("/textures/rendered/")) {
    return;
  }

  const key = getIconBitmapCacheKey(resource);
  if (resolvedBitmapCache.has(key)) {
    onReady?.();
    return;
  }

  const queued = preloadQueue.get(key);
  if (queued) {
    if (onReady) {
      queued.callbacks.add(onReady);
    }
    scheduleIdlePreload();
    return;
  }

  preloadQueue.set(key, {
    resource,
    callbacks: onReady ? new Set([onReady]) : new Set(),
  });
  scheduleIdlePreload();
}

function scheduleIdlePreload() {
  if (idlePreloadScheduled || preloadQueue.size === 0 || typeof window === "undefined") {
    return;
  }

  idlePreloadScheduled = true;
  const run = (deadline?: IdleDeadline) => {
    idlePreloadScheduled = false;
    const timeRemaining = () => deadline?.timeRemaining() ?? 0;
    let processed = 0;

    while (preloadQueue.size > 0 && processed < 2 && (processed === 0 || timeRemaining() > 8)) {
      const [key, item] = preloadQueue.entries().next().value as [
        string,
        {
          resource: Pick<ResourceAmount, "iconPath" | "iconAtlas">;
          callbacks: Set<() => void>;
        },
      ];
      preloadQueue.delete(key);
      processed += 1;
      void preloadResourceIconCanvas(item.resource).then(() => {
        item.callbacks.forEach((callback) => callback());
      });
    }

    if (preloadQueue.size > 0) {
      scheduleIdlePreload();
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run);
    return;
  }

  globalThis.setTimeout(() => run(), 60);
}

function getIconBitmapCacheKey(resource?: Pick<ResourceAmount, "iconPath" | "iconAtlas">) {
  const source = resource?.iconAtlas?.imagePath ?? resource?.iconPath ?? "";
  if (resource?.iconAtlas) {
    return `${source}:${resource.iconAtlas.x}:${resource.iconAtlas.y}:${resource.iconAtlas.width}:${resource.iconAtlas.height}`;
  }

  return source;
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
