import type { ReactElement, ReactNode } from "react";
import {
  docDiagrams,
  type DiagramNode,
  type DiagramPath,
  type DocDiagramId,
} from "@/lib/docs/diagrams";

function Arrow({ horizontal = false }: { horizontal?: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={`mx-auto h-6 w-6 shrink-0 text-ink-faint ${horizontal ? "sm:-rotate-90" : ""}`}
    >
      <path d="M12 2v18m-5-5 5 5 5-5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function Node({ node, accent = false }: { node: DiagramNode; accent?: boolean }): ReactElement {
  return (
    <div className={`min-w-0 rounded-sm border border-line p-3 ${accent ? "bg-hood-wash" : "bg-panel"}`}>
      <p className={`font-mono text-[12px] font-medium leading-5 ${accent ? "text-hood-deep" : "text-ink"}`}>
        {node.label}
      </p>
      <p className="mt-1 text-[12px] leading-5 text-ink-soft">{node.detail}</p>
    </div>
  );
}

function Sequence({ path, horizontal = false }: { path: DiagramPath; horizontal?: boolean }): ReactElement {
  return (
    <div className={horizontal ? "flex min-w-0 flex-col sm:flex-row sm:items-stretch" : "flex min-w-0 flex-col"}>
      {path.nodes.map(function stage(node, index) {
        return (
          <div key={node.label} className={horizontal ? "flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center" : "min-w-0"}>
            {index > 0 ? <Arrow horizontal={horizontal} /> : null}
            <div className="min-w-0 flex-1 self-stretch"><Node node={node} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Label({ children }: { children: ReactNode }): ReactElement {
  return <p className="mb-2 font-mono text-[10px] uppercase leading-4 tracking-[0.08em] text-ink-faint">{children}</p>;
}

function BuildFlow(): ReactElement {
  const { paths, note } = docDiagrams.build;
  return (
    <>
      <Sequence path={paths.start} horizontal />
      <Arrow />
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 border border-line p-2 sm:p-3">
          <Label>{paths.contract.label}</Label>
          <Sequence path={paths.contract} />
        </div>
        <div className="flex min-w-0 flex-col border border-dashed border-line p-2 sm:p-3">
          <Label>{paths.frontendOnly.label}</Label>
          <Node node={paths.frontendOnly.nodes[0]} />
          <div className="mx-auto mt-3 min-h-8 flex-1 border-l border-dashed border-line" />
          <Arrow />
        </div>
      </div>
      <Arrow />
      <Label>{paths.finish.label}</Label>
      <Sequence path={paths.finish} horizontal />
      <p className="mt-4 border-l-2 border-hood pl-3 text-[12px] leading-5 text-ink-soft">{note}</p>
    </>
  );
}

function WatchFlow(): ReactElement {
  const { paths, note } = docDiagrams.watch;
  return (
    <>
      <Node node={paths.poll.nodes[0]} />
      <div className="my-3 border-l border-dashed border-line pl-3">
        <Label>{paths.reorg.label}</Label>
        <Sequence path={paths.reorg} horizontal />
        <p className="mt-2 font-mono text-[11px] text-ink-faint">Then continue with the log scan below.</p>
      </div>
      <Arrow />
      <Sequence path={{ label: paths.poll.label, nodes: paths.poll.nodes.slice(1) }} horizontal />
      <Arrow />
      <div className="border border-line bg-hood-wash p-3">
        <Label>{paths.commit.label}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {paths.commit.nodes.map((node) => <Node key={node.label} node={node} />)}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-hood-deep">Both commit together, even when no log matches.</p>
      </div>
      <Arrow />
      <Label>{paths.delivery.label}</Label>
      <Sequence path={paths.delivery} horizontal />
      <p className="mt-4 text-[12px] leading-5 text-ink-soft">{note}</p>
    </>
  );
}

function DataFlow(): ReactElement {
  const { paths, note } = docDiagrams.data;
  return (
    <>
      <Label>{paths.sources.label}</Label>
      <div className="grid grid-cols-2 gap-3">
        {paths.sources.nodes.map((node) => <Node key={node.label} node={node} />)}
      </div>
      <Arrow />
      <Sequence path={paths.storage} />
      <Arrow />
      <Label>{paths.readers.label}</Label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {paths.readers.nodes.map((node) => <Node key={node.label} node={node} accent />)}
      </div>
      <p className="mt-4 text-[12px] leading-5 text-ink-soft">{note}</p>
    </>
  );
}

function TrustFlow(): ReactElement {
  const { paths, note } = docDiagrams.trust;
  return (
    <>
      <div className="border border-line bg-panel p-3 text-center font-mono text-[12px] leading-5 text-ink">
        Is the address in Robinhood’s list?
      </div>
      <Arrow />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 border-l border-line pl-3">
          <Label>Yes · check the contract</Label>
          <p className="mb-3 text-[12px] leading-5 text-ink-soft">Confirmed symbol and decimals match?</p>
          <Label>Yes</Label>
          <Node node={paths.listed.nodes[0]} accent />
          <div className="mt-3"><Label>Not yet confirmed</Label></div>
          <Node node={paths.listed.nodes[1]} />
        </div>
        <div className="min-w-0 border-l border-line pl-3">
          <Label>No · check for a collision</Label>
          <p className="mb-3 text-[12px] leading-5 text-ink-soft">Does it match a verified asset?</p>
          <Label>Yes</Label>
          <Node node={paths.unlisted.nodes[0]} />
          <div className="mt-3"><Label>No · read the contract</Label></div>
          <p className="mb-3 text-[12px] leading-5 text-ink-soft">Bytecode and all required metadata readable?</p>
          <Label>Yes</Label>
          <Node node={paths.unlisted.nodes[1]} />
          <div className="mt-3"><Label>No</Label></div>
          <Node node={paths.unlisted.nodes[2]} />
        </div>
      </div>
      <p className="mt-4 text-[12px] leading-5 text-ink-soft">{note}</p>
    </>
  );
}

function DiagramFlow({ id }: { id: DocDiagramId }): ReactElement {
  switch (id) {
    case "build": return <BuildFlow />;
    case "watch": return <WatchFlow />;
    case "data": return <DataFlow />;
    case "trust": return <TrustFlow />;
  }
}

export function DocsDiagram({ id }: { id: DocDiagramId }): ReactElement {
  const diagram = docDiagrams[id];
  return (
    <figure aria-label={diagram.title} className="my-6 min-w-0 rounded-card border border-line bg-raised p-3 sm:p-5">
      <figcaption className="mb-5">
        <p className="font-mono text-[13px] font-medium leading-5 text-ink">{diagram.title}</p>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">{diagram.summary}</p>
      </figcaption>
      <div aria-hidden="true"><DiagramFlow id={id} /></div>
      <div className="sr-only">
        {Object.values(diagram.paths).map(function accessiblePath(path: DiagramPath) {
          return (
            <div key={path.label}>
              <p>{path.label}</p>
              <ul>
                {path.nodes.map((node) => <li key={node.label}>{node.label}: {node.detail}</li>)}
              </ul>
            </div>
          );
        })}
        <p>{diagram.note}</p>
      </div>
    </figure>
  );
}
