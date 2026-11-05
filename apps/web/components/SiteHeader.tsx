"use client";

import { useEffect, useState } from "react";
import { Brand } from "./Brand";
import { GithubLogo, Moon, Sun } from "./Icons";

const LINKS: [string, string][] = [
  ["/#audit", "Audit"],
  ["/#ladder", "Ladder"],
  ["/#how", "How it works"],
  ["/#surfaces", "CLI & MCP"],
  ["/accounts", "Account list"],
];

export function SiteHeader({ current }: { current: string }) {
  const [stuck, setStuck] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function flip() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("gb-theme", next);
    } catch {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#F3F5F8" : "#0E1116");
    setTheme(next);
  }

  return (
    <header className={`topbar${stuck ? " is-stuck" : ""}`} id="top">
      <div className="wrap">
        <Brand />
        <nav className="nav" aria-label="Primary">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} aria-current={label === current ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="end">
          <span className="status-pill label">
            <i aria-hidden="true" />
            Localhost · not deployed
          </span>
          <button
            className="icon-btn theme-toggle"
            type="button"
            onClick={flip}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            <span className="i-moon"><Moon /></span>
            <span className="i-sun"><Sun /></span>
          </button>
          <a className="icon-btn" href="https://github.com/Adelekejr/Glassbox" aria-label="Glassbox on GitHub">
            <GithubLogo />
          </a>
        </div>
      </div>
    </header>
  );
}
