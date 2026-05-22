"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  DEFAULT_DATASET_MANIFEST_URL,
  fetchDatasetManifest,
  pickDefaultDatasetVersion,
} from "@/lib/datasets";
import { initRecipeDatasetVersion } from "@/lib/datasets/browser-loader";
import { parseFactoryProjectJson } from "@/lib/import-export";
import { LOCAL_STORAGE_KEY, loadResourceHistory, useFactoryStore } from "@/store/factory-store";
import { FactoryFlow } from "./flow/FactoryFlow";
import { RecipeBrowser } from "./RecipeBrowser";
import { TopBar } from "./TopBar";

export function FactoryPlannerApp() {
  const project = useFactoryStore((state) => state.project);
  const markHydratedProject = useFactoryStore((state) => state.markHydratedProject);
  const hydrateResourceHistory = useFactoryStore((state) => state.hydrateResourceHistory);
  const setDatasetManifest = useFactoryStore((state) => state.setDatasetManifest);
  const setDataset = useFactoryStore((state) => state.setDataset);
  const setDatasetLoading = useFactoryStore((state) => state.setDatasetLoading);
  const setDatasetError = useFactoryStore((state) => state.setDatasetError);
  const hydratedRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  const loadDatasetVersion = useCallback(
    async (versionId: string) => {
      const state = useFactoryStore.getState();
      const manifest = state.datasetManifest;
      const manifestUrl = state.datasetManifestUrl ?? DEFAULT_DATASET_MANIFEST_URL;
      const version = manifest?.versions.find((entry) => entry.id === versionId);

      if (!manifest || !version) {
        setDatasetError(`Dataset version "${versionId}" is not available in the manifest.`);
        return;
      }

      try {
        setDatasetLoading(true);
        const dataset = await initRecipeDatasetVersion(manifestUrl, version);
        setDataset(dataset);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dataset load failed.";
        setDatasetError(message);
      }
    },
    [setDataset, setDatasetError, setDatasetLoading],
  );

  useEffect(() => {
    const cancelHydration = scheduleIdleWork(() => {
      hydrateResourceHistory(loadResourceHistory());

      const storedProject = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedProject) {
        try {
          markHydratedProject(parseFactoryProjectJson(storedProject));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Stored plan could not be loaded.";
          console.error(message);
        }
      }
      hydratedRef.current = true;
    }, 800);

    return cancelHydration;
  }, [hydrateResourceHistory, markHydratedProject]);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest() {
      try {
        setDatasetLoading(true);
        const manifest = await fetchDatasetManifest(DEFAULT_DATASET_MANIFEST_URL);
        if (cancelled) {
          return;
        }

        setDatasetManifest(manifest, DEFAULT_DATASET_MANIFEST_URL);
        if (!pickDefaultDatasetVersion(manifest)) {
          setDatasetLoading(false);
          return;
        }

        void loadDatasetVersion(pickDefaultDatasetVersion(manifest)!.id);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Dataset manifest load failed.";
        setDatasetError(message);
      }
    }

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [loadDatasetVersion, setDatasetError, setDatasetLoading, setDatasetManifest]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }

    if (saveTimeoutRef.current !== undefined) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      scheduleIdleWork(() => {
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, `${JSON.stringify(project)}\n`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Plan could not be saved locally.";
          console.error(message);
        }
      }, 1200);
    }, 350);

    return () => {
      if (saveTimeoutRef.current !== undefined) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [project]);

  return (
    <div className="flex h-screen min-h-[720px] flex-col bg-neutral-100 text-neutral-950">
      <TopBar onLoadDatasetVersion={loadDatasetVersion} />
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <RecipeBrowser />
        <FactoryFlow />
      </main>
    </div>
  );
}

function scheduleIdleWork(callback: () => void, timeout: number) {
  const browserWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

  if (browserWindow.requestIdleCallback && browserWindow.cancelIdleCallback) {
    const idleId = browserWindow.requestIdleCallback(callback, { timeout });
    return () => browserWindow.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timeoutId);
}
