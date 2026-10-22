"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { StratBuilder } from "./StratBuilder";
import { StratViewer } from "./StratViewer";
import { StratDashboard } from "./StratDashboard";
import { AccountPanel, RailAccountEntry, useAccountController } from "./AccountPanel";
import SquishSwitch from "./SquishSwitch";
import type { TacticalMap } from "./map-data";

type AppMode = "dashboard" | "editor" | "viewer" | "settings";
type SettingsTab = "view" | "general" | "editor" | "account";
type Theme = "dark" | "light";

const themeStorageKey = "r6-stratshare-theme";
let currentTheme: Theme | undefined;

function getTheme(): Theme {
  if (currentTheme) return currentTheme;
  try {
    const savedTheme = window.localStorage.getItem(themeStorageKey);
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  } catch {
    // Theme switching also works when browser storage is unavailable.
  }
  return "dark";
}

function subscribeToTheme(listener: () => void) {
  const onStorageChange = () => {
    currentTheme = undefined;
    listener();
  };
  window.addEventListener("storage", onStorageChange);
  window.addEventListener("stratshare-theme-change", listener);
  return () => {
    window.removeEventListener("storage", onStorageChange);
    window.removeEventListener("stratshare-theme-change", listener);
  };
}

function changeTheme(theme: Theme) {
  currentTheme = theme;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Retain the selected theme for this session without persistence.
  }
  window.dispatchEvent(new Event("stratshare-theme-change"));
}

function getServerTheme(): Theme { return "dark"; }

export type SlotDetailViewSettings = {
  showOtherOperators: boolean;
  showOtherLines: boolean;
  showOtherGadgets: boolean;
};

const defaultSlotDetailViewSettings: SlotDetailViewSettings = {
  showOtherOperators: false,
  showOtherLines: false,
  showOtherGadgets: false,
};

const navItems: Array<{ id: AppMode; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "editor", label: "Strat Editor" },
  { id: "viewer", label: "View Strat" },
  { id: "settings", label: "Settings" },
];

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "view", label: "Slot Detail View" },
  { id: "account", label: "Account" },
];

function getModeHref(mode: AppMode) {
  if (mode === "dashboard") {
    return "#dashboard";
  }
  if (mode === "editor") {
    return "#strat-editor";
  }

  if (mode === "viewer") {
    return "#view-strat";
  }

  return "#settings";
}

function RailNavigationIcon({ mode }: { mode: AppMode }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {mode === "dashboard" ? <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>
        : mode === "editor" ? <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3a2 2 0 0 1 3 3l-9 9-4 1 1-4Z" />
        : mode === "viewer" ? <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16" />
        : <><path d="M4 6h8m4 0h4M4 12h2m4 0h10M4 18h10m4 0h2" /><circle cx="14" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>}
    </svg>
  );
}

function SettingsOption({title, description, checked, onChange, appearance = false, fdId}: {title: string; description: string; checked: boolean; onChange: (checked: boolean) => void; appearance?: boolean; fdId?: string}) {
  return (
    <div className="settings-option" data-fd-id={fdId}>
      <span className="settings-option-copy"><strong>{title}</strong><small>{description}</small></span>
      <SquishSwitch className="settings-switch" ariaLabel={title} checked={checked} onChange={onChange} width={48} height={26} radius={13}
        trackColor="var(--panel-3)" trackOnColor="var(--teal)" thumbColor="var(--muted)" thumbOnColor="var(--bg)"
        thumbContent={appearance ? <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{checked ? <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>}</svg> : undefined}
      />
    </div>
  );
}

export function StratAppShell({ maps }: { maps: TacticalMap[] }) {
  const [activeMode, setActiveMode] = useState<AppMode>("dashboard");
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("general");
  const [advancedEditorMode, setAdvancedEditorMode] = useState(false);
  useEffect(() => {
    try { setAdvancedEditorMode(window.localStorage.getItem("r6-stratshare-advanced-editor") === "true"); } catch { /* Keep the default when storage is unavailable. */ }
  }, []);
  function changeAdvancedEditorMode(enabled: boolean) {
    setAdvancedEditorMode(enabled);
    try { window.localStorage.setItem("r6-stratshare-advanced-editor",String(enabled)); } catch { /* Retain this session's preference. */ }
  }
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const [slotDetailViewSettings, setSlotDetailViewSettings] = useState<SlotDetailViewSettings>(
    defaultSlotDetailViewSettings,
  );
  const accountController = useAccountController();

  function openAccountSettings() {
    setActiveMode("settings");
    setActiveSettingsTab("account");
  }

  return (
    <main className="tracker-shell editor-mode">
      <aside className="side-rail" aria-label="Site navigation">
        <a
          className="brand"
          href="#dashboard"
          aria-label="R6 StratShare home"
          onClick={() => setActiveMode("dashboard")}
        >
          <span className="brand-icon">R6</span>
          <span>
            <strong>StratShare</strong>
            <small>Strat Creator</small>
          </span>
        </a>

        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <a
              className={activeMode === item.id ? "active" : ""}
              href={getModeHref(item.id)}
              key={item.id}
              aria-current={activeMode === item.id ? "page" : undefined}
              data-fd-id={`nav-${item.id}`}
              onClick={() => setActiveMode(item.id)}
            >
              <RailNavigationIcon mode={item.id} />
              <span className="rail-link-label">{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="rail-footer" data-fd-id="section-sidebar-footer">
        <RailAccountEntry controller={accountController} onOpenAccount={openAccountSettings} />

        <div className="rail-theme-control" data-fd-id="btn-rail-dark-mode">
          <SquishSwitch
            id="rail-dark-mode"
            checked={theme === "dark"}
            onChange={(checked) => changeTheme(checked ? "dark" : "light")}
            ariaLabel="Dark Mode"
            thumbContent={
              <svg className="theme-switch-icon" data-mode={theme} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {theme === "dark" ? (
                  <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
                ) : (
                  <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>
                )}
              </svg>
            }
            width={48}
            height={26}
            radius={13}
            trackColor="var(--panel-3)"
            trackOnColor="var(--teal)"
            thumbColor="var(--muted)"
            thumbOnColor="var(--bg)"
          />
        </div>
        </div>
      </aside>

      <section className="main-area">
        <section id="dashboard" hidden={activeMode !== "dashboard"}>
          <StratDashboard maps={maps} onOpenEditor={() => setActiveMode("editor")} />
        </section>
          <section id="strat-editor" className="editor-workspace" hidden={activeMode !== "editor"}>
            <article className="panel blueprint-panel">
              <StratBuilder maps={maps} advancedMode={advancedEditorMode} />
            </article>
          </section>
          <section id="view-strat" className="editor-workspace" hidden={activeMode !== "viewer"}>
            <article className="panel blueprint-panel">
              <StratViewer maps={maps} slotDetailViewSettings={slotDetailViewSettings} />
            </article>
          </section>
          <section id="settings" className="editor-workspace" hidden={activeMode !== "settings"}>
            <article className="panel blueprint-panel settings-panel">
              <div className="settings-shell">
                <header className="settings-page-head"><h1>Settings</h1><p>Your workspace preferences.</p></header>
                <nav className="settings-tabs" aria-label="Settings sections">
                  {settingsTabs.map((tab) => (
                    <button
                      className={activeSettingsTab === tab.id ? "active" : ""}
                      aria-pressed={activeSettingsTab === tab.id}
                      key={tab.id}
                      onClick={() => setActiveSettingsTab(tab.id)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                {activeSettingsTab === "general" ? (
                  <div className="settings-group" data-fd-id="section-general-settings">
                    <div className="settings-group-head">
                      <span>General</span>
                      <h2>Choose how your workspace looks.</h2>
                    </div>
                    <SettingsOption fdId="field-settings-dark-mode" title="Dark Mode" description="Use dark surfaces throughout StratShare." checked={theme === "dark"} onChange={checked => changeTheme(checked ? "dark" : "light")} appearance />
                    <p className="settings-preference-note">Your theme preference is saved in this browser.</p>
                  </div>
                ) : activeSettingsTab === "editor" ? (
                  <div className="settings-group">
                    <div className="settings-group-head">
                      <span>Editor</span>
                      <h2>Control how wall modifications are placed.</h2>
                    </div>
                    <SettingsOption title="Advanced mode" description="Choose Left, Middle or Right after selecting holes or a rotation." checked={advancedEditorMode} onChange={changeAdvancedEditorMode} />
                  </div>
                ) : activeSettingsTab === "view" ? (
                  <div className="settings-group">
                    <div className="settings-group-head">
                      <span>Slot Detail View</span>
                      <h2>Choose what stays visible when you focus on a single player.</h2>
                    </div>

                    <SettingsOption title="Show other operators" description="Keep every slot marker visible on the layout." checked={slotDetailViewSettings.showOtherOperators} onChange={checked => setSlotDetailViewSettings(current => ({...current, showOtherOperators: checked}))} />

                    <SettingsOption title="Show other lines" description="Keep all drawing strokes visible in the focused slot view." checked={slotDetailViewSettings.showOtherLines} onChange={checked => setSlotDetailViewSettings(current => ({...current, showOtherLines: checked}))} />

                    <SettingsOption title="Show other abilities" description="Keep placed abilities from the other slots visible." checked={slotDetailViewSettings.showOtherGadgets} onChange={checked => setSlotDetailViewSettings(current => ({...current, showOtherGadgets: checked}))} />
                  </div>
                ) : activeSettingsTab === "account" ? (
                  <AccountPanel controller={accountController} />
                ) : null}
              </div>
            </article>
          </section>
      </section>
    </main>
  );
}
