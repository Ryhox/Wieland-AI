import { useEffect, useRef } from 'react';

export default function Starfield() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const ctx = c.getContext('2d');
    let W, H, stars;

    function resize() {
      W = c.width = window.innerWidth;
      H = c.height = window.innerHeight;
      build();
    }

    function build() {
      stars = Array.from({ length: 320 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.12,
        a: Math.random() * 0.85 + 0.1,
        sp: (Math.random() * 0.22 + 0.06) * (Math.random() > 0.5 ? 1 : -1),
        t: Math.random() * Math.PI * 2,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const now = performance.now() / 1000;
      for (const s of stars) {
        const a = s.a * (0.4 + 0.6 * Math.sin(now * Math.abs(s.sp) + s.t));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(185,215,255,${a})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener('resize', resize);
    draw();

    return () => {
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} id="stars-canvas" />;
}
