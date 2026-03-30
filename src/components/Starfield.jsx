import { useEffect, useRef } from "react";

export default function Starfield({ mode = "twinkle" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const ctx = c.getContext("2d");
    let W, H, stars;

    function resize() {
      W = c.width = window.innerWidth;
      H = c.height = window.innerHeight;
      build();
    }

    function buildTwinkle() {
      return Array.from({ length: 320 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.12,
        a: Math.random() * 0.85 + 0.1,
        sp: (Math.random() * 0.22 + 0.06) * (Math.random() > 0.5 ? 1 : -1),
        t: Math.random() * Math.PI * 2,
      }));
    }

    function buildOrbitCenter() {
      const maxRadius = Math.min(W, H) * 0.34;
      const minRadius = Math.min(W, H) * 0.12;

      return Array.from({ length: 280 }, () => ({
        d: minRadius + Math.random() * (maxRadius - minRadius),
        a: Math.random() * Math.PI * 2,
        v: (Math.random() * 0.42 + 0.08) * (Math.random() > 0.55 ? 1 : -1),
        r: Math.random() * 1.4 + 0.15,
        o: Math.random() * 0.85 + 0.12,
        t: Math.random() * Math.PI * 2,
      }));
    }

    function build() {
      stars = mode === "orbit-center" ? buildOrbitCenter() : buildTwinkle();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const now = performance.now() / 1000;

      if (mode === "orbit-center") {
        const cx = W / 2;
        const cy = H / 2;
        for (const s of stars) {
          const angle = s.a + now * s.v;
          const x = cx + Math.cos(angle) * s.d;
          const y = cy + Math.sin(angle) * s.d * 0.72;
          const alpha =
            s.o * (0.45 + 0.55 * Math.sin(now * (Math.abs(s.v) + 0.35) + s.t));
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(185,215,255,${alpha})`;
          ctx.fill();
        }
      } else {
        for (const s of stars) {
          const alpha =
            s.a * (0.4 + 0.6 * Math.sin(now * Math.abs(s.sp) + s.t));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(185,215,255,${alpha})`;
          ctx.fill();
        }
      }

      requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [mode]);

  return <canvas ref={canvasRef} id="stars-canvas" />;
}
