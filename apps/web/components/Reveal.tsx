"use client";

import { useEffect } from "react";

/** Adds .is-in to every .reveal element once it scrolls into view. Reduced motion: shown at once. */
export function Reveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.is-in)"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 6, 5) * 40}ms`;
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return null;
}
