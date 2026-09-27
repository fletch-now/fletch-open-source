import Link from "@/components/ui/navigation-link";
import { ArrowUpRight } from "@/components/ui/icons";
import { NightShiftVideo } from "./night-shift-video";
import styles from "./night-shift.module.css";

export function NightShiftSection() {
  return (
    <section id="night-shift" aria-labelledby="night-shift-heading" className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>
          <span>Behind the build</span>
          <span className={styles.afterHours}>Fletch, after hours ↘</span>
        </div>

        <div className={styles.stage}>
          <NightShiftVideo />
          <div className={styles.shade} aria-hidden="true" />
          <div className={styles.copy}>
            <p className={styles.intro}>Someone has to count the coins.</p>
            <h2 id="night-shift-heading" className={styles.heading}>
              The night
              <em>shift.</em>
            </h2>
            <p className={styles.description}>
              Call it a night. Your accepted build keeps running after you
              close the tab. Pick up the saved progress when you return.
            </p>
            <Link href="/dashboard/build" className={styles.cta}>
              Put it to work <ArrowUpRight className="h-4 w-4" strokeWidth={1.7} />
            </Link>
          </div>
        </div>

        <div className={styles.footer}>
          <p>The sunglasses are apparently part of the uniform.</p>
          <nav aria-label="Explore Fletch products" className={styles.products}>
            <Link href="/dashboard/build">Build <span aria-hidden="true">↗</span></Link>
            <Link href="/registry">Registry <span aria-hidden="true">↗</span></Link>
            <Link href="/dashboard/watch">Watch <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
      </div>
    </section>
  );
}
