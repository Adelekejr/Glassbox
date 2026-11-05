"use client";

import { useEffect, useState } from "react";

export function LadderBar({
  summary,
  animate = false,
}: {
  summary: { risky: number; notProven: number; proven: number };
  animate?: boolean;
}) {
  const [shown, setShown] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, [animate]);
  const seg = (cls: string, n: number) => (n ? <span className={cls} style={{ flex: `${n} 1 0` }} /> : null);
  return (
    <div
      className={`bar${animate ? " animate" : ""}${shown && animate ? " is-in" : ""}`}
      role="img"
      aria-label={`${summary.risky} risky, ${summary.notProven} not proven, ${summary.proven} proven`}
    >
      {seg("RISKY", summary.risky)}
      {seg("NOT_PROVEN", summary.notProven)}
      {seg("PROVEN", summary.proven)}
    </div>
  );
}
