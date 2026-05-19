"use client";

import { Calculator, Database, Download, FileJson, Upload } from "lucide-react";
import { useRef } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import type { ResourceKind, TargetRate } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";

interface TopBarProps {
  onLoadDatasetVersion: (versionId: string) => void;
  onNotice: (message: string) => void;
}

export function TopBar({ onLoadDatasetVersion, onNotice }: TopBarProps) {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const dataset = useFactoryStore((state) => state.dataset);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const datasetError = useFactoryStore((state) => state.datasetError);
  const setProject = useFactoryStore((state) => state.setProject);
  const setTargetRate = useFactoryStore((state) => state.setTargetRate);
  const recalculate = useFactoryStore((state) => state.recalculate);

  const targetRate = project.targetRate ?? {
    kind: "fluid",
    resourceId: "",
    amountPerSecond: 0,
  };

  const updateTarget = (patch: Partial<TargetRate>) => {
    const nextTarget = {
      ...targetRate,
      ...patch,
    };

    if (nextTarget.resourceId && nextTarget.amountPerSecond > 0) {
      setTargetRate(nextTarget);
    } else {
      setTargetRate(undefined);
    }
  };

  const exportJson = () => {
    const json = serializeFactoryProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotice("Plan exported as JSON.");
  };

  const importProjectJson = async (file: File) => {
    try {
      const text = await file.text();
      setProject(cloneImportedProject(parseFactoryProjectJson(text)));
      onNotice("Plan imported.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Plan import failed.");
    } finally {
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  return (
    <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex min-w-[260px] flex-1 items-center gap-2">
        <FileJson className="h-5 w-5 text-cyan-700" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-neutral-950">GTNH Factory Flow</h1>
          <p className="truncate text-xs text-neutral-500">
            {datasetError ??
              (dataset
                ? `Dataset ${dataset.gtnhVersion} from ${dataset.sourceInfo.sourceId}`
                : isDatasetLoading
                  ? "Loading GTNH dataset..."
                  : "No recipe dataset loaded")}
          </p>
        </div>
      </div>

      <label className="grid gap-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        GTNH version
        <select
          value={selectedDatasetVersionId ?? ""}
          disabled={isDatasetLoading || !manifest?.versions.length}
          onChange={(event) => onLoadDatasetVersion(event.target.value)}
          className="h-8 min-w-48 rounded border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
        >
          {manifest?.versions.length ? (
            manifest.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.gtnhVersion} ({version.channel})
              </option>
            ))
          ) : (
            <option value="">No versions</option>
          )}
        </select>
      </label>

      <div className="flex flex-wrap items-end gap-2 rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5">
        <label className="grid gap-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Target kind
          <select
            value={targetRate.kind}
            onChange={(event) => updateTarget({ kind: event.target.value as ResourceKind })}
            className="h-8 rounded border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900"
          >
            <option value="item">Item</option>
            <option value="fluid">Fluid</option>
          </select>
        </label>
        <label className="grid gap-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Target resource
          <input
            value={targetRate.resourceId}
            onChange={(event) => updateTarget({ resourceId: event.target.value })}
            placeholder="fluid or item id"
            className="h-8 w-40 rounded border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900"
          />
        </label>
        <label className="grid gap-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Rate/s
          <input
            type="number"
            min="0"
            step="0.001"
            value={targetRate.amountPerSecond}
            onChange={(event) => updateTarget({ amountPerSecond: Number(event.target.value) })}
            className="h-8 w-24 rounded border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToolbarButton
          icon={Database}
          label="Reload dataset"
          onClick={() => {
            if (selectedDatasetVersionId) {
              onLoadDatasetVersion(selectedDatasetVersionId);
            } else {
              onNotice("No GTNH dataset version is available yet.");
            }
          }}
        />
        <ToolbarButton
          icon={Calculator}
          label="Calculate"
          onClick={() => {
            recalculate();
            onNotice("Throughput recalculated.");
          }}
        />
        <ToolbarButton
          icon={Upload}
          label="Import plan JSON"
          onClick={() => projectInputRef.current?.click()}
        />
        <ToolbarButton icon={Download} label="Export plan JSON" onClick={exportJson} />
      </div>

      <input
        ref={projectInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void importProjectJson(file);
          }
        }}
      />
    </header>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
