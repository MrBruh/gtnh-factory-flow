# Agent Guide

This project uses Next.js App Router, TypeScript strict mode, Tailwind CSS, React Flow,
Zustand, Zod, and Vitest.

## Next.js

This repository was created with a modern Next.js version. If framework behavior is
unclear, read the relevant guide in `node_modules/next/dist/docs/` before changing app
routing, layout, metadata, or client/server component boundaries.

## TypeScript

- Keep TypeScript strict and avoid `any`.
- Prefer small, named modules over large mixed-purpose files.
- Keep UI code separate from calculation code.
- Use normalized domain types from `src/lib/model/`.
- Validate import/export boundaries with Zod.
- Do not reintroduce manual recipe creation in the UI unless explicitly requested.

## GTNH Data Rules

- Never hardcode real GTNH values without a source.
- Never generate or invent Minecraft item/fluid icons. Use `iconPath` only when it points
  to a real texture extracted from the selected GTNH build, or leave the slot iconless.
- Demo values must remain clearly marked as demo data and must not be exposed as the main
  GTNH recipe source.
- Do not claim demo recipes, fuel values, EU/t, or durations are authoritative.
- Do not mix raw NESQL, RecEx, or NERD exporter output with the normalized app model.
- Future dataset import code should normalize raw data before it reaches the UI or solver.

## Solver Rules

- The solver must stay pure, deterministic for the same inputs, and independent from React.
- Any new formula needs a unit test.
- Keep Minecraft tick math explicit. The MVP assumes 20 ticks per second.
- Do not hide utilization above 100 percent. UI may cap bars visually, but values must remain visible.

## UI Rules

- Use React Flow only for graph presentation and interactions.
- Store project state in Zustand and persist plans through localStorage.
- Keep recipe data read-only in the UI; recipes come from normalized datasets.
- Prefer concise controls and operational UI over landing-page content.

## Commands

```bash
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
```
