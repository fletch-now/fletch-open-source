// The creed band: a short white separator between the closing CTA and the
// footer, so the page keeps its black-paper-black rhythm. Four lines the rest
// of the page only implies — stated once, plainly, with no section furniture.

const LINES = [
  {
    title: "Compiled, or it didn't happen.",
    body: "You see the toolchain's output — the tests, the gas, the verdict — never the model's account of its own work.",
  },
  {
    title: "Your keys stay yours.",
    body: "The agent can call the signer but never read it. Mainnet moves only when you tap.",
  },
  {
    title: "Work outlives the tab.",
    body: "A daemon reads every 100ms block, day and night, and tells Telegram what matters.",
  },
  {
    title: "The map is public.",
    body: "The registry, llms.txt, and the JSON endpoints are free for any agent to read — yours included.",
  },
];

export function CreedBand() {
  return (
    <section id="creed" className="relative border-t border-line">
      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-14">
        <p className="mb-8 flex items-center justify-center gap-3 font-mono text-[12.5px] text-ink-faint">
          <span aria-hidden="true" className="h-px w-12 bg-ink/25" />
          what fletch believes
          <span aria-hidden="true" className="h-px w-12 bg-ink/25" />
        </p>
        <div className="divide-y divide-line border-y border-line">
          {LINES.map(function renderLine(line, index) {
            return (
              <div key={line.title} className="grid gap-1 py-4 sm:grid-cols-12 sm:items-baseline sm:gap-6">
                <p className="font-mono text-[12px] text-ink-faint sm:col-span-1">0{index + 1}</p>
                <h3 className="display text-[18px] text-ink sm:col-span-5">{line.title}</h3>
                <p className="text-[14px] leading-6 text-ink-soft sm:col-span-6">{line.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
