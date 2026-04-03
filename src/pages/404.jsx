import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import "../styles/404.css";
import "../styles/main.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

// 404-error page mit 3D-szene fallback animation :)
// user kann zurück zur startseite oder mit browser-history navigieren
function NotFound({ isSidebarOpen, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const introTlRef = useRef(null);
  const [isSceneReady, setIsSceneReady] = useState(false);

  // home-pfad mit korrekter sprache
  const homePath = withLang("/", i18n.language);

  // sicherer rückweg: immer zur startseite (wenn history nicht funktioniert)
  const handleReturnSafety = () => {
    navigate(homePath);
  };

  // intelligenter back-knopf: versucht history.back(), fallback zur startseite
  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(homePath);
  };

  // animation und side-effects hier gebündelt, cleanup ist wichtig :/
  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const ctx = gsap.context(() => {
      if (prefersReduced) {
        gsap.set(".nf-page-shell #stars-canvas", { opacity: 0.45 });
        gsap.set(".nf-page-shell #three-canvas", { opacity: 0.2 });
        gsap.set(".nf-ambient-glow", { opacity: 1, scale: 1 });
        gsap.set(".nf-vignette", { opacity: 1 });
        return;
      }

      gsap.set(".nf-page-shell #stars-canvas", { opacity: 0 });
      gsap.set(".nf-page-shell #three-canvas", {
        opacity: 0,
        scale: 1.08,
        y: 24,
        transformOrigin: "50% 50%",
      });
      gsap.set(".nf-ambient-glow", {
        opacity: 0,
        scale: 0.78,
        transformOrigin: "50% 50%",
      });
      gsap.set(".nf-vignette", { opacity: 0 });
      gsap.set(".nf-hero > *", { opacity: 0, y: 24 });
      gsap.set(".nf-actions .nf-btn", { opacity: 0, y: 18 });

      introTlRef.current = gsap
        .timeline({ paused: true })
        .to(".nf-page-shell #stars-canvas", {
          opacity: 0.45,
          duration: 0.65,
          ease: "power2.out",
        })
        .to(
          ".nf-page-shell #three-canvas",
          {
            opacity: 0.2,
            scale: 1,
            y: 0,
            duration: 1,
            ease: "power3.out",
          },
          0,
        )
        .to(
          ".nf-ambient-glow",
          {
            opacity: 1,
            scale: 1,
            duration: 1.2,
            ease: "power2.out",
          },
          0.05,
        )
        .to(
          ".nf-vignette",
          {
            opacity: 1,
            duration: 0.6,
            ease: "power1.out",
          },
          0.2,
        )
        .to(
          ".nf-hero > *",
          {
            opacity: 1,
            y: 0,
            duration: 0.62,
            stagger: 0.08,
            ease: "power3.out",
          },
          "-=0.45",
        )
        .to(
          ".nf-actions .nf-btn",
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            stagger: 0.08,
            ease: "power2.out",
          },
          "-=0.2",
        );

      gsap.to(".nf-ambient-glow", {
        yPercent: -5,
        xPercent: 3,
        duration: 7.2,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    if (!introTlRef.current) return;
    if (isSceneReady) {
      introTlRef.current.play();
    }
  }, [isSceneReady]);

  // effect-block getrennt halten damit updates nicht gegeneinander laufen
  useEffect(() => {
    if (isSceneReady) return undefined;

    const fallbackTimer = window.setTimeout(() => {
      introTlRef.current?.play();
    }, 1200);

    return () => window.clearTimeout(fallbackTimer);
  }, [isSceneReady]);

  return (
    <div
      className={`page-wrapper content-page nf-page-shell ${isSidebarOpen ? "sidebar-open" : ""}`}
      ref={rootRef}
    >
      <div className="nf-bg-layer" aria-hidden="true">
        <Starfield mode="orbit-center" />
        <Scene3D
          hasMessages={false}
          sceneMode="not-found"
          hidePlanet={false}
          onReady={() => setIsSceneReady(true)}
        />
        <div className="nf-ambient-glow" />
        <div className="nf-vignette" />
      </div>

      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

      <main className="page-content nf-content-layer">
        <div className="page-container nf-container">
          <section className="nf-hero">
            <div className="nf-code-wrap" aria-hidden="true">
              <p className="nf-code">404</p>
            </div>

            <h1 className="nf-title">
              {t("notFound.moonMessage", {
                defaultValue: "Seems like you stranded on the moon...",
              })}
            </h1>

            <div className="nf-actions">
              <button
                className="nf-btn nf-btn-primary"
                type="button"
                onClick={handleReturnSafety}
              >
                {t("notFound.returnSafety", {
                  defaultValue: "Return to safety",
                })}
              </button>

              <button
                className="nf-btn nf-btn-secondary"
                type="button"
                onClick={handleGoBack}
              >
                {t("notFound.goBack", { defaultValue: "Go back" })}
              </button>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default NotFound;
