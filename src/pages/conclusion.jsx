import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTranslation } from "react-i18next";
import "../styles/Conclusion.css";
import "../styles/main.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import { useAuth } from "../context/AuthContext";

gsap.registerPlugin(ScrollTrigger);

// conclusion page: multi-abschnitt narrative mit scroll-triggered animations
// acts → reflection → finale, alles mit dyn render emphasis-text helper
function Conclusion({ isSidebarOpen, onSidebarToggle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);
  const introTl = useRef(null);
  const [isSceneReady, setIsSceneReady] = useState(false);

  // lade kompletten seiten-inhalt aus i18n: acts, pills, reflection, finale
  const content = t("conclusion", { returnObjects: true }) || {};
  const acts = Array.isArray(content.acts) ? content.acts : [];
  const pills = Array.isArray(content.pills) ? content.pills : [];
  const reflection = content.reflection || {};
  const reflectionQuick = Array.isArray(reflection.quick)
    ? reflection.quick
    : [];
  const reflectionChapters = Array.isArray(reflection.chapters)
    ? reflection.chapters
    : [];
  const finale = Array.isArray(content.finale) ? content.finale : [];

  const renderEmphasisText = (text = "", keyPrefix = "") => {
    // helper: text mit [[emphasis]] markup → <span class="fz-emph">emphasis</span>
    const parts = String(text)
      .split(/(\[\[[\s\S]*?\]\])/g)
      .filter(Boolean);

    return parts.map((part, index) => {
      const match = part.match(/^\[\[([\s\S]*?)\]\]$/);
      if (match) {
        return (
          <span className="fz-emph" key={`${keyPrefix}-emph-${index}`}>
            {match[1]}
          </span>
        );
      }

      return <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>;
    });
  };

  // animation und side-effects hier gebündelt, cleanup ist wichtig :/
  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set(".fz-page-shell #stars-canvas", { opacity: 0 });
      gsap.set(".fz-page-shell #three-canvas", { opacity: 0 });
      gsap.set(".fz-hero > *", { opacity: 0, y: 30 });
      gsap.set(".fz-divider", { opacity: 0, scaleX: 0.72 });
      gsap.set(".fz-act", { opacity: 0, y: 34 });
      gsap.set(".fz-reveal:not(.fz-act)", { opacity: 0, y: 42 });

      introTl.current = gsap
        .timeline({ paused: true })
        .to(".fz-page-shell #stars-canvas", {
          opacity: 0.42,
          duration: 0.45,
          ease: "power2.out",
        })
        .to(
          ".fz-page-shell #three-canvas",
          {
            opacity: 0.14,
            duration: 0.7,
            ease: "power2.out",
          },
          0,
        )
        .to(
          ".fz-hero > *",
          {
            opacity: 1,
            y: 0,
            duration: 0.75,
            stagger: 0.09,
            ease: "power3.out",
          },
          "-=0.06",
        )
        .to(
          ".fz-divider",
          {
            opacity: 1,
            scaleX: 1,
            duration: 0.35,
            ease: "power2.out",
          },
          "-=0.22",
        )
        .to(
          ".fz-act",
          {
            opacity: 1,
            y: 0,
            duration: 0.72,
            stagger: 0.1,
            ease: "power3.out",
          },
          "-=0.06",
        );

      gsap.utils.toArray(".fz-reveal:not(.fz-act)").forEach((item) => {
        gsap.to(item, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "power3.out",
          scrollTrigger: {
            trigger: item,
            start: "top 84%",
            toggleActions: "play none none reverse",
          },
        });
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  // Starte Intro erst wenn die 3D-Scene bereit ist (wie About), mit Fallback falls Ready ausbleibt
  useEffect(() => {
    if (isSceneReady && introTl.current) {
      introTl.current.play();
    }
  }, [isSceneReady]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      if (introTl.current && introTl.current.paused()) {
        introTl.current.play();
      }
    }, 1400);

    return () => clearTimeout(fallbackTimer);
  }, []);

  return (
    <div
      className={`page-wrapper content-page fz-page-shell ${isSidebarOpen ? "sidebar-open" : ""}`}
      ref={rootRef}
    >
      <div className="fz-bg-layer" aria-hidden="true">
        <Starfield mode="orbit-center" />
        <Scene3D
          hasMessages={false}
          sceneMode="conclusion"
          hidePlanet={false}
          onReady={() => setIsSceneReady(true)}
        />
        <div className="fz-ambient-glow" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

      <main className="page-content fz-content-layer">
        <div className="page-container fz-container">
          <section className="fz-hero">
            <span className="fz-eyebrow">{content.eyebrow}</span>
            <h1 className="fz-h1">
              {content.title} <span>{content.titleAccent}</span>
            </h1>
            <p className="fz-lead">{content.lead}</p>
            <p className="fz-lead fz-lead--secondary">
              {content.leadSecondary}
            </p>

            <div className="fz-pills">
              {pills.map((pill, index) => (
                <span className="fz-pill" key={`pill-${index}`}>
                  {pill}
                </span>
              ))}
            </div>
          </section>

          <div className="fz-divider" />

          <section className="fz-story">
            {acts.map((act, actIndex) => (
              <article
                className={`fz-act fz-reveal${act?.offset ? " fz-act--offset" : ""}`}
                key={`act-${actIndex}`}
              >
                <p className="fz-act-kicker">{act?.kicker}</p>
                <h2>{act?.title}</h2>
                {(Array.isArray(act?.paragraphs) ? act.paragraphs : []).map(
                  (paragraph, paragraphIndex) => (
                    <p key={`act-${actIndex}-paragraph-${paragraphIndex}`}>
                      {renderEmphasisText(
                        paragraph,
                        `act-${actIndex}-paragraph-${paragraphIndex}`,
                      )}
                    </p>
                  ),
                )}
              </article>
            ))}
          </section>

          <section className="fz-reflection fz-reveal">
            <p className="fz-section-label">{reflection.sectionLabel}</p>
            <h2>{reflection.title}</h2>
            <p className="fz-reflection-intro">
              {renderEmphasisText(reflection.intro, "reflection-intro")}
            </p>

            <div className="fz-reflection-quick">
              <p className="fz-reflection-quick-title">
                {reflection.quickTitle}
              </p>
              <ul>
                {reflectionQuick.map((item, itemIndex) => (
                  <li key={`reflection-quick-${itemIndex}`}>
                    {renderEmphasisText(item, `reflection-quick-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="fz-reflection-chapters">
              {reflectionChapters.map((chapter, chapterIndex) => (
                <article
                  className="fz-reflection-chapter"
                  key={`reflection-chapter-${chapterIndex}`}
                >
                  <h3>{chapter?.title}</h3>
                  {(Array.isArray(chapter?.paragraphs)
                    ? chapter.paragraphs
                    : []
                  ).map((paragraph, paragraphIndex) => (
                    <p
                      key={`reflection-chapter-${chapterIndex}-paragraph-${paragraphIndex}`}
                    >
                      {renderEmphasisText(
                        paragraph,
                        `reflection-chapter-${chapterIndex}-paragraph-${paragraphIndex}`,
                      )}
                    </p>
                  ))}
                </article>
              ))}
              <p className="fz-keyline">
                {renderEmphasisText(reflection.keyline, "reflection-keyline")}
              </p>
            </div>
          </section>

          <section className="fz-finale fz-reveal">
            {finale.map((paragraph, index) => (
              <p key={`finale-${index}`}>
                {renderEmphasisText(paragraph, `finale-${index}`)}
              </p>
            ))}
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Conclusion;
