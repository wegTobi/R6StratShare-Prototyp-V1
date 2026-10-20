import type { Metadata } from "next";
import { StratAppShell } from "./StratAppShell";
import { tacticalMaps } from "./map-data";

export const metadata: Metadata = {
  title: "R6 StratShare | Strat Editor",
  description:
    "A custom strat builder with R6 map blueprints and operator icons.",
};

export default function Home() {
  return <StratAppShell maps={tacticalMaps} />;
}
