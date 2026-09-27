"use client";

import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { Footprints, LayoutGrid, LineChart, Radar, type IconComponent } from "@/components/ui/icons";
import { Reveal } from "@/components/landing/reveal";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { useMediaQuery } from "@/components/landing/use-media-query";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// Four ideas, one stage. On a wide screen the ideas are a rail on the left and the
// stage on the right plays whichever is selected: the sentence you would type
// appears word by word, then the finished app fades in doing its job. The rail
// advances on its own and stops the moment the pointer is over it. On a phone the
// same four are cards in a snap carousel, each carrying its own small stage, and only
// the card in view animates.
//
// Each demo has a different signature motion — a line drawing itself, things arriving
// in a feed, a chip crossing the frame, rows reordering — because four copies of the
// same animation would say nothing.

type DemoComponent = ComponentType<{ active: boolean }>;

// Below the fold and framer-motion heavy, so none of them join the initial bundle.
function lazy(load: () => Promise<{ default: DemoComponent }>): DemoComponent {
  return dynamic(load, {
    ssr: false,
    loading: function Skeleton() {
      return <div className="h-full w-full animate-pulse bg-panel" />;
    },
  });
}

const TokenPageDemo = lazy(function load() {
  return import("@/components/landing/demos/token-page-demo").then(function pick(m) {
    return { default: m.TokenPageDemo };
  });
});
const LaunchAlertsDemo = lazy(function load() {
  return import("@/components/landing/demos/launch-alerts-demo").then(function pick(m) {
    return { default: m.LaunchAlertsDemo };
  });
});
const WalletFollowDemo = lazy(function load() {
  return import("@/components/landing/demos/wallet-follow-demo").then(function pick(m) {
    return { default: m.WalletFollowDemo };
  });
});
const TopPairsDemo = lazy(function load() {
  return import("@/components/landing/demos/top-pairs-demo").then(function pick(m) {
    return { default: m.TopPairsDemo };
  });
});

interface Idea {
  icon: IconComponent;
  kind: "website" | "watcher";
  name: string;
  what: string;
  /** Who reaches for this, in one line. */
  who: string;
  /** Why it is worth building rather than checking by hand. */
  why: string;
  how: string;
  contract: string;
  frontend: string;
  prompt: string;
  Demo: DemoComponent;
}

const IDEAS: Idea[] = [
  {
    icon: LineChart,
    kind: "website",
    name: "A page for your token",
    what: "Live price, a chart, and the wallets holding the most.",
    who: "Anyone who launched a token, or a Stock Token community, and wants one link to share.",
    why: "A page you own beats a DEX screenshot. It reads the chain directly, so holders trust the numbers and you keep the audience.",
    how: "The page reads balances straight from the chain and the price from the pool the token trades in. It keeps no database of its own.",
    contract: "Reads the token you already have",
    frontend: "Price, chart, and a holders table",
    prompt: "A public page for my token showing its live price, a chart, and who holds it",
    Demo: TokenPageDemo,
  },
  {
    icon: Radar,
    kind: "watcher",
    name: "Alerts for new tokens",
    what: "Every new token, the moment it launches.",
    who: "Traders who want to see a launch in the first minute, without refreshing an explorer.",
    why: "Robinhood Chain blocks land every 100 ms; by the time a launch shows up on a feed, the first buyers are in. A watcher of your own is early by design.",
    how: "Each new trading pair is announced on-chain by the exchange's factory. The watcher listens for that announcement and turns it into a card.",
    contract: "Listens for pair-created events",
    frontend: "A live feed with a running count",
    prompt: "Watch for new tokens as they launch and show me each one as it appears",
    Demo: LaunchAlertsDemo,
  },
  {
    icon: Footprints,
    kind: "watcher",
    name: "Follow a wallet",
    what: "Every token that lands in one address, as it arrives.",
    who: "People tracking a whale, a fund, a team wallet, or their own.",
    why: "Whale-tracking is one of the most used tools in crypto. The paid versions filter transfer events to one address; yours costs one build.",
    how: "A purchase is a transfer into that address. The watcher filters the chain's transfer events down to the one wallet and lists what arrived.",
    contract: "Filters transfer events to one address",
    frontend: "A list that grows as the wallet buys",
    prompt: "Follow a wallet address and list every token it buys, as it buys it",
    Demo: WalletFollowDemo,
  },
  {
    icon: LayoutGrid,
    kind: "website",
    name: "A board of top pairs",
    what: "The busiest pairs, ranked by what is changing hands.",
    who: "Anyone deciding where the action is right now, from Stock Tokens to new pairs.",
    why: "Volume tells you where attention is before price does. A board that re-sorts live shows the swap events at a glance.",
    how: "Each trade emits a swap event with its size. The board adds them up per pair over a rolling window and re-sorts as the totals move.",
    contract: "Sums swap events per pair",
    frontend: "A ranked board that reorders live",
    prompt: "A live board of the busiest trading pairs, ranked by how much is changing hands",
    Demo: TopPairsDemo,
  },
];

const DWELL_MS = 8500;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Shared by the deck/rail cards and the use-case grid below, so the URL shape
// lives in one place.
function buildHref(prompt: string): string {
  return `/dashboard/build?p=${encodeURIComponent(prompt)}`;
}

// The sentence, typed: the words of the prompt arrive one after another under a
// caret, so "start from a sentence" is shown rather than said.
function Sentence({ text, reduced }: { text: string; reduced: boolean }) {
  return (
    <p className="flex min-h-[3.25rem] items-start gap-2 font-mono text-[13px] leading-[1.6] text-ink-soft sm:min-h-0">
      <span aria-hidden="true" className="select-none text-hood-deep">
        ›
      </span>
      <span className="flex flex-wrap gap-x-[0.35em]">
        {text.split(" ").map(function renderWord(word, i) {
          return (
            <motion.span
              key={`${text}-${i}`}
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: reduced ? 0 : 0.06 + i * 0.045 }}
            >
              {word}
            </motion.span>
          );
        })}
        <span aria-hidden="true" className="inline-block w-[0.55em] animate-pulse border-b-2 border-hood-deep" />
      </span>
    </p>
  );
}

function Cells({ idea }: { idea: Idea }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
      <div className="bg-raised px-3.5 py-2.5">
        <dt className="mono-label !text-[10px]">contract</dt>
        <dd className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">{idea.contract}</dd>
      </div>
      <div className="bg-raised px-3.5 py-2.5">
        <dt className="mono-label !text-[10px]">front end</dt>
        <dd className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">{idea.frontend}</dd>
      </div>
    </dl>
  );
}

function BuildLink({ idea, className = "" }: { idea: Idea; className?: string }) {
  return (
    <a
      href={buildHref(idea.prompt)}
      className={`inline-flex min-h-11 items-center gap-2 text-[13.5px] font-medium text-hood-deep transition-colors hover:text-ink ${className}`}
    >
      Build this one
      <span aria-hidden="true">→</span>
    </a>
  );
}

function KindChip({ idea }: { idea: Idea }) {
  if (idea.kind !== "watcher") {
    return <span className="mono-label">{idea.kind}</span>;
  }
  return (
    <a
      href="#bots"
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line px-2.5 font-mono text-[10.5px] text-ink-soft transition-colors hover:border-hood-deep hover:text-hood-deep"
    >
      <TelegramMark size={12} />
      Telegram alerts · next up
    </a>
  );
}

// Wide screens: the rail and the stage.
function Deck({ reduced }: { reduced: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef, { amount: 0.35 });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const idea = IDEAS[index];
  const running = inView && !paused && !reduced;

  useEffect(
    function advance() {
      if (!running) {
        return;
      }
      const timer = window.setTimeout(function next() {
        setIndex(function bump(current) {
          return (current + 1) % IDEAS.length;
        });
      }, DWELL_MS);
      return function stop() {
        window.clearTimeout(timer);
      };
    },
    [running, index],
  );

  function onKey(event: KeyboardEvent<HTMLOListElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setIndex(function bump(current) { return (current + 1) % IDEAS.length; });
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setIndex(function bump(current) { return (current - 1 + IDEAS.length) % IDEAS.length; });
    }
  }

  return (
    <div
      ref={hostRef}
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"
      onMouseEnter={function hold() { setPaused(true); }}
      onMouseLeave={function release() { setPaused(false); }}
    >
      <ol
        className="divide-y divide-line overflow-hidden rounded-card border border-line bg-raised"
        onKeyDown={onKey}
        aria-label="Four apps to start from"
      >
        {IDEAS.map(function renderIdea(item, i) {
          const active = i === index;
          const Icon = item.icon;
          return (
            <li key={item.name} className="relative">
              <button
                type="button"
                onClick={function select() { setIndex(i); }}
                aria-current={active ? "true" : undefined}
                className="flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-panel/60"
              >
                <span
                  className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors duration-300 ${
                    active ? "text-black" : "text-hood-deep"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className={`text-[15.5px] font-medium transition-colors ${active ? "text-ink" : "text-ink-soft"}`}>
                      {item.name}
                    </span>
                    <span className="mono-label !text-[10px]">{item.kind}</span>
                  </span>
                  <span className="mt-0.5 block text-[13.5px] leading-6 text-ink-soft">{item.what}</span>
                </span>
              </button>

              <AnimatePresence initial={false}>
                {active ? (
                  <motion.div
                    key="more"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.38, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 pl-[4.1rem]">
                      <dl className="grid gap-2.5">
                        <div>
                          <dt className="mono-label !text-[10px]">who it is for</dt>
                          <dd className="mt-0.5 text-[13.5px] leading-6 text-ink">{item.who}</dd>
                        </div>
                        <div>
                          <dt className="mono-label !text-[10px]">why build it</dt>
                          <dd className="mt-0.5 text-[13.5px] leading-6 text-ink-soft">{item.why}</dd>
                        </div>
                        <div>
                          <dt className="mono-label !text-[10px]">how it works</dt>
                          <dd className="mt-0.5 text-[13.5px] leading-6 text-ink-soft">{item.how}</dd>
                        </div>
                      </dl>
                      <div className="mt-3">
                        <Cells idea={item} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
                        <BuildLink idea={item} />
                        {item.kind === "watcher" ? <KindChip idea={item} /> : null}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* The dwell, drawn: a hairline filling left to right until the rail moves on. */}
              {active && running ? (
                <motion.span
                  key={`dwell-${index}`}
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-hood"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: DWELL_MS / 1000, ease: "linear" }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="lg:sticky lg:top-24">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={idea.name} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <Sentence text={idea.prompt} reduced={reduced} />
          </motion.div>
        </AnimatePresence>
        <div className="relative mt-3 aspect-[18/13] overflow-hidden rounded-card border border-line bg-raised shadow-[0_24px_60px_-40px_rgba(13,18,14,0.45)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={idea.name}
              className="absolute inset-0"
              initial={reduced ? false : { opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.42, ease: EASE, delay: reduced ? 0 : 0.35 }}
            >
              <idea.Demo active={inView} />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="font-mono text-[11px] text-ink-faint">
            {index + 1} / {IDEAS.length} · {paused ? "paused" : "auto"}
          </p>
          <BuildLink idea={idea} />
        </div>
      </div>
    </div>
  );
}

function Card({ idea }: { idea: Idea }) {
  const hostRef = useRef<HTMLElement>(null);
  // Only the card in view animates; the others stay still until scrolled to.
  const active = useInView(hostRef, { amount: 0.6 });
  const Icon = idea.icon;
  return (
    <article
      ref={hostRef}
      className="flex w-[84vw] max-w-[400px] shrink-0 snap-center flex-col overflow-hidden rounded-card border border-line bg-raised"
    >
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-hood-deep">
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15.5px] font-medium text-ink">{idea.name}</h3>
          <p className="mono-label !text-[10px]">{idea.kind}</p>
        </div>
      </div>
      <div className="relative mx-4 mt-3 aspect-[18/13] overflow-hidden rounded-lg border border-line">
        <idea.Demo active={active} />
      </div>
      <div className="px-4 pb-4 pt-3">
        <p className="text-[13.5px] leading-6 text-ink">{idea.what}</p>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">{idea.why}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4">
          <BuildLink idea={idea} />
          {idea.kind === "watcher" ? <KindChip idea={idea} /> : null}
        </div>
      </div>
    </article>
  );
}

// Phones: the snap carousel and its dots.
function Rail() {
  const railRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const pending = useRef(0);

  function track(): void {
    if (pending.current) {
      return;
    }
    pending.current = window.requestAnimationFrame(function measure() {
      pending.current = 0;
      const rail = railRef.current;
      if (!rail) {
        return;
      }
      const middle = rail.scrollLeft + rail.clientWidth / 2;
      let nearest = 0;
      let distance = Infinity;
      Array.from(rail.children).forEach(function check(child, i) {
        const el = child as HTMLElement;
        const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - middle);
        if (gap < distance) {
          distance = gap;
          nearest = i;
        }
      });
      setCurrent(nearest);
    });
  }

  function jump(i: number): void {
    const rail = railRef.current;
    const child = rail?.children[i] as HTMLElement | undefined;
    if (rail && child) {
      rail.scrollTo({ left: child.offsetLeft - (rail.clientWidth - child.offsetWidth) / 2, behavior: "smooth" });
    }
  }

  return (
    <div>
      <div
        ref={railRef}
        onScroll={track}
        className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {IDEAS.map(function renderCard(idea) {
          return <Card key={idea.name} idea={idea} />;
        })}
      </div>
      <div className="mt-2 flex justify-center">
        {IDEAS.map(function renderDot(idea, i) {
          const on = i === current;
          return (
            <button
              key={idea.name}
              type="button"
              aria-label={`Show ${idea.name}`}
              aria-current={on ? "true" : undefined}
              onClick={function go() { jump(i); }}
              className="grid h-11 w-11 place-items-center"
            >
              <span className={`block h-2 rounded-full transition-all duration-300 ${on ? "w-6 bg-hood-deep" : "w-2 bg-ink/20"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The wider field. Robinhood Chain is a tokenized-stock Layer 2 with Uniswap and
// Chainlink from day one, and the tools crypto people reach for most are trackers,
// alerts, checkers, and pages. Each of these is a sentence away; the prompt fills
// the console when clicked.
const USE_CASES = [
  {
    name: "Stock Token watchlist",
    purpose: "Your NVDA, AAPL, and TSLA tokens with live on-chain prices, 24/7, on one page.",
    prompt: "A watchlist page for tokenized stocks on Robinhood Chain showing live prices for a list of Stock Token addresses I choose",
  },
  {
    name: "Holder leaderboard",
    purpose: "Who holds the most of a token, how concentrated it is, and how that shifts day to day.",
    prompt: "A leaderboard of the top holders of a token with each wallet's share and how it changed in the last 24 hours",
  },
  {
    name: "Whale alerts",
    purpose: "Live today in Fletch Watch. Set a threshold on a Stock Token, link Telegram, and get a message on every transfer past it, 24/7.",
    prompt: "Watch a token for transfers above an amount I set and show each one with the wallets involved as it happens",
  },
  {
    name: "Airdrop or claim checker",
    purpose: "Paste a wallet, see whether it qualifies and what it can claim, from a list you control.",
    prompt: "A page where someone pastes a wallet address and sees whether it is on my allowlist and how much it can claim",
  },
  {
    name: "Tip jar or crowdfund",
    purpose: "A goal, a progress bar, and a button; funds go to one address you set, refunds if the goal is missed.",
    prompt: "A crowdfund page with a funding goal in ETH, a progress bar, contributions from any wallet, and refunds if the goal is not met by a deadline",
  },
  {
    name: "Vault dashboard",
    purpose: "Deposits, your share, and the balance of a staking or savings contract, readable at a glance.",
    prompt: "A dashboard for a simple staking vault showing total deposits, my share, and a deposit and withdraw button",
  },
  {
    name: "Community vote",
    purpose: "One proposal, holders vote once each weighted by balance, results live on the page.",
    prompt: "A voting page where holders of a token vote yes or no on a proposal, weighted by balance, with live results",
  },
  {
    name: "Launch page with mint",
    purpose: "A new token's page with supply, price, and a buy or mint button wired to the contract.",
    prompt: "A launch page for a new token showing supply, price, and a mint button that calls the contract",
  },
];

function UseCases({ reduced }: { reduced: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef, { once: true, amount: 0.2 });
  return (
    <div ref={hostRef} className="mt-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono-label">beyond the four</p>
          <h3 className="display mt-2 text-[clamp(1.5rem,2.6vw,2.1rem)] leading-tight text-ink">
            Eight more, one sentence each
          </h3>
        </div>
        <p className="max-w-md text-[13.5px] leading-6 text-ink-soft">
          Robinhood Chain is a tokenized-stock chain with a DEX and price feeds from day
          one, so most of what people want is a page or a watcher over data already
          there. Click one and the prompt lands in the console for you to edit; whale
          alerts already run in Fletch Watch.
        </p>
      </div>
      <ul className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {USE_CASES.map(function renderCase(item, i) {
          return (
            <motion.li
              key={item.name}
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.45, ease: EASE, delay: reduced ? 0 : i * 0.06 }}
              className="bg-raised"
            >
              <a
                href={buildHref(item.prompt)}
                className="group flex h-full flex-col gap-2 p-5 transition-colors hover:bg-panel/60"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[14.5px] font-medium text-ink">{item.name}</span>
                  <span aria-hidden="true" className="text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-hood-deep">→</span>
                </span>
                <span className="text-[13px] leading-6 text-ink-soft">{item.purpose}</span>
              </a>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

export function TemplateShowcase() {
  const wide = useMediaQuery("(min-width: 1024px)");
  const reduced = usePrefersReducedMotion();
  return (
    <Reveal>
      {wide ? <Deck reduced={reduced} /> : <Rail />}
      <UseCases reduced={reduced} />
    </Reveal>
  );
}
