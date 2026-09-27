"use client";

import { usePathname } from "next/navigation";
import type { ReactElement, ReactNode } from "react";
import Link from "@/components/ui/navigation-link";
import type { RegistrySection } from "./registry-nav";

const SECTIONS: Array<{ key: RegistrySection; href: string; label: string; hint: string }> = [
  { key: "registry", href: "/registry", label: "Registry", hint: "listed assets and recorded state" },
  { key: "markets", href: "/registry/markets", label: "Markets", hint: "priority tokens and indexed pools" },
  { key: "changes", href: "/registry/changes", label: "Changelog", hint: "recorded changes and their observation times" },
  { key: "lookalikes", href: "/registry/lookalikes", label: "Lookalikes", hint: "compare contracts with matching names" },
  { key: "issuer", href: "/registry/issuer", label: "Issuer", hint: "prospectus and Final Terms" },
  { key: "status", href: "/registry/status", label: "Status", hint: "how fresh every figure is" },
  { key: "developers", href: "/developers", label: "API", hint: "the same data as JSON and MCP" },
  { key: "ai", href: "/skill.md", label: "AI guide", hint: "plain-text registry, changelog and integration guidance" },
];

interface RegistryNavLinksProps { current?: RegistrySection; statusDot: ReactNode }

export function registrySection(pathname: string | null, fallback: RegistrySection = "registry"): RegistrySection {
  if (!pathname) return fallback;
  if (pathname.startsWith("/registry/markets/")) return "markets";
  const section = SECTIONS.find((item) => item.href !== "/registry" && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
  if (section) return section.key;
  if (pathname === "/registry" || pathname.startsWith("/registry/")) return "registry";
  return fallback;
}

export function RegistryNavLinks({ current, statusDot }: RegistryNavLinksProps): ReactElement {
  const active = registrySection(usePathname(), current);
  return <nav aria-label="Registry sections" className="border-b border-line bg-paper/95">
    <div className="flex w-full items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
      {SECTIONS.map(function renderSection(section): ReactElement {
        return <Link key={section.key} href={section.href} title={section.hint} aria-current={section.key === active ? "page" : undefined}
          className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[13.5px] transition-colors ${section.key === active ? "border-hood text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
          {section.key === "status" ? statusDot : null}{section.label}
        </Link>;
      })}
    </div>
  </nav>;
}
