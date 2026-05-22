"use client";

import { Download, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import { useFactoryStore } from "@/store/factory-store";

interface TopBarProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

export function TopBar({ onLoadDatasetVersion }: TopBarProps) {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const setProject = useFactoryStore((state) => state.setProject);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);

  const exportJson = () => {
    const json = serializeFactoryProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProjectJson = async (file: File) => {
    try {
      const text = await file.text();
      setProject(cloneImportedProject(parseFactoryProjectJson(text)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Plan import failed.");
    } finally {
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  return (
    <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex min-w-[260px] flex-1 items-start gap-2">
        <div className="grid min-w-0 gap-1">
          <h1 className="truncate text-lg font-semibold text-neutral-950">GTNH Factory Flow</h1>
          <label className="grid max-w-52 gap-0.5">
            <span className="sr-only">GTNH version</span>
            <select
              value={selectedDatasetVersionId ?? ""}
              disabled={isDatasetLoading || !manifest?.versions.length}
              onChange={(event) => onLoadDatasetVersion(event.target.value)}
              className="h-8 rounded border border-neutral-300 bg-white px-2 text-sm normal-case tracking-normal text-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
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
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToolbarButton
          icon={Trash2}
          label="Clean board"
          onClick={() => {
            if (project.nodes.length === 0 && project.edges.length === 0) {
              return;
            }

            if (!window.confirm("Clean the board and remove all nodes and links?")) {
              return;
            }

            cleanBoard();
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
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
