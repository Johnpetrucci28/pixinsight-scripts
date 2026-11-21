/* Fond étoilé animé : scintillement, parallaxe à la souris, Voie lactée et étoiles filantes. */
(function () {
  var canvas = document.getElementById("starfield");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // data-overlay : calque transparent posé sur une photo (étoiles et étoiles filantes seulement)
  var overlay = canvas.hasAttribute("data-overlay");
  var W = 0, H = 0, dpr = 1, stars = [], band = null, shooting = [];
  var mx = 0, my = 0, px = 0, py = 0, nextShoot = 0;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    band = overlay ? null : makeBand();
    if (reduce) draw(0);
  }

  function seed() {
    stars = [];
    var count = Math.round(W * H / (overlay ? 5000 : 1500));
    for (var i = 0; i < count; i++) {
      var z = Math.random();
      stars.push({
        x: Math.random() * (W + 60) - 30,
        y: Math.random() * (H + 60) - 30,
        z: z,
        r: z > 0.97 ? 1.5 + Math.random() : 0.4 + z * 0.9,
        a: 0.25 + Math.random() * 0.75,
        tw: Math.random() * Math.PI * 2,
        ts: 0.4 + Math.random() * 2.2,
        c: Math.random() < 0.15 ? "255,214,170" : Math.random() < 0.3 ? "170,200,255" : "235,240,255"
      });
    }
  }

  function makeBand() {
    var off = document.createElement("canvas");
    var bw = W * 1.2, bh = H * 1.2;
    off.width = Math.max(1, Math.round(bw)); off.height = Math.max(1, Math.round(bh));
    var c = off.getContext("2d");
    c.globalCompositeOperation = "lighter";
    var cols = ["120,90,200", "80,120,220", "220,170,130", "160,110,190"];
    for (var i = 0; i < 160; i++) {
      var t = Math.random();
      var x = t * bw + (Math.random() - 0.5) * bw * 0.12;
      var y = bh * 0.9 - t * bh * 0.8 + (Math.random() - 0.5) * bh * 0.18;
      var r = 40 + Math.random() * Math.min(bw, bh) * 0.18;
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(" + cols[i % cols.length] + ",.045)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    return off;
  }

  function spawnShoot() {
    var fromLeft = Math.random() < 0.5;
    shooting.push({
      x: fromLeft ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5,
      y: Math.random() * H * 0.4,
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 5),
      vy: 2.5 + Math.random() * 2,
      life: 1
    });
  }

  function draw(t) {
    px += (mx - px) * 0.04; py += (my - py) * 0.04;
    if (overlay) ctx.clearRect(0, 0, W, H);
    else {
      var bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.8);
      bg.addColorStop(0, "#0c1027"); bg.addColorStop(1, "#04050a");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }
    if (band) ctx.drawImage(band, -W * 0.1 - px * 10, -H * 0.1 - py * 10, W * 1.2, H * 1.2);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var x = s.x - px * s.z * 26, y = s.y - py * s.z * 26;
      var a = reduce ? s.a : s.a * (0.65 + 0.35 * Math.sin(t * 0.001 * s.ts + s.tw));
      ctx.fillStyle = "rgba(" + s.c + "," + a + ")";
      if (s.r > 1.2) {
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(" + s.c + "," + a * 0.15 + ")";
        ctx.beginPath(); ctx.arc(x, y, s.r * 4, 0, 6.283); ctx.fill();
      } else {
        ctx.fillRect(x, y, s.r, s.r);
      }
    }

    if (!reduce) {
      if (t > nextShoot) { spawnShoot(); nextShoot = t + 3500 + Math.random() * 6000; }
      for (var k = shooting.length - 1; k >= 0; k--) {
        var m = shooting[k];
        m.x += m.vx; m.y += m.vy; m.life -= 0.016;
        var g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 14, m.y - m.vy * 14);
        g.addColorStop(0, "rgba(255,255,255," + Math.max(0, m.life) + ")");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 14, m.y - m.vy * 14); ctx.stroke();
        if (m.life <= 0) shooting.splice(k, 1);
      }
    }
  }

  function loop(t) { draw(t); requestAnimationFrame(loop); }

  window.addEventListener("pointermove", function (e) {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  resize();
  if (!reduce) requestAnimationFrame(loop);
})();
