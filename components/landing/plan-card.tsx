import Link from "@/components/ui/navigation-link";
import { ArrowRight, Check } from "@/components/ui/icons";

// One pricing plate, drawn the reference's way: a number, a name, a large price,
// a feature list with checks, and a full-width call to action. The same card
// serves the pricing page on paper and the landing page's plans section on
// night, so the colours live in one table per tone. A plan without a `cta` is
// not for sale yet and says so in place of the button.

export interface Plan {
  number: string;
  name: string;
  description: string;
  price: string;
  priceNote: string;
  features: string[];
  cta?: { label: string; href: string };
  highlight: boolean;
  badge?: string;
  state?: string;
}

interface PlanCardProps {
  plan: Plan;
  tone: "light" | "night";
}

interface ToneClasses {
  card: string;
  cardHighlight: string;
  badge: string;
  faint: string;
  soft: string;
  strong: string;
  rule: string;
  check: string;
  ctaHighlight: string;
  ctaPlain: string;
  state: string;
  pending: string;
}

const TONES: Record<"light" | "night", ToneClasses> = {
  light: {
    card: "border border-line bg-raised",
    cardHighlight: "border border-ink bg-raised",
    badge: "bg-ink text-paper",
    faint: "text-ink-faint",
    soft: "text-ink-soft",
    strong: "text-ink",
    rule: "border-line",
    check: "text-hood-deep",
    ctaHighlight: "bg-ink text-paper hover:bg-ink/90",
    ctaPlain: "border border-line-strong text-ink hover:border-ink hover:bg-panel",
    state: "border-line-strong text-ink-faint",
    pending: "border-line-strong text-ink-faint",
  },
  night: {
    card: "border border-white/12 bg-white/[0.03]",
    cardHighlight: "border border-hood/70 bg-white/[0.05] shadow-[0_0_80px_-30px_rgba(0,200,5,0.45)]",
    badge: "bg-hood text-black",
    faint: "text-white/45",
    soft: "text-white/65",
    strong: "text-white",
    rule: "border-white/10",
    check: "text-hood",
    ctaHighlight: "bg-hood text-black hover:bg-hood-strong",
    ctaPlain: "border border-white/25 text-white hover:border-white hover:bg-white/5",
    state: "border-white/20 text-white/50",
    pending: "border-white/20 text-white/55",
  },
};

export function PlanCard({ plan, tone }: PlanCardProps) {
  const c = TONES[tone];
  return (
    <div className={`relative h-full ${plan.highlight ? c.cardHighlight : c.card}`}>
      {plan.badge ? (
        <div className="absolute -top-4 left-8 right-8 flex justify-center">
          <span className={`inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] ${c.badge}`}>
            {plan.badge}
          </span>
        </div>
      ) : null}
      <div className="flex h-full flex-col p-8 lg:p-10">
        <div className={`mb-8 border-b pb-8 ${c.rule}`}>
          <span className={`font-mono text-[12px] ${c.faint}`}>{plan.number}</span>
          <h3 className={`display mt-2 text-[26px] lg:text-[30px] ${c.strong}`}>{plan.name}</h3>
          <p className={`mt-2 text-[14px] ${c.soft}`}>{plan.description}</p>
        </div>
        <div className="mb-8">
          <span className={`display text-[52px] leading-none lg:text-[60px] ${c.strong}`}>{plan.price}</span>
          <p className={`mt-2 font-mono text-[12px] ${c.faint}`}>{plan.priceNote}</p>
        </div>
        <ul className="mb-10 space-y-3">
          {plan.features.map(function renderFeature(feature) {
            return (
              <li key={feature} className="flex items-start gap-3">
                <Check className={`mt-0.5 h-4 w-4 shrink-0 ${c.check}`} strokeWidth={2.2} />
                <span className={`text-[14px] leading-6 ${c.soft}`}>{feature}</span>
              </li>
            );
          })}
        </ul>
        {plan.state ? (
          <p className={`mb-6 rounded-md border border-dashed px-3 py-2 font-mono text-[11.5px] leading-5 ${c.state}`}>{plan.state}</p>
        ) : null}
        {plan.cta ? (
          <Link
            href={plan.cta.href}
            className={`group mt-auto flex w-full items-center justify-center gap-2 py-4 text-[14px] font-medium transition-colors ${
              plan.highlight ? c.ctaHighlight : c.ctaPlain
            }`}
          >
            {plan.cta.label}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.2} />
          </Link>
        ) : (
          <p className={`mt-auto flex w-full items-center justify-center border border-dashed py-4 font-mono text-[12px] uppercase tracking-[0.14em] ${c.pending}`}>
            Coming soon
          </p>
        )}
      </div>
    </div>
  );
}
