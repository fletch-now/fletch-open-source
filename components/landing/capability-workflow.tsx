"use client";

import { useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import styles from "./capabilities.module.css";

export type CapabilityKind = "identity" | "background" | "checks" | "publish";
const flows: Record<CapabilityKind, { steps: string[]; description: string }> = {
  identity: { steps: ["Issuer + chain", "Identity checks", "Registry record"], description: "Issuer sources and chain reads inform identity checks and a registry record with provenance." },
  background: { steps: ["Tab closed", "Worker continues", "Saved progress"], description: "An accepted build continues on the server after the tab closes and saves its progress." },
  checks: { steps: ["Compile", "Run tests", "Inspect reports"], description: "Foundry compilation and executable tests produce reports to inspect alongside static analysis." },
  publish: { steps: ["Saved preview", "You publish", "Hosted app"], description: "A saved preview becomes a hosted app after the owner chooses Publish live app. Directory submission is separate." },
};

export function CapabilityWorkflow({ kind }: { kind: CapabilityKind }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: .5 });
  const reduced = useReducedMotion();
  const [replay, setReplay] = useState(0);
  const flow = flows[kind];
  return <div ref={ref} className={styles.workflow}>
    <div role="img" aria-label={flow.description} className={styles.flow}>
      {flow.steps.map((step, index) => <motion.div key={`${step}-${replay}`} className={styles.node}
        initial={false} animate={visible && !reduced ? { backgroundColor: ["#edf2e7", "#c8e9b7", "#edf2e7"] } : { backgroundColor: "#edf2e7" }}
        transition={{ duration: 1.3, delay: index * .55 }}>
        <span>{step}</span>
        {index < 2 ? <svg className={styles.arrow} width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
          <path d="M1 7h12M9 3l4 4-4 4" stroke="#a6b69b" />
          {!reduced ? <motion.path key={replay} d="M1 7h12M9 3l4 4-4 4" stroke="#32632b" initial={{ pathLength: 0 }} animate={{ pathLength: visible ? 1 : 0 }} transition={{ duration: .65, delay: index * .55 + .3 }} /> : null}
        </svg> : null}
      </motion.div>)}
    </div>
    {!reduced ? <button type="button" className={styles.replay} onClick={() => setReplay(value => value + 1)} aria-label={`Replay ${kind} workflow`} title="Replay illustration">↻</button> : null}
  </div>;
}
