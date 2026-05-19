"use client";

import { AlertTriangle } from "lucide-react";
import type { Recipe, ResourceAmount } from "@/lib/model/types";
import { formatRate } from "@/lib/model";
import { ResourceIcon } from "./nei/ResourceIcon";

interface NeiRecipeCardProps {
  recipe: Recipe;
  compact?: boolean;
}

export function NeiRecipeCard({ recipe, compact = false }: NeiRecipeCardProps) {
  const inputs = recipe.inputs;
  const outputs = recipe.outputs;
  const durationSeconds = recipe.durationTicks / 20;
  const totalEu = recipe.eut * recipe.durationTicks;

  return (
    <article className="mx-auto w-full max-w-[390px] border-2 border-[#f4f4f4] bg-[#c6c6c6] font-mono text-[#202020] shadow-[inset_2px_2px_0_#ffffff,inset_-2px_-2px_0_#555]">
      <div className="relative px-2 pb-2 pt-1">
        <NeiTabs recipe={recipe} />

        <div className="mt-1 grid grid-cols-[24px_minmax(0,1fr)_24px] items-center">
          <NeiButton label="<" />
          <div className="h-7 border-2 border-[#555] bg-[#9b9b9b] px-2 text-center text-[18px] leading-[24px] text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]">
            {recipe.machineType}
          </div>
          <NeiButton label=">" />
        </div>

        <div className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-center">
          <NeiButton label="<" dark />
          <div className="h-7 border-x-2 border-b-2 border-[#555] bg-[#a7a7a7] px-2 text-center text-[18px] leading-[24px] text-white shadow-[inset_2px_0_0_#d8d8d8,inset_-2px_-2px_0_#4a4a4a] [text-shadow:2px_2px_0_#3f3f3f]">
            Page 1/1
          </div>
          <NeiButton label=">" dark />
        </div>

        <div className="mt-1 border-2 border-[#a2a2a2] bg-[#d0d0d0] p-2 shadow-[inset_2px_2px_0_#efefef,inset_-2px_-2px_0_#9a9a9a]">
          <div className="grid grid-cols-[108px_1fr_108px] items-center gap-3">
            <NeiGrid resources={inputs} />
            <div className="grid justify-items-center gap-5">
              <div className="text-[38px] leading-none text-[#efefef] [text-shadow:2px_0_0_#8f8f8f,0_2px_0_#8f8f8f]">
                =&gt;
              </div>
              <div className="h-9 w-9 rounded-full border-4 border-yellow-300 border-b-transparent bg-transparent" />
            </div>
            <NeiGrid resources={outputs} />
          </div>
        </div>

        {!compact ? (
          <footer className="mt-2 px-1 text-[18px] leading-[22px] text-black">
            <div>Total: {formatRate(totalEu, 0)} EU</div>
            <div>
              Usage: {formatRate(recipe.eut, 0)} EU/t ({recipe.minimumTier})
            </div>
            <div>Time: {formatRate(durationSeconds, 2)} seconds</div>
            {recipe.programmedCircuit ? <div>Circuit: {recipe.programmedCircuit}</div> : null}
            {recipe.source ? (
              <div className="mt-1 truncate text-[11px] leading-4 text-[#343434]">
                {recipe.source.exporter ?? "unknown"} /{" "}
                {recipe.source.datasetVersionId ?? "unknown dataset"}
              </div>
            ) : null}
            {recipe.isDemo ? (
              <div className="mt-2 flex items-start gap-2 border border-amber-700 bg-amber-200 p-1 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Demo data, not authoritative GTNH data.</span>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}

function NeiTabs({ recipe }: { recipe: Recipe }) {
  const tabs = [recipe, ...recipe.inputs.slice(0, 3)].slice(0, 4);

  return (
    <div className="ml-12 flex h-10 items-end gap-1">
      {tabs.map((entry, index) => {
        const resource = "kind" in entry ? entry : undefined;
        return (
          <div
            key={`${resource?.kind ?? "machine"}-${resource?.id ?? recipe.id}-${index}`}
            className="grid h-10 w-[43px] place-items-center border-2 border-[#222] bg-[#bdbdbd] shadow-[inset_2px_2px_0_#f4f4f4,inset_-2px_-2px_0_#5a5a5a]"
          >
            <ResourceIcon resource={resource} size="sm" showAmount={false} className="!h-8 !w-8" />
          </div>
        );
      })}
    </div>
  );
}

function NeiGrid({ resources }: { resources: ResourceAmount[] }) {
  const slots = Array.from({ length: 9 }, (_, index) => resources[index]);

  return (
    <div className="grid grid-cols-3 gap-0">
      {slots.map((resource, index) => (
        <ResourceIcon
          key={`${resource?.kind ?? "empty"}-${resource?.id ?? index}-${index}`}
          resource={resource}
          size="md"
          showName={false}
          className="!h-9 !w-9"
        />
      ))}
    </div>
  );
}

function NeiButton({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={[
        "h-7 w-6 border-2 border-[#252525] text-[18px] leading-5 text-white shadow-[inset_2px_2px_0_#d8d8d8,inset_-2px_-2px_0_#404040] [text-shadow:1px_1px_0_#000]",
        dark ? "bg-[#5d5d5d]" : "bg-[#9b9b9b]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
