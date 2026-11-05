"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brand, Mark } from "./Brand";
import { GithubLogo, List, Moon, Sun, XIcon } from "./Icons";

const LINKS: [string, string][] = [
  ["/#audit", "Audit"],
  ["/#ladder", "Ladder"],
  ["/#how", "How it works"],
  ["/#surfaces", "CLI & MCP"],
  ["/accounts", "Account list"],
];

const FOCUSABLE = 'a[href], button:not([disabled])';

export function SiteHeader({ current }: { current: string }) {
  const [stuck, setStuck] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 961px)");
    const closeIfWide = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", closeIfWide);
    return () => wide.removeEventListener("change", closeIfWide);
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const root = panel.closest("[data-menu-root]");
    const locked = [...document.body.children].filter((el) => el !== root);
    for (const el of locked) el.setAttribute("inert", "");
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const items = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    items()[0]?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        restoreFocus.current = true;
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of locked) el.removeAttribute("inert");
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
      if (restoreFocus.current) menuBtn.current?.focus({ preventScroll: true });
    };
  }, [open]);

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

  function closeMenu(restore = true) {
    restoreFocus.current = restore;
    setOpen(false);
  }

  const menu = open
    ? createPortal(
        <div className="drawer-root" data-menu-root="">
          <div className="drawer-scrim" onClick={() => closeMenu(true)} />
          <div
            ref={panelRef}
            className="drawer"
            id="site-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-menu-title"
          >
            <div className="drawer-head">
              <span className="drawer-title" id="site-menu-title">
                <Mark />
                <span className="label">Menu</span>
              </span>
              <button className="icon-btn" type="button" aria-label="Close menu" onClick={() => closeMenu(true)}>
                <XIcon />
              </button>
            </div>
            <nav className="drawer-nav" aria-label="Primary">
              {LINKS.map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  aria-current={label === current ? "page" : undefined}
                  onClick={() => {
                    window.setTimeout(() => closeMenu(false), 0);
                  }}
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="drawer-foot">
              <span className="status-pill label is-on">
                <i aria-hidden="true" />
                Deployed
              </span>
              <p>This site is deployed at glassbox-inky.vercel.app.</p>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

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
          <button
            ref={menuBtn}
            className="icon-btn menu-btn"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? "site-menu" : undefined}
            aria-label="Open menu"
            onClick={() => {
              restoreFocus.current = true;
              setOpen(true);
            }}
          >
            <List />
          </button>
          <span className="status-pill label is-on" title="This site is deployed">
            <i aria-hidden="true" />
            Deployed
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
      {menu}
    </header>
  );
}
