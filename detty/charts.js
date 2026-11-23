/* Tiny canvas chart library: line chart with hover, donut, and the share card. No dependencies. */
(function (root) {
  "use strict";

  function setup(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: height };
  }

  const compact = (n) => {
    const a = Math.abs(n), s = n < 0 ? "−" : "";
    if (a >= 1e6) return s + "₦" + (a / 1e6).toFixed(1) + "m";
    if (a >= 1e3) return s + "₦" + Math.round(a / 1e3) + "k";
    return s + "₦" + Math.round(a);
  };

  /** Balance-over-time chart. Returns a function to redraw with a hover index. */
  function balanceChart(canvas, days, { fmtDate, onHover } = {}) {
    const pad = { l: 52, r: 14, t: 16, b: 28 };
    let hover = null;

    function draw() {
      const { ctx, w, h } = setup(canvas, 260);
      const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
      const vals = days.map((d) => d.balance);
      let max = Math.max(...vals, 0), min = Math.min(...vals, 0);
      const span = max - min || 1;
      max += span * 0.08; min -= span * 0.08;
      const x = (i) => pad.l + (i / (days.length - 1)) * iw;
      const y = (v) => pad.t + (1 - (v - min) / (max - min)) * ih;

      // grid + labels
      ctx.font = "11px -apple-system, Inter, sans-serif";
      ctx.fillStyle = "#8fa197";
      ctx.strokeStyle = "#1f2823";
      ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const v = min + ((max - min) * k) / 4;
        const yy = Math.round(y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
        ctx.textAlign = "right"; ctx.fillText(compact(v), pad.l - 8, yy + 4);
      }
      ctx.textAlign = "center";
      days.forEach((d, i) => {
        const dom = Number(d.date.slice(8));
        if (dom === 1 || dom === 15) ctx.fillText(fmtDate(d.date), x(i), h - 8);
      });

      // zero line
      if (min < 0) {
        ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = "#ff5d5d"; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(pad.l, y(0)); ctx.lineTo(w - pad.r, y(0)); ctx.stroke(); ctx.restore();
      }

      // area fill (green above zero, red below)
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      const zero = Math.min(1, Math.max(0, (y(0) - pad.t) / ih));
      grad.addColorStop(0, "rgba(31,196,107,.35)");
      grad.addColorStop(zero, "rgba(31,196,107,.04)");
      grad.addColorStop(Math.min(1, zero + 0.001), "rgba(255,93,93,.08)");
      grad.addColorStop(1, "rgba(255,93,93,.35)");
      ctx.beginPath();
      ctx.moveTo(x(0), y(0));
      days.forEach((d, i) => ctx.lineTo(x(i), y(d.balance)));
      ctx.lineTo(x(days.length - 1), y(0));
      ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

      // the line, coloured by sign
      ctx.lineWidth = 2.5; ctx.lineJoin = "round";
      for (let i = 1; i < days.length; i++) {
        ctx.strokeStyle = days[i].balance < 0 ? "#ff5d5d" : "#1fc46b";
        ctx.beginPath(); ctx.moveTo(x(i - 1), y(days[i - 1].balance)); ctx.lineTo(x(i), y(days[i].balance)); ctx.stroke();
      }

      // markers: events (dots) and paydays (gold)
      days.forEach((d, i) => {
        if (d.isPayday) { dot(ctx, x(i), y(d.balance), 5, "#f2b43a"); }
        else if (d.events.length) { dot(ctx, x(i), y(d.balance), 4, "#eef3ef"); }
      });

      // hover crosshair
      if (hover != null) {
        const d = days[hover], hx = x(hover), hy = y(d.balance);
        ctx.strokeStyle = "rgba(238,243,239,.25)";
        ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + ih); ctx.stroke();
        dot(ctx, hx, hy, 6, d.balance < 0 ? "#ff5d5d" : "#1fc46b");
      }
    }

    function dot(ctx, cx, cy, r, c) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#151a17"; ctx.stroke();
    }

    function pick(evt) {
      const r = canvas.getBoundingClientRect();
      const px = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
      const iw = r.width - pad.l - pad.r;
      const i = Math.round(((px - pad.l) / iw) * (days.length - 1));
      hover = Math.max(0, Math.min(days.length - 1, i));
      draw();
      onHover && onHover(days[hover]);
    }
    canvas.onmousemove = pick;
    canvas.ontouchmove = (e) => { pick(e); };
    canvas.ontouchstart = pick;
    canvas.onmouseleave = () => { hover = null; draw(); onHover && onHover(null); };

    draw();
    return draw;
  }

  function donut(canvas, parts) {
    const { ctx, w, h } = setup(canvas, 180);
    const total = parts.reduce((s, p) => s + p.value, 0);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
    if (!total) {
      ctx.fillStyle = "#8fa197"; ctx.textAlign = "center"; ctx.font = "13px sans-serif";
      ctx.fillText("No events yet", cx, cy);
      return;
    }
    let a = -Math.PI / 2;
    for (const p of parts) {
      const da = (p.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, a, a + da); ctx.arc(cx, cy, r * 0.62, a + da, a, true);
      ctx.closePath(); ctx.fillStyle = p.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#151a17"; ctx.stroke();
      a += da;
    }
    ctx.fillStyle = "#eef3ef"; ctx.textAlign = "center";
    ctx.font = "700 18px -apple-system, Inter, sans-serif"; ctx.fillText(compact(total), cx, cy + 2);
    ctx.fillStyle = "#8fa197"; ctx.font = "11px -apple-system, Inter, sans-serif"; ctx.fillText("on events", cx, cy + 18);
  }

  /** 1200x675 image for X. */
  function shareCard(days, summary, { naira, fmtDate, url }) {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 675;
    const ctx = c.getContext("2d");
    const bg = ctx.createRadialGradient(600, -100, 50, 600, 300, 900);
    bg.addColorStop(0, "#12361f"); bg.addColorStop(1, "#0c0f0d");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 675);

    ctx.fillStyle = "#1fc46b"; ctx.font = "700 26px -apple-system, Inter, sans-serif";
    ctx.fillText("DETTY DECEMBER FORECAST 🇳🇬", 64, 86);
    ctx.fillStyle = "#eef3ef"; ctx.font = "800 54px -apple-system, Inter, sans-serif";
    wrap(ctx, summary.verdict.text, 64, 160, 1070, 62);

    const stats = [
      ["Dec 31 balance", naira(summary.decemberEndBalance)],
      ["Lowest point", naira(summary.lowest.balance)],
      ["Broke on", summary.brokeDate ? fmtDate(summary.brokeDate) : "Never 💪"],
      ["Spent on events", naira(summary.eventTotal)],
    ];
    stats.forEach(([k, v], i) => {
      const x = 64 + i * 272;
      ctx.fillStyle = "#151a17"; roundRect(ctx, x, 300, 250, 110, 18); ctx.fill();
      ctx.fillStyle = "#8fa197"; ctx.font = "20px -apple-system, Inter, sans-serif"; ctx.fillText(k, x + 22, 340);
      ctx.fillStyle = "#eef3ef"; ctx.font = "800 32px -apple-system, Inter, sans-serif"; ctx.fillText(v, x + 22, 385);
    });

    // mini chart
    const vals = days.map((d) => d.balance);
    const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
    const X = (i) => 64 + (i / (days.length - 1)) * 1072;
    const Y = (v) => 450 + (1 - (v - min) / (max - min || 1)) * 140;
    ctx.lineWidth = 5; ctx.lineJoin = "round";
    for (let i = 1; i < days.length; i++) {
      ctx.strokeStyle = days[i].balance < 0 ? "#ff5d5d" : "#1fc46b";
      ctx.beginPath(); ctx.moveTo(X(i - 1), Y(vals[i - 1])); ctx.lineTo(X(i), Y(vals[i])); ctx.stroke();
    }
    ctx.fillStyle = "#8fa197"; ctx.font = "20px -apple-system, Inter, sans-serif";
    ctx.fillText(url.replace(/^https?:\/\//, ""), 64, 640);
    return c;
  }

  function wrap(ctx, text, x, y, maxW, lh) {
    let line = "";
    for (const word of text.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = word; y += lh; }
      else line = test;
    }
    ctx.fillText(line, x, y);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  root.DettyCharts = { balanceChart, donut, shareCard };
})(window);
