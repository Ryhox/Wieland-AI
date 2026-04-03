import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "../styles/FAQ.css";
import "../styles/main.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import Starfield from "../components/Starfield";
import Scene3D from "../components/Scene3D";
import { useAuth } from "../context/AuthContext";
import { withLang } from "../utils/i18nRouting";

// einfaches faq-item component: frage ausklappbar mit antwort darunter
function FAQItem({ q, a, open, onToggle }) {
  return (
    <div className={`faq-item ${open ? "faq-item--open" : ""}`}>
      <button className="faq-q" onClick={onToggle}>
        <span>{q}</span>
        <svg
          className={`faq-chevron ${open ? "faq-chevron--open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={`faq-answer ${open ? "faq-answer--open" : ""}`}>
        <p className="faq-answer-text">{a}</p>
      </div>
    </div>
  );
}

// hauptseite: faq mit suche und kategorie-filter
function FAQ({ isSidebarOpen, onSidebarToggle }) {
  // translations + auth context
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const rootRef = useRef(null);

  // ui-state: welche frage offen, welcher filter aktiv, suchquery
  const [openQuestion, setOpenQuestion] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const faqData = t("faqPage.items", { returnObjects: true }) || [];
  const faqFilters = [
    { id: "all", label: t("faqPage.filters.all") },
    { id: "subscription", label: t("faqPage.filters.subscription") },
    { id: "model", label: t("faqPage.filters.model") },
    { id: "about", label: t("faqPage.filters.about") },
  ];

  const localPath = (path) => withLang(path, i18n.language);

  // kategorie-klassifizierung basierend auf Text-Matching
  const getCategory = (item) => {
    const source = `${item.q} ${item.a}`.toLowerCase();
    // regex pattern für subscription-keywords
    if (
      /abo|subscript|kuendig|cancel|upgrade|downgrade|plan|price|preis|max|pro|free|abbon/.test(
        source,
      )
    )
      return "subscription";
    // model/KI-schichten pattern
    if (/modell|model|2b|4b|8b|multimodal|modello/.test(source)) return "model";
    return "about";
  };

  // filtering: kategorie UND suchtext müssen matchen
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredFaq = faqData.filter((item) => {
    // kategorie check
    const categoryOk =
      activeFilter === "all" || getCategory(item) === activeFilter;
    // text search in frage + antwort
    const searchOk =
      !normalizedQuery ||
      item.q.toLowerCase().includes(normalizedQuery) ||
      item.a.toLowerCase().includes(normalizedQuery);
    return categoryOk && searchOk;
  });

  // animation und side-effects hier gebündelt, cleanup ist wichtig :/
  useLayoutEffect(() => {
    if (!rootRef.current) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      gsap.set(".faq-page-wrapper #three-canvas", {
        transformOrigin: "50% 50%",
        opacity: 0,
      });
      gsap.set(".faq-page-wrapper #stars-canvas", { opacity: 0 });
      gsap.set(".faq-hero > *", { opacity: 0, y: 26 });
      gsap.set(".faq-tools", { opacity: 0, y: 20 });
      gsap.set(".faq-list", { opacity: 0, y: 18 });
      gsap.set(".faq-list .faq-item", { opacity: 0, y: 30 });
      gsap.set(".faq-list .faq-item", {
        backgroundColor: "rgba(255, 255, 255, 0)",
      });
      gsap.set(".faq-footer-note", { opacity: 0, y: 20 });

      gsap
        .timeline()
        .to(".faq-page-wrapper #stars-canvas", {
          opacity: 0.42,
          duration: 0.3,
          ease: "power2.out",
        })
        .to(
          ".faq-page-wrapper #three-canvas",
          { opacity: 0.14, duration: 0.5, ease: "power2.out" },
          0,
        )
        .to(
          ".faq-hero > *",
          {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.07,
            ease: "power3.out",
          },
          "-=0.2",
        )
        .to(
          ".faq-tools",
          {
            opacity: 1,
            y: 0,
            duration: 0.28,
            ease: "power2.out",
          },
          "-=0.06",
        )
        .to(
          ".faq-list",
          {
            opacity: 1,
            y: 0,
            duration: 0.3,
            ease: "power2.out",
          },
          "-=0.06",
        )
        .to(
          ".faq-list .faq-item",
          {
            opacity: 1,
            y: 0,
            duration: 0.28,
            stagger: 0.04,
            ease: "power3.out",
          },
          "-=0.08",
        )
        .to(
          ".faq-list .faq-item",
          {
            backgroundColor: "rgba(255, 255, 255, 0.035)",
            duration: 0.34,
            stagger: 0.04,
            ease: "power2.out",
            clearProps: "backgroundColor",
          },
          "-=0.18",
        )
        .to(
          ".faq-footer-note",
          {
            opacity: 1,
            y: 0,
            duration: 0.26,
            ease: "power3.out",
          },
          "-=0.06",
        );
    }, rootRef);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div
      className={`page-wrapper content-page faq-page-wrapper ${isSidebarOpen ? "sidebar-open" : ""}`}
      ref={rootRef}
    >
      <div className="faq-bg-layer" aria-hidden="true">
        <Starfield />
        <Scene3D hasMessages={true} sceneMode="about" hidePlanet={true} />
        <div className="faq-ambient-glow" />
      </div>
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && (
        <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />
      )}

      <main className="page-content faq-content-layer">
        <div className="page-container faq-container">
          <div className="faq-hero">
            <span className="faq-eyebrow">{t("faqPage.eyebrow")}</span>
            <h1 className="faq-h1">
              {t("faqPage.title")}
              <br />
              <span>{t("faqPage.titleAccent")}</span>
            </h1>
            <p className="faq-lead">{t("faqPage.lead")}</p>
          </div>

          <div className="faq-tools" role="search">
            <div className="faq-search-wrap">
              <input
                type="text"
                className="faq-search"
                placeholder={t("faqPage.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setOpenQuestion(null);
                }}
                aria-label={t("faqPage.searchAria")}
              />
            </div>
            <div
              className="faq-filter-row"
              aria-label={t("faqPage.filterAria")}
            >
              {faqFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`faq-filter-pill ${activeFilter === filter.id ? "active" : ""}`}
                  onClick={() => {
                    setActiveFilter(filter.id);
                    setOpenQuestion(null);
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="faq-list">
            {filteredFaq.map((item) => (
              <FAQItem
                key={item.q}
                q={item.q}
                a={item.a}
                open={openQuestion === item.q}
                onToggle={() =>
                  setOpenQuestion(openQuestion === item.q ? null : item.q)
                }
              />
            ))}
            {filteredFaq.length === 0 && (
              <div className="faq-empty-state">{t("faqPage.empty")}</div>
            )}
          </div>

          <p className="faq-footer-note">
            {t("faqPage.more")}{" "}
            <button
              onClick={() => navigate(localPath("/contact"))}
              className="faq-contact-link"
            >
              {t("faqPage.contact")}
            </button>{" "}
            {t("faqPage.moreEnd")}
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default FAQ;
