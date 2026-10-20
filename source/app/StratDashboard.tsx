"use client";

import { useState } from "react";
import type { TacticalMap } from "./map-data";

const likedPeriods = ["This Week", "This Month", "This Year"] as const;

const featuredExamples = [
  { slug: "clubhouse", title: "Lock down the basement", side: "Defense", floor: "Basement", column: 1, row: 1 },
  { slug: "oregon", title: "Take control upstairs", side: "Attack", floor: "2nd Floor", column: 2, row: 4 },
  { slug: "chalet", title: "Hold the top floor", side: "Defense", floor: "2nd Floor", column: 0, row: 1 },
  { slug: "bank", title: "A coordinated basement push", side: "Attack", floor: "Basement", column: 0, row: 0 },
  { slug: "coastline", title: "Build a crossfire", side: "Defense", floor: "2nd Floor", column: 2, row: 1 },
];

export function StratDashboard({ maps, onOpenEditor }: { maps: TacticalMap[]; onOpenEditor: () => void }) {
  const [likedPeriod, setLikedPeriod] = useState<(typeof likedPeriods)[number]>("This Week");
  return (
    <div className="strat-dashboard" data-fd-id="section-dashboard">
      <header className="dashboard-heading" data-fd-id="section-welcome">
        <div>
          <p className="page-kicker" data-fd-id="text-dashboard-kicker">Dashboard</p>
          <h1 data-fd-id="text-dashboard-title">Every round starts with a plan.</h1>
          <p data-fd-id="text-dashboard-intro">Find your next setup, build a strategy, and get your squad on the same page.</p>
        </div>
        <button type="button" className="dashboard-create" onClick={onOpenEditor} data-fd-id="btn-open-editor">Open Strat Editor <span aria-hidden="true">↗</span></button>
      </header>

      <section className="dashboard-discovery" aria-label="Strategy discovery" data-fd-id="section-discovery">
        <label htmlFor="dashboard-search" data-fd-id="text-search-label">Find a strat. Find a player.</label>
        <div className="dashboard-search" data-fd-id="field-dashboard-search">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input id="dashboard-search" type="search" placeholder="Search by strat name or username..." disabled aria-describedby="dashboard-search-note" />
          <span className="dashboard-status" data-fd-id="pill-search-status">Coming soon</span>
        </div>
        <p id="dashboard-search-note" data-fd-id="text-search-note">Player and strat search will be available when community profiles and shared strats launch.</p>
      </section>

      <section className="dashboard-featured" aria-labelledby="featured-title" data-fd-id="section-featured">
        <div className="dashboard-section-head">
          <div><p className="page-kicker">In the spotlight</p><h2 id="featured-title" data-fd-id="text-featured-title">Featured strats</h2></div>
          <span className="dashboard-status" data-fd-id="pill-featured-status">Example lineup</span>
        </div>
        <p className="dashboard-section-note" data-fd-id="text-featured-note">A preview of what is coming. These examples are not published strategies.</p>
        <div className="dashboard-featured-grid">
          {featuredExamples.map((example, index) => {
            const map = maps.find((item) => item.slug === example.slug);
            const layout = map?.layouts.find((item) => item.label === example.floor);
            return (
              <article className="dashboard-strat-card" key={example.slug} data-fd-id={`card-featured-${example.slug}`}>
                <div className="dashboard-map-art" role="img" aria-label={`${map?.name ?? example.slug} map preview`} style={{ backgroundImage: 'url("/map-previews/map-preview-sheet.webp")', backgroundPosition: `${example.column / 3 * 100}% ${example.row / 6 * 100}%`, backgroundSize: "400% 700%" }}>
                  <span className="dashboard-example">Example {String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="dashboard-card-copy">
                  <div className="dashboard-card-meta"><span>{map?.name ?? example.slug}</span><span className={example.side === "Attack" ? "dashboard-attack" : "dashboard-defense"}>{example.side}</span></div>
                  <h3 data-fd-id={`text-featured-${example.slug}`}>{example.title}</h3>
                  <p>{layout?.label ?? "Floor to be selected"} <span aria-hidden="true">·</span> 5 players</p>
                  <div className="dashboard-card-footer"><span>Community spotlight</span><span aria-hidden="true">↗</span></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dashboard-popular" aria-labelledby="popular-title" data-fd-id="section-most-liked">
        <div className="dashboard-section-head">
          <div><p className="page-kicker">Community picks</p><h2 id="popular-title" data-fd-id="text-most-liked-title">Most liked strats</h2></div>
          <div className="dashboard-popular-controls">
            <div className="dashboard-period-filter" role="group" aria-label="Most liked time period" aria-describedby="dashboard-likes-note" data-fd-id="field-likes-period">
              {likedPeriods.map((period) => (
                <button type="button" key={period} aria-pressed={likedPeriod === period} onClick={() => setLikedPeriod(period)} data-fd-id={`btn-likes-${period.toLowerCase().replaceAll(" ", "-")}`}>{period}</button>
              ))}
            </div>
            <span className="dashboard-status" data-fd-id="pill-likes-status">Coming soon</span>
          </div>
        </div>
        <div className="dashboard-popular-empty" data-fd-id="text-most-liked-empty">
          <span className="dashboard-heart" aria-hidden="true">♡</span>
          <div><h3>Your next favorite strat belongs here.</h3><p id="dashboard-likes-note">Once sharing and likes arrive, explore the strategies the community rates highest.</p></div>
        </div>
        <ol className="dashboard-ranking-preview" aria-label="Future community ranking preview" data-fd-id="list-most-liked-preview">
          {Array.from({ length: 6 }, (_, index) => <li key={index} data-fd-id={`row-ranking-${index + 1}`}><span className="dashboard-rank">{String(index + 1).padStart(2, "0")}</span><span className="dashboard-ranking-art" aria-hidden="true" /><div><strong>Future community strat</strong><span>Map, author and team setup</span></div><span className="dashboard-ranking-likes">♡ <span>—</span></span></li>)}
        </ol>
      </section>
    </div>
  );
}
