"use client";

import {
  ChevronDown,
  Download,
  FileImage,
  ImageDown,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cloneImportedProject,
  parseFactoryProjectJson,
  serializeFactoryProject,
} from "@/lib/import-export";
import {
  FLOW_IMAGE_EXPORT_EVENT,
  extractProjectJsonFromPng,
  extractProjectJsonFromSvg,
} from "@/lib/import-export/plan-image";
import { useFactoryStore } from "@/store/factory-store";

interface TopBarProps {
  onLoadDatasetVersion: (versionId: string) => void;
}

export function TopBar({ onLoadDatasetVersion }: TopBarProps) {
  const projectInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setExportMenuOpen] = useState(false);
  const project = useFactoryStore((state) => state.project);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const isDatasetLoading = useFactoryStore((state) => state.isDatasetLoading);
  const setProject = useFactoryStore((state) => state.setProject);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);
  const optimizeMachineCounts = useFactoryStore((state) => state.optimizeMachineCounts);

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

  const exportImage = (format: "svg" | "png") => {
    setExportMenuOpen(false);
    window.dispatchEvent(
      new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
        detail: {
          format,
          fileName: project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory",
          projectJson: serializeFactoryProject(project),
        },
      }),
    );
  };

  const importProjectJson = async (file: File) => {
    try {
      const text = await readProjectFile(file);
      setProject(cloneImportedProject(parseFactoryProjectJson(text)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Plan import failed.");
    } finally {
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  useEffect(() => {
    const closeExportMenu = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", closeExportMenu);
    return () => window.removeEventListener("mousedown", closeExportMenu);
  }, []);

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
        <button
          type="button"
          onClick={optimizeMachineCounts}
          disabled={project.nodes.length === 0}
          title="Set every machine count to its suggested best ratio"
          className="inline-flex h-9 items-center justify-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-100 disabled:text-neutral-400"
        >
          <WandSparkles className="h-4 w-4" />
          <span>Best ratios</span>
        </button>
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
          label="Import plan"
          onClick={() => projectInputRef.current?.click()}
        />
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((isOpen) => !isOpen)}
            title="Export plan"
            aria-label="Export plan"
            aria-expanded={isExportMenuOpen}
            className="inline-flex h-9 items-center justify-center gap-1 rounded border border-neutral-300 bg-white px-2 text-neutral-800 hover:bg-neutral-50"
          >
            <Download className="h-4 w-4" />
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {isExportMenuOpen ? (
            <div className="absolute right-0 top-10 z-50 min-w-44 border border-neutral-300 bg-white py-1 text-sm shadow-lg">
              <ExportMenuItem
                icon={Download}
                label="Export plan JSON"
                onClick={() => {
                  setExportMenuOpen(false);
                  exportJson();
                }}
              />
              <ExportMenuItem
                icon={FileImage}
                label="Export plan SVG"
                onClick={() => exportImage("svg")}
              />
              <ExportMenuItem
                icon={ImageDown}
                label="Export plan PNG"
                onClick={() => exportImage("png")}
              />
            </div>
          ) : null}
        </div>
      </div>

      <input
        ref={projectInputRef}
        type="file"
        accept="application/json,image/svg+xml,image/png,.json,.svg,.png"
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

async function readProjectFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "svg" || file.type === "image/svg+xml") {
    const projectJson = extractProjectJsonFromSvg(await file.text());
    if (!projectJson) {
      throw new Error("This SVG does not contain a GTNH Factory Flow plan.");
    }
    return projectJson;
  }

  if (extension === "png" || file.type === "image/png") {
    const projectJson = await extractProjectJsonFromPng(file);
    if (!projectJson) {
      throw new Error("This PNG does not contain a GTNH Factory Flow plan.");
    }
    return projectJson;
  }

  return file.text();
}

function ExportMenuItem({
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
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-neutral-800 hover:bg-neutral-100"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
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
