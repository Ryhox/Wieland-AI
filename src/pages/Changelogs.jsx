import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTranslation } from "react-i18next";
import "../styles/Changelogs.css";
import "../styles/main.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import { useAuth } from "../context/AuthContext";

gsap.registerPlugin(ScrollTrigger);

// changelog page: timeline-animation zeigt entries progressive an je nach scroll
// komplexe GSAP-scroll-trigger logik für timeline-fill und entry-reveal
function Changelogs({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);
  // changelog entries aus i18n laden (version, date, tag, title, changes)
  const entries = t("changelogs.entries", { returnObjects: true }) || [];

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    if (!rootRef.current) return;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set(".cl-page-shell #stars-canvas", { opacity: 0 });
      gsap.set(".cl-page-shell #three-canvas", { opacity: 0 });
      gsap.set(".cl-hero-left > *", { opacity: 0, y: 44 });
      gsap.set(".cl-divider", { opacity: 0, x: -24 });

      const shell = rootRef.current;

      const allEntries = gsap.utils.toArray(".cl-entry");
      const firstEntry = allEntries[0] || null;
      const lastEntry = allEntries[allEntries.length - 1] || firstEntry;
      const deferredEntries = allEntries.slice(1);
      // timeline skalierung: wie viel des timeline-tracks ist sichtbar?
      const ENTRY_HIDDEN_Y = 44;

      let initialTimelineScale = 0.14;
      let targetTimelineScale = 1;
      const timelineTrack = shell?.querySelector(".cl-timeline-track");
      const timelineLine = shell?.querySelector(".cl-timeline-line");
      const trackRect = timelineTrack?.getBoundingClientRect() || null;
      const INITIAL_TIMELINE_EXTRA_PX = 24;
      const FINAL_TIMELINE_EXTRA_PX = 28;
      if (trackRect && firstEntry) {
        const anchor =
          firstEntry.querySelector(".cl-entry-dot-wrap") || firstEntry;
        const anchorRect = anchor.getBoundingClientRect();
        const visibleHeightPx =
          anchorRect.top +
          anchorRect.height * 0.5 -
          trackRect.top +
          INITIAL_TIMELINE_EXTRA_PX;

        if (trackRect.height > 0) {
          const ratio = visibleHeightPx / trackRect.height;
          initialTimelineScale = Math.max(0.06, Math.min(1, ratio));
        }
      }

      if (trackRect && lastEntry) {
        const anchor =
          lastEntry.querySelector(".cl-entry-dot-wrap") || lastEntry;
        const anchorRect = anchor.getBoundingClientRect();
        const targetHeightPx =
          anchorRect.top +
          anchorRect.height * 0.5 -
          trackRect.top +
          FINAL_TIMELINE_EXTRA_PX;

        if (trackRect.height > 0) {
          const ratio = targetHeightPx / trackRect.height;
          targetTimelineScale = Math.max(initialTimelineScale, ratio);
        }
      }

      const firstDeferredEntry = deferredEntries[0] || null;
      const deferredMeta = trackRect
        ? deferredEntries.map((entry) => {
            const anchor = entry.querySelector(".cl-entry-dot-wrap") || entry;
            const anchorRect = anchor.getBoundingClientRect();
            const dotOffset =
              anchorRect.top + anchorRect.height * 0.5 - trackRect.top;

            return {
              entry,
              dotOffset,
              shown: false,
            };
          })
        : [];

      gsap.set(timelineLine || ".cl-timeline-line", {
        scaleY: initialTimelineScale,
        opacity: 0,
        transformOrigin: "top center",
      });

      gsap.set(allEntries, {
        opacity: 0,
        y: ENTRY_HIDDEN_Y,
        visibility: "hidden",
      });
      const ENTRY_REVEAL_OFFSET_PX = 0;
      const ENTRY_HIDE_OFFSET_PX = 8;

      const revealDeferredEntriesForScale = (scaleValue) => {
        if (!trackRect || deferredMeta.length === 0) return;
        const lineTipPx = Math.max(0, scaleValue) * trackRect.height;

        deferredMeta.forEach((meta) => {
          const shouldShow =
            lineTipPx >= meta.dotOffset + ENTRY_REVEAL_OFFSET_PX;
          const shouldHide = lineTipPx <= meta.dotOffset - ENTRY_HIDE_OFFSET_PX;

          if (!meta.shown && shouldShow) {
            meta.shown = true;
            gsap.set(meta.entry, { visibility: "visible" });
            gsap.to(meta.entry, {
              opacity: 1,
              y: 0,
              duration: 0.65,
              ease: "power3.out",
              overwrite: "auto",
            });
            return;
          }

          if (meta.shown && shouldHide) {
            meta.shown = false;
            gsap.to(meta.entry, {
              opacity: 0,
              y: ENTRY_HIDDEN_Y,
              duration: 0.5,
              ease: "power2.inOut",
              overwrite: "auto",
              onComplete: () => {
                if (!meta.shown) {
                  gsap.set(meta.entry, { visibility: "hidden" });
                }
              },
            });
          }
        });
      };

      const syncDeferredEntriesWithLine = () => {
        if (!timelineLine) return;
        const currentScale =
          Number(gsap.getProperty(timelineLine, "scaleY")) ||
          initialTimelineScale;
        revealDeferredEntriesForScale(currentScale);
      };

      const tl = gsap.timeline();
      tl.to(".cl-page-shell #stars-canvas", {
        opacity: 0.42,
        duration: 0.3,
        ease: "power2.out",
      })
        .to(
          ".cl-page-shell #three-canvas",
          { opacity: 0.14, duration: 0.5, ease: "power2.out" },
          0,
        )
        .to(
          ".cl-hero-left > *",
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.07,
            ease: "power3.out",
          },
          "-=0.02",
        )
        .to(
          ".cl-divider",
          { opacity: 1, x: 0, duration: 0.15, ease: "power2.out" },
          "-=0.15",
        )
        .to(
          firstEntry,
          {
            opacity: 1,
            y: 0,
            visibility: "visible",
            duration: 0.45,
            ease: "power3.out",
          },
          "+=0.03",
        )
        .to(
          ".cl-timeline-line",
          {
            opacity: 1,
            duration: 0.72,
            ease: "power2.out",
          },
          "<",
        )
        .add(() => {
          syncDeferredEntriesWithLine();
        });

      if (timelineLine) {
        gsap.fromTo(
          timelineLine,
          { scaleY: initialTimelineScale },
          {
            scaleY: targetTimelineScale,
            ease: "none",
            immediateRender: false,
            onUpdate: syncDeferredEntriesWithLine,
            scrollTrigger: {
              trigger: firstDeferredEntry || ".cl-entries",
              start: firstDeferredEntry ? "top bottom" : "top 75%",
              end: () => ScrollTrigger.maxScroll(window),
              scrub: 0.2,
              invalidateOnRefresh: true,
              onUpdate: syncDeferredEntriesWithLine,
              onScrubComplete: syncDeferredEntriesWithLine,
            },
          },
        );
      }
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      className={`page-wrapper content-page cl-page-shell ${isSidebarOpen ? "sidebar-open" : ""}`}
      ref={rootRef}
    >
      <div className="cl-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="cl-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

      <main className="page-content cl-content-layer">
        <div className="page-container cl-container">
          <div className="cl-hero">
            <div className="cl-hero-left">
              <span className="cl-eyebrow">{t("changelogs.eyebrow")}</span>
              <h1 className="cl-h1">
                {t("changelogs.title")}
                <br />
                <span>{t("changelogs.titleAccent")}</span>
              </h1>
              <p className="cl-lead">{t("changelogs.lead")}</p>
            </div>
          </div>

          <div className="cl-divider" />

          <div className="cl-entries">
            <div className="cl-timeline-track" aria-hidden="true">
              <div className="cl-timeline-line" />
            </div>

            {entries.map((entry) => (
              <div className="cl-entry" key={entry.version}>
                <div className="cl-entry-dot-wrap" aria-hidden="true">
                  <div className={`cl-entry-dot cl-entry-dot--${entry.tag}`} />
                </div>

                <div className="cl-entry-meta">
                  <span className="cl-entry-version">{entry.version}</span>
                  <span className="cl-entry-date">{entry.date}</span>
                </div>

                <div
                  className="cl-entry-body"
                  data-version={entry.version}
                  data-date={entry.date}
                >
                  <div className="cl-entry-header">
                    <span className={`cl-tag cl-tag--${entry.tag}`}>
                      {entry.tag === "gray"
                        ? t("changelogs.initialTag")
                        : entry.version}
                    </span>
                    <h2 className="cl-entry-title">{entry.title}</h2>
                  </div>
                  <ul className="cl-list">
                    {entry.changes.map((c, j) => (
                      <li key={j}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Changelogs;
