import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { DirectoryShell } from "@/components/apps/directory-shell";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "/apps",
  "Publish your app with Fletch",
  "Build an app, publish it when you are ready, and submit an owner-controlled listing to the Fletch beta app directory.",
);

export default function AppsPage(): ReactElement {
  const steps = [
    {
      title: "Build and try it",
      body: "Describe your app in the builder. Review its saved preview and test the parts people will use.",
    },
    {
      title: "Publish the live app",
      body: "Choose Publish live app when the preview is ready. Fletch hosts that version at your app’s address.",
    },
    {
      title: "Introduce it to the directory",
      body: "Open your project, add its name and descriptions, then submit the listing. An admin reviews it before it becomes public.",
    },
  ];
  return (
    <DirectoryShell>
      <div className="grid gap-10 py-5 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-12">
        <section>
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-hood-deep">
            Fletch apps · Beta
          </p>
          <h1 className="display text-balance text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.03] tracking-tight">
            Give your app
            <br />a public home.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-ink-soft">
            From a saved preview to a live site, then a page people can discover
            and share. You decide when your app is ready.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dashboard/projects"
              className="inline-flex min-h-12 items-center rounded-full bg-hood px-6 text-sm font-semibold text-ink hover:bg-hood-strong"
            >
              List one of your apps
            </Link>
            <Link
              href="/published"
              className="inline-flex min-h-12 items-center rounded-full border border-line-strong px-6 text-sm font-medium hover:bg-panel"
            >
              Browse published apps ↗
            </Link>
          </div>
          <p className="mt-6 text-sm leading-6 text-ink-soft">
            Starting from scratch?{" "}
            <Link
              href="/dashboard/build"
              className="text-hood-deep underline underline-offset-4"
            >
              Build an app
            </Link>
            .
          </p>
        </section>
        <ol className="divide-y divide-line rounded-2xl border border-line bg-raised px-6 sm:px-8">
          {steps.map(function step(item, index) {
            return (
              <li key={item.title} className="flex gap-5 py-7">
                <span className="font-mono text-sm text-hood-deep">
                  0{index + 1}
                </span>
                <div>
                  <h2 className="display text-xl">{item.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-ink-soft">
                    {item.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <section className="mt-8 grid gap-6 border-t border-line pt-8 text-sm leading-7 text-ink-soft sm:grid-cols-2">
        <div>
          <h2 className="font-semibold text-ink">
            Your listing, under your control
          </h2>
          <p className="mt-2">
            Save a private draft, submit for review, edit the details or unlist
            at any time. Publishing a new app version requires a fresh directory
            review.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-ink">
            Token details with evidence
          </h2>
          <p className="mt-2">
            Link a token recorded for your project. Its page shows the contract
            address, network, metadata check and source verification status.
            Testnet tokens stay labelled as testnet.
          </p>
        </div>
      </section>
    </DirectoryShell>
  );
}
