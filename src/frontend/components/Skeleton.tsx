import type { CSSProperties } from "react";
import { Brand } from "./common";

type BoneProps = { w?: number | string; h?: number | string; r?: number | string; className?: string };

/** One shimmering placeholder block. Sizes accept numbers (px) or any CSS length. */
export function Bone({ w = "100%", h = 14, r = 8, className }: BoneProps) {
  const style = { width: w, height: h, borderRadius: r } as CSSProperties;
  return <span className={className ? `bone ${className}` : "bone"} style={style} aria-hidden="true" />;
}

/** Transaction-like rows: icon, two text lines and an amount. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <Bone w={38} h={38} r={11} />
          <span className="skeleton-lines">
            <Bone w={`${62 - (index % 3) * 12}%`} h={12} />
            <Bone w={`${38 - (index % 2) * 10}%`} h={10} />
          </span>
          <Bone w={68} h={12} />
        </div>
      ))}
    </div>
  );
}

/** A panel with a heading placeholder and list rows. */
export function PanelSkeleton({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <section className="panel skeleton-panel" aria-busy="true" aria-label={label}>
      <div className="skeleton-head">
        <Bone w={140} h={16} />
        <Bone w={64} h={12} />
      </div>
      <ListSkeleton rows={rows} />
      {label && <span className="skeleton-status" role="status">{label}</span>}
    </section>
  );
}

/** Screen body placeholder for pages that are still fetching their data. */
export function PageSkeleton({ label = "Carregando…", rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div className="skeleton-page">
      <PanelSkeleton rows={rows} label={label} />
    </div>
  );
}

/** Spending analysis placeholder: total, bar chart and category list. */
export function AnalyticsSkeleton() {
  const bars = [46, 72, 30, 88, 54, 64, 38];
  return (
    <div className="analytics-layout" aria-busy="true">
      <section className="panel skeleton-panel">
        <Bone w={90} h={12} />
        <Bone w={170} h={30} r={10} className="skeleton-gap" />
        <div className="skeleton-bars" aria-hidden="true">
          {bars.map((height, index) => (
            <Bone key={index} w="100%" h={`${height}%`} r={8} />
          ))}
        </div>
      </section>
      <PanelSkeleton rows={4} label="Carregando os gastos do período…" />
    </div>
  );
}

/** Whole app shell placeholder shown while the dashboard is loading for the first time. */
export function AppSkeleton() {
  return (
    <div className="app-shell skeleton-shell" data-page="home" aria-busy="true">
      <aside className="sidebar" aria-hidden="true">
        <span className="brand-link"><Brand /></span>
        <div className="skeleton-nav">
          {Array.from({ length: 7 }, (_, index) => (
            <span className="skeleton-nav-item" key={index}>
              <Bone w={20} h={20} r={6} />
              <Bone w={`${70 - (index % 3) * 14}%`} h={12} />
            </span>
          ))}
        </div>
        <div className="skeleton-nav skeleton-nav-bottom">
          <span className="skeleton-nav-item">
            <Bone w={36} h={36} r={999} />
            <Bone w="60%" h={12} />
          </span>
        </div>
      </aside>
      <main className="main">
        <span className="skeleton-status" role="status">Carregando seu painel…</span>
        <div className="topbar skeleton-topbar" aria-hidden="true">
          <Bone w={150} h={38} r={999} />
          <Bone w={38} h={38} r={999} />
        </div>
        <header className="home-heading" aria-hidden="true">
          <div className="skeleton-lines">
            <Bone w={90} h={14} />
            <Bone w={190} h={30} r={10} />
          </div>
          <Bone w={150} h={38} r={999} className="skeleton-desktop" />
        </header>
        <div className="home-layout" aria-hidden="true">
          <div className="home-hero-stack">
            <Bone h="var(--skeleton-hero-h)" r={19} className="skeleton-hero" />
            <div className="skeleton-actions">
              {Array.from({ length: 4 }, (_, index) => (
                <span key={index}>
                  <Bone w={53} h={53} r={18} />
                  <Bone w={44} h={10} />
                </span>
              ))}
            </div>
          </div>
          <section className="panel skeleton-panel home-summary">
            <Bone w={110} h={16} />
            {Array.from({ length: 3 }, (_, index) => (
              <div className="skeleton-head skeleton-gap" key={index}>
                <Bone w={80} h={12} />
                <Bone w={90} h={12} />
              </div>
            ))}
          </section>
          <div className="screen-stack home-main-stack">
            <PanelSkeleton rows={4} />
          </div>
          <aside className="screen-stack home-aside">
            <section className="panel skeleton-panel">
              <Bone w={120} h={16} />
              <Bone w={150} h={28} r={10} className="skeleton-gap" />
            </section>
            <PanelSkeleton rows={3} />
          </aside>
        </div>
      </main>
      <div className="tabbar skeleton-tabbar" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index}><Bone w={index === 2 ? 40 : 24} h={index === 2 ? 40 : 24} r={999} /></span>
        ))}
      </div>
    </div>
  );
}

/** First load: a padlock that spins while the session is being validated. */
export function SessionLock() {
  return (
    <main className="boot session-lock">
      <div className="lock-stage" aria-hidden="true">
        <span className="lock-orbit" />
        <svg className="lock-icon" viewBox="0 0 64 64" width="64" height="64">
          <defs>
            <linearGradient id="lock-body" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--lock-light)" />
              <stop offset="1" stopColor="var(--lock-dark)" />
            </linearGradient>
          </defs>
          <path
            className="lock-shackle"
            d="M20 29v-8a12 12 0 0 1 24 0v8"
            fill="none"
            stroke="var(--lock-dark)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <rect x="11" y="27" width="42" height="31" rx="9" fill="url(#lock-body)" />
          <circle cx="32" cy="40" r="4.5" fill="var(--lock-hole)" />
          <rect x="30" y="41" width="4" height="9" rx="2" fill="var(--lock-hole)" />
        </svg>
      </div>
      <p className="boot-message" role="status">Verificando sua sessão…</p>
    </main>
  );
}
