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

function Changelogs({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);
  const entries = t("changelogs.entries", { returnObjects: true }) || [];

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
      gsap.set(".cl-timeline-line", {
        scaleY: 0,
        opacity: 0,
        transformOrigin: "top center",
      });

      const allEntries = gsap.utils.toArray(".cl-entry");
      const firstEntry = allEntries[0];
      const restEntries = allEntries.slice(1);

      if (firstEntry) {
        gsap.set(firstEntry, { opacity: 0, y: 44, visibility: "hidden" });
      }

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
            duration: 0.32,
            ease: "power2.out",
          },
          "+=0.03",
        )
        .to(
          ".cl-timeline-line",
          {
            scaleY: 0.14,
            opacity: 1,
            duration: 0.72,
            ease: "power2.out",
          },
          "<",
        );

      restEntries.forEach((entry) => {
        gsap.set(entry, { opacity: 0, y: 44 });
        gsap.fromTo(
          entry,
          { opacity: 0, y: 44 },
          {
            opacity: 1,
            y: 0,
            visibility: "visible",
            duration: 0.65,
            ease: "power3.out",
            scrollTrigger: {
              trigger: entry,
              start: "top 88%",
              toggleActions: "play none none reverse",
            },
          },
        );
      });

      gsap.fromTo(
        ".cl-timeline-line",
        { scaleY: 0.14 },
        {
          scaleY: 1,
          ease: "none",
          immediateRender: false,
          scrollTrigger: {
            trigger: ".cl-entries",
            start: "top 75%",
            end: "bottom 55%",
            scrub: 1.2,
          },
        },
      );
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
