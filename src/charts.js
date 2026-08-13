// ============================================================
// Canvas 2D 图表：发动机特性 / 驱动力-车速 / 转速-车速 / 同步过程 / 换挡图 / 变矩器特性 / 仪表
// 深色主题，配色为已校验的分类色板（dark 列）
// ============================================================
import {
  ENG, GEAR_RATIOS, VEH, AT, engineTorqueWOT, enginePowerKW, resistForce,
  tractionForce, rpmOfSpeed, speedOfRpm, SHIFT_MAP, converterTorqueRatio, converterEfficiency, KMH,
} from './params.js';

export const C = {
  surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781',
  grid: '#2c2c2a', baseline: '#383835',
  s: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  warn: '#fab219', bad: '#d03b3b',
};

// ---------- 基础绘图辅助 ----------
class Panel {
  constructor(ctx, x, y, w, h, xr, yr) {
    this.ctx = ctx; this.x = x; this.y = y; this.w = w; this.h = h;
    this.xr = xr; this.yr = yr;
  }
  px(v) { return this.x + ((v - this.xr[0]) / (this.xr[1] - this.xr[0])) * this.w; }
  py(v) { return this.y + this.h - ((v - this.yr[0]) / (this.yr[1] - this.yr[0])) * this.h; }
  grid(xt, yt, xfmt, yfmt) {
    const { ctx } = this;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.muted;
    ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of xt) {
      const px = this.px(v);
      ctx.beginPath(); ctx.moveTo(px, this.y); ctx.lineTo(px, this.y + this.h); ctx.stroke();
      if (xfmt) ctx.fillText(xfmt(v), px, this.y + this.h + 4);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yt) {
      const py = this.py(v);
      ctx.beginPath(); ctx.moveTo(this.x, py); ctx.lineTo(this.x + this.w, py); ctx.stroke();
      if (yfmt) ctx.fillText(yfmt(v), this.x - 5, py);
    }
    ctx.strokeStyle = C.baseline;
    ctx.strokeRect(this.x, this.y, this.w, this.h);
  }
  line(pts, color, { width = 2, dash = null } = {}) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath(); ctx.rect(this.x - 1, this.y - 1, this.w + 2, this.h + 2); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let started = false;
    for (const [vx, vy] of pts) {
      const px = this.px(vx), py = this.py(vy);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  dot(vx, vy, color, r = 4.5) {
    const { ctx } = this;
    const px = this.px(vx), py = this.py(vy);
    if (px < this.x - 2 || px > this.x + this.w + 2 || py < this.y - 2 || py > this.y + this.h + 2) return;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.surface; ctx.stroke();
  }
  text(vx, vy, str, color, align = 'left', dx = 0, dy = 0) {
    const { ctx } = this;
    ctx.fillStyle = color; ctx.font = '10.5px system-ui';
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(str, this.px(vx) + dx, this.py(vy) + dy);
  }
  band(x0, x1, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    const a = Math.max(this.px(x0), this.x), b = Math.min(this.px(x1), this.x + this.w);
    ctx.fillRect(a, this.y, b - a, this.h);
  }
}

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.clientWidth || 360;
  const h = canvas.getAttribute('height') ? Number(canvas.getAttribute('height')) : 180;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.surface;
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h };
}

function attachHover(canvas, store) {
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    store.mx = e.clientX - r.left; store.my = e.clientY - r.top;
  });
  canvas.addEventListener('mouseleave', () => { store.mx = null; });
}

// ---------- 1. 发动机外特性（扭矩/功率 小倍数堆叠） ----------
export function makeEngineChart(canvas) {
  const hover = {};
  attachHover(canvas, hover);
  return function draw(rpm = 0) {
    const { ctx, w } = setupCanvas(canvas);
    const xr = [0, 7000];
    const pT = new Panel(ctx, 40, 8, w - 52, 62, xr, [0, 190]);
    const pP = new Panel(ctx, 40, 94, w - 52, 54, xr, [0, 100]);
    for (const p of [pT, pP]) {
      p.band(0, ENG.idle, 'rgba(137,135,129,0.12)');
      p.band(ENG.redline, 7000, 'rgba(208,59,59,0.15)');
    }
    pT.grid([0, 2000, 4000, 6000], [0, 90, 180], null, (v) => v);
    pP.grid([0, 2000, 4000, 6000], [0, 50, 100], (v) => v, (v) => v);
    const tq = [], pw = [];
    for (let n = 600; n <= ENG.redline; n += 100) {
      tq.push([n, engineTorqueWOT(n)]);
      pw.push([n, enginePowerKW(n)]);
    }
    pT.line(tq, C.s[0]);
    pP.line(pw, C.s[1]);
    ctx.fillStyle = C.ink2; ctx.font = '10.5px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('扭矩 N·m', 44, 16);
    ctx.fillText('功率 kW', 44, 102);
    ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    ctx.fillText('发动机转速 rpm', 40 + (w - 52) / 2, 162);
    // 峰值标注
    pT.text(3900, 165, '峰值扭矩 165N·m @3900', C.s[0], 'center', 0, -10);
    pP.text(5750, 86, '峰值功率 86kW @5750', C.s[1], 'right', -4, -8);
    if (rpm > 0) {
      pT.dot(rpm, engineTorqueWOT(rpm), C.s[0]);
      pP.dot(rpm, enginePowerKW(rpm), C.s[1]);
    }
    if (hover.mx != null) {
      const n = Math.round(((hover.mx - 40) / (w - 52)) * 7000 / 50) * 50;
      if (n >= 600 && n <= ENG.redline) {
        ctx.fillStyle = C.ink;
        ctx.textAlign = hover.mx > w * 0.6 ? 'right' : 'left';
        ctx.fillText(`${n} rpm · ${engineTorqueWOT(n).toFixed(0)} N·m · ${enginePowerKW(n).toFixed(0)} kW`, hover.mx + (hover.mx > w * 0.6 ? -6 : 6), 86);
        ctx.strokeStyle = C.baseline;
        ctx.beginPath(); ctx.moveTo(hover.mx, 8); ctx.lineTo(hover.mx, 148); ctx.stroke();
      }
    }
  };
}

// ---------- 2. 驱动力-车速 ----------
export function makeTractionChart(canvas) {
  const hover = {};
  attachHover(canvas, hover);
  return function draw(op = null /* {v, gear, F} */) {
    const { ctx, w } = setupCanvas(canvas);
    const p = new Panel(ctx, 42, 10, w - 54, 168, [0, 210], [0, 8500]);
    p.grid([0, 50, 100, 150, 200], [0, 2000, 4000, 6000, 8000], (v) => v, (v) => v >= 1000 ? v / 1000 + 'k' : v);
    // 阻力
    const res = [];
    for (let v = 0; v <= 210; v += 4) res.push([v, resistForce(v / KMH)]);
    p.line(res, C.muted, { dash: [5, 4] });
    p.text(148, resistForce(148 / KMH), '行驶阻力', C.muted, 'right', -2, -9);
    // 各挡驱动力（标签放在各自扭矩峰值车速处，自然错开）
    GEAR_RATIOS.forEach((ig, i) => {
      const pts = [];
      const v0 = speedOfRpm(ENG.idle, ig) * KMH, v1 = speedOfRpm(ENG.redline, ig) * KMH;
      for (let v = v0; v <= Math.min(v1, 210); v += 1.5) {
        pts.push([v, tractionForce(rpmOfSpeed(v / KMH, ig), 1, ig)]);
      }
      p.line(pts, C.s[i]);
      const lv = Math.min(speedOfRpm(3900, ig) * KMH, 195);
      p.text(lv, tractionForce(rpmOfSpeed(lv / KMH, ig), 1, ig), `${i + 1}挡`, C.s[i], 'center', 0, -10);
    });
    ctx.fillStyle = C.muted; ctx.font = '10.5px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('车速 km/h', 42 + (w - 54) / 2, 196);
    ctx.save(); ctx.translate(11, 10 + 84); ctx.rotate(-Math.PI / 2);
    ctx.fillText('轮上驱动力 N', 0, 0); ctx.restore();
    if (op && op.gear > 0) p.dot(op.v * KMH, op.F, C.ink);
    if (hover.mx != null) {
      const v = ((hover.mx - 42) / (w - 54)) * 210;
      if (v > 0 && v < 210) {
        ctx.strokeStyle = C.baseline;
        ctx.beginPath(); ctx.moveTo(hover.mx, 10); ctx.lineTo(hover.mx, 178); ctx.stroke();
        ctx.fillStyle = C.ink; ctx.textAlign = hover.mx > w * 0.55 ? 'right' : 'left';
        const dx = hover.mx > w * 0.55 ? -6 : 6;
        let yy = 24;
        ctx.fillText(`${v.toFixed(0)} km/h`, hover.mx + dx, yy);
        GEAR_RATIOS.forEach((ig, i) => {
          const n = rpmOfSpeed(v / KMH, ig);
          if (n >= ENG.idle && n <= ENG.redline) {
            yy += 13;
            ctx.fillStyle = C.s[i];
            ctx.fillText(`${i + 1}挡 ${tractionForce(n, 1, ig).toFixed(0)}N @${n.toFixed(0)}rpm`, hover.mx + dx, yy);
          }
        });
      }
    }
  };
}

// ---------- 3. 发动机转速-车速 ----------
export function makeRpmSpeedChart(canvas) {
  return function draw(op = null) {
    const { ctx, w } = setupCanvas(canvas);
    const p = new Panel(ctx, 42, 10, w - 54, 140, [0, 210], [0, 7200]);
    // 可用转速带
    ctx.fillStyle = 'rgba(57,135,229,0.09)';
    ctx.fillRect(p.x, p.py(ENG.redline), p.w, p.py(ENG.idle) - p.py(ENG.redline));
    p.grid([0, 50, 100, 150, 200], [0, 2000, 4000, 6000], (v) => v, (v) => v >= 1000 ? v / 1000 + 'k' : v);
    ctx.strokeStyle = C.bad;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(p.x, p.py(ENG.redline)); ctx.lineTo(p.x + p.w, p.py(ENG.redline)); ctx.stroke();
    ctx.setLineDash([]);
    p.text(4, ENG.redline, '红线 6500', C.bad, 'left', 0, -8);
    p.text(4, ENG.idle, '怠速 800', C.muted, 'left', 0, -8);
    GEAR_RATIOS.forEach((ig, i) => {
      const v1 = Math.min(speedOfRpm(7200, ig) * KMH, 210);
      p.line([[0, 0], [v1, rpmOfSpeed(v1 / KMH, ig)]], C.s[i]);
      const vl = Math.min(speedOfRpm(6500, ig) * KMH, 190);
      p.text(vl, rpmOfSpeed(vl / KMH, ig), `${i + 1}`, C.s[i], 'center', 6, -6);
    });
    ctx.fillStyle = C.muted; ctx.font = '10.5px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('车速 km/h', 42 + (w - 54) / 2, 168);
    if (op && op.gear > 0) p.dot(op.v * KMH, op.rpm, C.ink);
  };
}

// ---------- 4. 同步过程（时间序列） ----------
export function makeSyncChart(canvas) {
  return function draw(history, totalT, phaseSpans) {
    const { ctx, w } = setupCanvas(canvas);
    const p = new Panel(ctx, 42, 10, w - 54, 122, [0, totalT], [0, 4200]);
    // 阶段底色（同步阶段）
    if (phaseSpans) {
      for (const s of phaseSpans) {
        ctx.fillStyle = s.color;
        ctx.fillRect(p.px(s.t0), p.y, p.px(s.t1) - p.px(s.t0), p.h);
        ctx.fillStyle = C.muted; ctx.font = '9.5px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(s.name, (p.px(s.t0) + p.px(s.t1)) / 2, p.y + 10);
      }
    }
    p.grid([], [0, 1000, 2000, 3000, 4000], null, (v) => v >= 1000 ? v / 1000 + 'k' : v);
    if (history.length > 1) {
      p.line(history.map((h) => [h.t, h.dog]), C.s[0]);
      p.line(history.map((h) => [h.t, h.sleeve]), C.s[2]);
      const last = history[history.length - 1];
      p.dot(last.t, last.dog, C.s[0], 3.5);
      p.dot(last.t, last.sleeve, C.s[2], 3.5);
    }
    ctx.font = '10.5px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.s[0]; ctx.fillText('— 3挡齿轮接合齿转速（输入轴侧）', 46, 148);
    ctx.fillStyle = C.s[2]; ctx.fillText('— 接合套转速（输出轴/车速侧）', 46, 161);
  };
}

// ---------- 5. TCU 换挡图 ----------
export function makeShiftMapChart(canvas) {
  const hover = {};
  attachHover(canvas, hover);
  return function draw(op = null /* {v(km/h), throttle(0-1), gear} */) {
    const { ctx, w } = setupCanvas(canvas);
    const p = new Panel(ctx, 42, 12, w - 54, 158, [0, 170], [0, 100]);
    p.grid([0, 40, 80, 120, 160], [0, 25, 50, 75, 100], (v) => v, (v) => v + '%');
    const names = ['1→2', '2→3', '3→4'];
    const dnames = ['2→1', '3→2', '4→3'];
    for (let i = 0; i < 3; i++) {
      const up = [], dn = [];
      for (let t = 0; t <= 100; t += 2) {
        up.push([SHIFT_MAP.up[i](t / 100), t]);
        dn.push([SHIFT_MAP.down[i](t / 100), t]);
      }
      p.line(up, C.s[i]);
      p.line(dn, C.s[i], { dash: [4, 4], width: 1.5 });
      p.text(SHIFT_MAP.up[i](0.9), 90, names[i] + '升', C.s[i], 'left', 5, 0);
      const dy = 10 + i * 26; // 降挡线标签沿线错开
      p.text(SHIFT_MAP.down[i](dy / 100), dy, dnames[i] + '降', C.s[i], 'right', -5, 0);
    }
    ctx.fillStyle = C.muted; ctx.font = '10.5px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('车速 km/h', 42 + (w - 54) / 2, 188);
    ctx.save(); ctx.translate(11, 12 + 79); ctx.rotate(-Math.PI / 2);
    ctx.fillText('油门开度', 0, 0); ctx.restore();
    if (op) {
      p.dot(op.v * KMH, op.throttle * 100, C.ink, 5.5);
      p.text(op.v * KMH, op.throttle * 100, `${op.gear}挡`, C.ink, 'left', 9, 0);
    }
    if (hover.mx != null && hover.my != null) {
      const v = ((hover.mx - 42) / (w - 54)) * 170;
      const t = 100 - ((hover.my - 12) / 158) * 100;
      if (v >= 0 && v <= 170 && t >= 0 && t <= 100) {
        ctx.fillStyle = C.ink2; ctx.textAlign = 'left';
        ctx.fillText(`${v.toFixed(0)} km/h · 油门${t.toFixed(0)}%`, 48, 22);
      }
    }
  };
}

// ---------- 6. 变矩器特性（小倍数堆叠） ----------
export function makeConverterChart(canvas) {
  return function draw(sr = null, lockup = 0) {
    const { ctx, w } = setupCanvas(canvas);
    const xr = [0, 1];
    const pK = new Panel(ctx, 42, 8, w - 54, 58, xr, [0, 2.2]);
    const pE = new Panel(ctx, 42, 92, w - 54, 52, xr, [0, 100]);
    pK.grid([0, 0.25, 0.5, 0.75, 1], [0, 1, 2], null, (v) => v);
    pE.grid([0, 0.25, 0.5, 0.75, 1], [0, 50, 100], (v) => v, (v) => v);
    const kts = [], ets = [];
    for (let s = 0; s <= 1.001; s += 0.02) {
      kts.push([s, converterTorqueRatio(s)]);
      ets.push([s, converterEfficiency(s) * 100]);
    }
    pK.line(kts, C.s[0]);
    pE.line(ets, C.s[1]);
    ctx.fillStyle = C.ink2; ctx.font = '10.5px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('变矩比 K', 46, 16);
    ctx.fillText('效率 %', 46, 100);
    pK.text(0.02, 1.9, '失速 K≈1.9（扭矩放大）', C.s[0], 'left', 4, 8);
    pE.text(0.85, 92, lockup > 0.5 ? '锁止中 η≈100%' : '耦合点', C.s[1], 'right', -3, 4);
    ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    ctx.fillText('速比 = 涡轮转速 / 泵轮转速', 42 + (w - 54) / 2, 158);
    if (sr != null) {
      pK.dot(sr, converterTorqueRatio(sr), C.s[0]);
      pE.dot(sr, converterEfficiency(sr) * 100, C.s[1]);
    }
  };
}

// ---------- 7. 仪表盘 ----------
export function drawGauge(canvas, { value, min, max, redFrom, label, unit, fmt }) {
  const { ctx } = (() => {
    if (!canvas.style.width) {
      canvas.style.width = canvas.width + 'px';
      canvas.style.height = canvas.height + 'px';
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== canvas.clientWidth * dpr) {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return { ctx: c };
  })();
  const wpx = canvas.clientWidth, hpx = canvas.clientHeight;
  const cx = wpx / 2, cy = hpx * 0.58, R = Math.min(wpx, hpx) * 0.42;
  const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22; // 起止角
  const va = (v) => a0 + ((v - min) / (max - min)) * (a1 - a0);
  // 弧
  ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.strokeStyle = C.baseline;
  ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  if (redFrom != null) {
    ctx.strokeStyle = C.bad;
    ctx.beginPath(); ctx.arc(cx, cy, R, va(redFrom), a1); ctx.stroke();
  }
  // 值弧
  ctx.strokeStyle = value > (redFrom ?? Infinity) ? C.bad : C.s[0];
  ctx.beginPath(); ctx.arc(cx, cy, R, a0, va(Math.min(Math.max(value, min), max))); ctx.stroke();
  // 刻度
  ctx.fillStyle = C.muted; ctx.font = '8.5px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const nTicks = 5;
  for (let i = 0; i <= nTicks; i++) {
    const v = min + ((max - min) * i) / nTicks;
    const a = va(v);
    ctx.fillText(fmt ? fmt(v) : String(Math.round(v)), cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
  }
  // 指针
  const a = va(Math.min(Math.max(value, min), max));
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
  // 数值 & 标签
  ctx.fillStyle = C.ink; ctx.font = '700 17px system-ui';
  ctx.fillText(fmt ? fmt(value) : String(Math.round(value)), cx, cy + R * 0.52);
  ctx.fillStyle = C.muted; ctx.font = '10px system-ui';
  ctx.fillText(`${label} ${unit}`, cx, cy + R * 0.78);
}
