"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { isSelfHosted } from "./deployment";
import {
  CHATGPT_SIGN_IN_PATH,
  CHATGPT_SIGN_OUT_PATH,
  fetchAccountState,
  getUsernameFormatError,
  normalizeUsername,
  saveAccountUsername,
  toAccountError,
  usernameMaxLength,
  usernameMinLength,
  type AccountError,
  type AccountProfile,
  type AccountUsernameMode,
} from "./account-client";

type AccountLoadState =
  | { status: "loading" }
  | { status: "ready"; signedIn: boolean; account: AccountProfile | null }
  | { status: "error"; loadError: AccountError };

export type AccountController = {
  status: "loading" | "ready" | "error";
  signedIn: boolean;
  account: AccountProfile | null;
  loadError: AccountError | null;
  actionError: AccountError | null;
  notice: string | null;
  isSaving: boolean;
  reload: () => void;
  saveUsername: (value: string) => Promise<boolean>;
};

export function useAccountController(): AccountController {
  const [load, setLoad] = useState<AccountLoadState>({ status: "loading" });
  const [actionError, setActionError] = useState<AccountError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const requestIdRef = useRef(0);

  const reload = useCallback(() => {
    if (isSelfHosted) {
      setLoad({ status: "ready", signedIn: false, account: null });
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoad({ status: "loading" });
    setActionError(null);
    setNotice(null);

    void fetchAccountState().then(
      (state) => {
        if (requestIdRef.current !== requestId) return;
        setLoad({ status: "ready", signedIn: state.signedIn, account: state.account });
      },
      (error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setLoad({ status: "error", loadError: toAccountError(error) });
      },
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keeps the visible conflict message when the refresh itself fails.
  const refreshStoredAccount = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    try {
      const state = await fetchAccountState();
      if (requestIdRef.current !== requestId) return;
      setLoad({ status: "ready", signedIn: state.signedIn, account: state.account });
    } catch {
      // The form keeps showing the original account error.
    }
  }, []);

  const saveUsername = useCallback(
    async (value: string) => {
      const formatError = getUsernameFormatError(value);
      if (formatError) {
        setActionError(formatError);
        setNotice(null);
        return false;
      }
      if (load.status !== "ready") return false;

      const mode: AccountUsernameMode = load.account ? "update" : "create";
      setIsSaving(true);
      setActionError(null);
      setNotice(null);

      try {
        const state = await saveAccountUsername(value, mode);
        setLoad({ status: "ready", signedIn: state.signedIn, account: state.account });
        if (state.account) setNotice(`Username saved as ${state.account.username}.`);
        return true;
      } catch (error) {
        const accountError = toAccountError(error);
        if (accountError.code === "UNAUTHORIZED") {
          setLoad({ status: "ready", signedIn: false, account: null });
          return false;
        }
        setActionError(accountError);
        if (accountError.code === "ACCOUNT_EXISTS") void refreshStoredAccount();
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [load, refreshStoredAccount],
  );

  return {
    status: load.status,
    signedIn: load.status === "ready" ? load.signedIn : false,
    account: load.status === "ready" ? load.account : null,
    loadError: load.status === "error" ? load.loadError : null,
    actionError,
    notice,
    isSaving,
    reload,
    saveUsername,
  };
}

export function AccountPanel({ controller }: { controller: AccountController }) {
  return (
    <div className="settings-group" data-fd-id="section-account-settings">
      <div className="settings-group-head">
        <span>Account</span>
        <h2>{isSelfHosted ? "Accounts are not available on this server yet." : "Sign in with ChatGPT to claim a username for your strats and drafts."}</h2>
      </div>
      <AccountPanelBody controller={controller} />
    </div>
  );
}

function AccountPanelBody({ controller }: { controller: AccountController }) {
  if (isSelfHosted) {
    return <p className="account-state-copy" role="status">Use JSON import and export to keep and share your strats.</p>;
  }
  if (controller.status === "loading") {
    return (
      <p className="account-status" role="status">
        Loading your account...
      </p>
    );
  }

  if (controller.status === "error") {
    return (
      <div className="account-card">
        <p className="account-feedback is-error" role="alert">
          <strong>Account unavailable</strong>
          {controller.loadError?.message}
        </p>
        <div className="account-actions">
          <button
            className="account-button secondary"
            type="button"
            onClick={controller.reload}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!controller.signedIn) {
    return (
      <div className="account-card">
        <span className="account-identity">
          <small>Not signed in</small>
          <strong>Sign in to keep your username</strong>
        </span>
        <p className="account-state-copy">
          Sign in with ChatGPT to create a username, then use it to identify your strats.
        </p>
        <div className="account-actions">
          <a className="account-button primary" href={CHATGPT_SIGN_IN_PATH}>
            Sign in with ChatGPT
          </a>
        </div>
      </div>
    );
  }

  if (!controller.account) {
    return (
      <div className="account-card">
        <span className="account-identity">
          <small>Signed in</small>
          <strong>Create your username</strong>
        </span>
        <UsernameForm controller={controller} mode="create" />
      </div>
    );
  }

  return (
    <div className="account-card">
      <span className="account-identity">
        <small>Signed in as</small>
        <strong>@{controller.account.username}</strong>
      </span>
      <UsernameForm controller={controller} mode="update" />
    </div>
  );
}

function UsernameForm({
  controller,
  mode,
}: {
  controller: AccountController;
  mode: AccountUsernameMode;
}) {
  const currentUsername = controller.account?.username ?? "";
  const [draft, setDraft] = useState(currentUsername);
  useEffect(() => {
    setDraft(currentUsername);
  }, [currentUsername]);

  const trimmedDraft = draft.trim();
  const isChanged = normalizeUsername(trimmedDraft) !== currentUsername;
  const canSubmit = trimmedDraft.length > 0 && (mode === "create" || isChanged);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await controller.saveUsername(trimmedDraft);
  }

  return (
    <form className="account-form" data-fd-id="form-account-username" onSubmit={handleSubmit}>
      <label className="account-field">
        Username
        <input
          name="username"
          type="text"
          value={draft}
          maxLength={usernameMaxLength}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="e.g. thermite_main"
          aria-describedby="account-username-rules"
          aria-invalid={controller.actionError ? true : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <p className="account-hint" id="account-username-rules">
        {usernameMinLength}-{usernameMaxLength} characters: a-z, 0-9, and underscores. Saved in
        lowercase.
      </p>
      {controller.actionError ? (
        <p className="account-feedback is-error" role="alert">
          {controller.actionError.message}
        </p>
      ) : null}
      {controller.notice ? (
        <p className="account-feedback is-success" role="status">
          {controller.notice}
        </p>
      ) : null}
      <div className="account-actions">
        <button
          className="account-button primary"
          type="submit"
          disabled={controller.isSaving || !canSubmit}
        >
          {controller.isSaving
            ? mode === "create"
              ? "Creating..."
              : "Saving..."
            : mode === "create"
              ? "Create username"
              : "Save changes"}
        </button>
        <a className="account-button secondary" href={CHATGPT_SIGN_OUT_PATH}>
          Sign out
        </a>
      </div>
    </form>
  );
}

export function RailAccountEntry({
  controller,
  onOpenAccount,
}: {
  controller: AccountController;
  onOpenAccount: () => void;
}) {
  return (
    <div className="rail-account" data-fd-id="rail-account-entry">
      <span className="rail-account-avatar" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
      </span>
      <div className="rail-account-copy">
      <span className="rail-account-kicker">Account</span>
      {isSelfHosted ? <p className="rail-account-status" role="status">Coming soon</p> : <>
      {controller.status === "loading" ? (
        <p className="rail-account-status" role="status">
          Checking sign-in...
        </p>
      ) : null}
      {controller.status === "error" ? (
        <>
          <p className="rail-account-status is-error" role="alert">
            Account unavailable
          </p>
          <button
            className="rail-account-action"
            type="button"
            onClick={controller.reload}
          >
            Try again
          </button>
        </>
      ) : null}
      {controller.status === "ready" && !controller.signedIn ? (
        <a className="rail-account-action" href={CHATGPT_SIGN_IN_PATH}>
          Sign in with ChatGPT
        </a>
      ) : null}
      {controller.status === "ready" && controller.signedIn && !controller.account ? (
        <button className="rail-account-action" type="button" onClick={onOpenAccount}>
          Set up username
        </button>
      ) : null}
      {controller.account ? (
        <>
          <button
            className="rail-account-user"
            type="button"
            onClick={onOpenAccount}
            title={`@${controller.account.username}`}
          >
            @{controller.account.username}
          </button>
          <a className="rail-account-signout" href={CHATGPT_SIGN_OUT_PATH}>
            Sign out
          </a>
        </>
      ) : null}
      </>}
      </div>
    </div>
  );
}
