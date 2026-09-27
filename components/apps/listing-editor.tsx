"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
} from "react";
import Link from "@/components/ui/navigation-link";
import { LISTING_LABELS, type OwnerListing } from "@/lib/apps/types";
import { TELEGRAM_URL } from "@/lib/config";
import { suggestListingSlug } from "@/lib/apps/slug";

interface Props {
  initial: OwnerListing;
}
const FIELD =
  "mt-2 w-full rounded-xl border border-line-strong bg-paper px-3.5 py-3 text-[14px] text-ink outline-none focus:border-hood-deep focus:ring-2 focus:ring-hood/20 disabled:opacity-60";

function subscribe(): () => void {
  return function unsubscribe() {};
}
function clientReady(): boolean {
  return true;
}
function serverReady(): boolean {
  return false;
}

export function ListingEditor({ initial }: Props): ReactElement {
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [data, setData] = useState(initial);
  const [editVersion, setEditVersion] = useState(initial.listing?.version ?? 0);
  const [title, setTitle] = useState(
    initial.listing?.title ?? initial.suggested?.title ?? initial.project.name.slice(0, 60),
  );
  const [summary, setSummary] = useState(initial.listing?.summary ?? initial.suggested?.summary ?? "");
  const [slug, setSlug] = useState(initial.listing?.slug ?? suggestListingSlug(initial.listing?.title ?? initial.suggested?.title ?? initial.project.name));
  const [description, setDescription] = useState(
    initial.listing?.description ?? initial.suggested?.description ?? "",
  );
  const [tokenContractId, setToken] = useState(
    initial.listing?.tokenContractId ?? "",
  );
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  const [knownTokens] = useState(function recordedTokens() { return new Set(initial.contracts.map(function id(contract) { return contract.id; })); });
  const newTokens = data.contracts.filter(function added(contract) { return !knownTokens.has(contract.id); });
  const selectedToken = data.contracts.find(function selected(contract) { return contract.id === tokenContractId; });
  const suspended = data.listing?.state === "suspended";
  const disabled = !hydrated || Boolean(busy);
  let status = data.listing
    ? LISTING_LABELS[data.listing.state]
    : "Private draft";
  if (data.needsReview) status = "Live version needs review";
  if (data.public) status = "In the directory";

  const refresh = useCallback(async function refreshStatus(): Promise<void> {
    if (busy || document.visibilityState !== "visible" || refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    const timeout = window.setTimeout(function expire() {
      setRefreshError("Token discovery timed out. Your edits are still here. Try Refresh tokens.");
      controller.abort();
    }, 10_000);
    setRefreshing(true);
    try {
      const response = await fetch(`/api/projects/${initial.project.id}/listing`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Token discovery could not refresh. Your edits are still here. Try Refresh tokens.");
      const result: OwnerListing = await response.json();
      if (controller.signal.aborted) return;
      // Form fields and editVersion stay independent of background status reads.
      setData(result);
      setCheckedAt(new Date());
      setRefreshError(null);
    } catch {
      if (!controller.signal.aborted) setRefreshError("Token discovery could not refresh. Your edits are still here. Try Refresh tokens.");
    } finally {
      window.clearTimeout(timeout);
      if (refreshRequest.current === controller) {
        refreshRequest.current = null;
        setRefreshing(false);
      }
    }
  }, [busy, initial.project.id]);

  useEffect(function followDeployments() {
    function check(): void { void refresh(); }
    check();
    const interval = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return function stop() {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      refreshRequest.current?.abort();
      refreshRequest.current = null;
    };
  }, [refresh]);

  async function update(action: "save" | "submit" | "unlist"): Promise<void> {
    refreshRequest.current?.abort();
    refreshRequest.current = null;
    setRefreshing(false);
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${data.project.id}/listing`, {
        method: action === "unlist" ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body:
          action === "unlist"
            ? undefined
            : JSON.stringify({
                action,
                title,
                slug,
                summary,
                description,
                tokenContractId: tokenContractId || null,
                version: editVersion,
              }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "The listing could not be saved.");
      setData(result);
      setEditVersion(result.listing?.version ?? 0);
      if (result.listing?.slug) setSlug(result.listing.slug);
      setConsent(false);
      let next = "Private draft saved.";
      if (action === "submit")
        next =
          "Submitted for review. Your listing becomes public after approval.";
      if (action === "unlist")
        next =
          "Removed from the directory. Your hosted app stays at its live address.";
      setMessage(next);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The request did not finish. Reload to check the saved status.",
      );
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const action =
      button?.getAttribute("value") === "submit" ? "submit" : "save";
    if (action === "submit" && !consent) {
      setError("Confirm that these listing details can be public.");
      return;
    }
    void update(action);
  }

  return (
    <section
      id="directory-listing"
      className="mb-6 overflow-hidden rounded-card border border-line bg-raised"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
        <div>
          <h2 className="display text-xl text-ink">
            Directory listing{" "}
            <span className="ml-2 rounded-full bg-panel px-2 py-1 align-middle font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              Beta
            </span>
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            Introduce your app in the public Fletch directory. You choose the
            details below; an admin reviews them before they appear.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${data.public ? "bg-hood-wash text-hood-deep" : "bg-panel text-ink-soft"}`}
          role="status"
        >
          {status}
        </span>
      </div>
      <form
        method="post"
        onSubmit={submit}
        className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]"
      >
        <fieldset
          disabled={disabled || suspended}
          className="min-w-0 space-y-5"
        >
          <legend className="sr-only">Public app details</legend>
          {data.suggested && <div className="rounded-xl border border-line bg-panel p-3 text-sm text-ink-soft">
            <p>Start with the app description, then check the details before submitting.</p>
            <button type="button" className="mt-2 min-h-11 font-medium text-ink underline underline-offset-4" onClick={() => {
              if (!data.suggested) return;
              setTitle(data.suggested.title); setSummary(data.suggested.summary); setDescription(data.suggested.description);
            }}>Use app description</button>
          </div>}
          <label className="block text-sm font-medium">
            App name
            <input
              name="title"
              value={title}
              onChange={function change(event) {
                setTitle(event.target.value);
              }}
              minLength={3}
              maxLength={60}
              required
              className={FIELD}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm font-medium">
            Listing address
            <input name="slug" value={slug} onChange={function change(event) { setSlug(event.target.value); }} minLength={3} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" required className={`${FIELD} font-mono`} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="listing-address-help" />
            <span id="listing-address-help" className="mt-2 block break-all text-xs font-normal leading-5 text-ink-soft">
              fletch.now/published/{slug || "your-app-name"}
            </span>
            <span className="mt-1 block text-xs font-normal leading-5 text-ink-soft">Choose a short name using lowercase letters, numbers and hyphens. Previous listing links redirect here after approval. Your live app address stays the same.</span>
          </label>
          <label className="block text-sm font-medium">
            One-line description
            <textarea
              name="summary"
              value={summary}
              onChange={function change(event) {
                setSummary(event.target.value);
              }}
              minLength={20}
              maxLength={160}
              required
              rows={2}
              className={FIELD}
              placeholder="What can someone do with your app?"
            />
            <span className="mt-1 block text-right text-xs font-normal tabular-nums text-ink-faint">
              {summary.length}/160
            </span>
          </label>
          <label className="block text-sm font-medium">
            About this app
            <textarea
              name="description"
              value={description}
              onChange={function change(event) {
                setDescription(event.target.value);
              }}
              minLength={60}
              maxLength={2400}
              required
              rows={6}
              className={FIELD}
              placeholder="Explain how it works, who it is for, and any wallet or testnet requirements. Use details you want everyone to see."
            />
            <span className="mt-1 block text-right text-xs font-normal tabular-nums text-ink-faint">
              {description.length}/2400
            </span>
          </label>
          <label className="block text-sm font-medium">
            Linked token
            <select
              name="tokenContractId"
              value={tokenContractId}
              onChange={function change(event) {
                setToken(event.target.value);
              }}
              className={FIELD}
            >
              <option value="">No token displayed</option>
              {data.contracts.map(function option(contract) {
                return (
                  <option key={contract.id} value={contract.id}>
                    {contract.address.slice(0, 8)}…{contract.address.slice(-6)}{" "}
                    · {contract.chainId === 46630 ? "Testnet" : "Mainnet"}
                    {contract.published ? "" : " · App version not published"}
                  </option>
                );
              })}
            </select>
            <span className="mt-2 block text-xs font-normal leading-5 text-ink-soft">
              Choose a token deployed by this project. Fletch checks its
              on-chain metadata when you save or submit, then shows the address,
              network and check time. New tokens stay private until you select one and submit it for review.
            </span>
          </label>
          <div className="space-y-2 text-xs leading-5 text-ink-soft">
            {newTokens.length > 0 ? <p role="status" className="rise rounded-xl border border-hood/30 bg-hood-wash p-3 text-hood-deep">
              {newTokens.length === 1 ? "A new token is available" : `${newTokens.length} new tokens are available`} in Linked token.
            </p> : null}
            {selectedToken && !selectedToken.published ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              This token is deployed. Publish its app version in Build before submitting the updated listing.
            </p> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" disabled={disabled || refreshing} onClick={function refreshTokens() { void refresh(); }} className="inline-flex min-h-11 items-center gap-2 text-hood-deep underline underline-offset-4 disabled:opacity-50">
                {refreshing ? <Spinner /> : null}{refreshing ? "Checking tokens" : "Refresh tokens"}
              </button>
              <span>{checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}. ` : ""}Checks every 15 seconds while visible.</span>
            </div>
            {refreshError ? <p role="status" className="text-amber-800">{refreshError}</p> : null}
            {(data.listing?.version ?? 0) !== editVersion ? <p role="status" className="text-amber-800">This listing changed in another tab. Copy your edits before reloading to see the saved version.</p> : null}
            <Link href={`/dashboard/build?project=${data.project.id}&p=${encodeURIComponent("Add an ERC-20 token to this app while preserving its existing game or app contracts and state. Ask me for the token name, ticker and supply before implementing if I have not supplied them. Use the platform's supported deployment flow, test token permissions and transfers, and connect the frontend to the correct game and token addresses.")}`} className="inline-flex min-h-11 items-center font-medium text-hood-deep underline underline-offset-4">
              Add a token with AI ↗
            </Link>
            <p>Opens a draft prompt in this project. Review it and click Ship to start.</p>
          </div>
        </fieldset>
        <div className="min-w-0 space-y-5">
          <div className="rounded-xl border border-line bg-panel/50 p-4 text-sm leading-6 text-ink-soft">
            <h3 className="font-semibold text-ink">What becomes public</h3>
            <p className="mt-2">
              The name, descriptions, live app link and selected token details
              form your listing and share image. They can appear in search
              results and the public API.
            </p>
            <p className="mt-2">
              Your prompts, source files and build logs stay in your dashboard.
              Editing a listing or publishing a new app version requires another
              review.
            </p>
          </div>
          {data.listing?.reviewNote ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">
              <h3 className="font-medium">Admin feedback</h3>
              <p className="mt-1 whitespace-pre-wrap break-words">
                {data.listing.reviewNote}
              </p>
            </div>
          ) : null}
          {suspended ? (
            <p className="text-sm leading-6 text-ink-soft">
              Contact{" "}
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer"
                className="text-hood-deep underline"
              >
                Fletch on Telegram
              </a>{" "}
              to request a review of this listing.
            </p>
          ) : (
            <>
              {data.project.liveUrl ? (
                <a
                  href={data.project.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-sm text-hood-deep underline underline-offset-4"
                >
                  Open the published app ↗
                </a>
              ) : (
                <p className="text-sm leading-6 text-ink-soft">
                  Save these details now.{" "}
                  <Link
                    href={`/dashboard/build?project=${data.project.id}`}
                    className="text-hood-deep underline"
                  >
                    Publish your app in the builder
                  </Link>{" "}
                  before submitting the listing.
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={function change(event) {
                    setConsent(event.target.checked);
                  }}
                  disabled={disabled}
                  className="mt-1 h-5 w-5 shrink-0 accent-hood-deep"
                />
                I want these listing details and my live app link to be public
                after review.
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  value="submit"
                  disabled={disabled || !consent || !data.project.liveUrl || Boolean(selectedToken && !selectedToken.published)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-hood px-5 py-2 text-sm font-semibold text-ink hover:bg-hood-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "submit" ? (
                    <>
                      <Spinner />
                      Checking and submitting
                    </>
                  ) : (
                    "Submit for review"
                  )}
                </button>
                <button
                  type="submit"
                  value="save"
                  disabled={disabled}
                  className="min-h-11 rounded-full border border-line-strong px-4 py-2 text-sm hover:bg-panel disabled:opacity-50"
                >
                  {busy === "save" ? "Saving…" : "Save private draft"}
                </button>
              </div>
            </>
          )}
          {data.listing?.optedIn ? (
            <button
              type="button"
              onClick={function unlist() {
                void update("unlist");
              }}
              disabled={disabled}
              className="min-h-11 text-sm text-red-700 underline underline-offset-4 disabled:opacity-50"
            >
              {busy === "unlist" ? "Removing…" : "Unlist / withdraw submission"}
            </button>
          ) : null}
          {data.public ? (
            <Link
              href={`/published/${data.listing?.slug ?? data.project.slug}`}
              className="flex min-h-11 items-center text-sm font-medium text-hood-deep underline underline-offset-4"
            >
              View your public listing ↗
            </Link>
          ) : null}
          {message ? (
            <p role="status" className="text-sm leading-6 text-hood-deep">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm leading-6 text-red-700">
              {error}{" "}
              <button
                type="button"
                onClick={function reload() {
                  window.location.reload();
                }}
                className="underline"
              >
                Reload status
              </button>
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function Spinner(): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  );
}
