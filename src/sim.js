// ============================================================
// 仿真控制器：
//   WhySim     — 模式一：整车纵向动力学（自选挡位体验为什么要换挡）
//   ManualSeq  — 模式二：2挡→3挡 换挡全过程的确定性时间轴
//   AutoSim    — 模式三：液力变矩器 + TCU 换挡逻辑
// ============================================================
import {
  VEH, ENG, GEAR_RATIOS, engineTorque, resistForce, tractionForce,
  rpmOfSpeed, AT, SHIFT_MAP, converterTorqueRatio, KMH,
} from './params.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// 挡位 → 接合套/换挡杆位置
const SLEEVES = {
  0: { s34: 0, s12: 0, s5: 0, sel: 0, eng: 0 },
  1: { s34: 0, s12: 1, s5: 0, sel: -1, eng: -1 },
  2: { s34: 0, s12: -1, s5: 0, sel: -1, eng: 1 },
  3: { s34: 1, s12: 0, s5: 0, sel: 0, eng: -1 },
  4: { s34: -1, s12: 0, s5: 0, sel: 0, eng: 1 },
  5: { s34: 0, s12: 0, s5: -1, sel: 1, eng: -1 },
};

// ================= 模式一 =================
export class WhySim {
  constructor() { this.reset(); }
  reset() {
    this.v = 0; this.gear = 0; this.throttle = 0;
    this.engineRpm = ENG.idle;
    this.stalled = false; this.fuelCut = false;
    this.slipT = 0; this.lugging = false;
    this.shiftAnim = null; // {t, from, to}
    this.scene = { pedal: 0, ...SLEEVES[0] };
    this.msg = { text: '挂 1 挡、给油起步。留意右侧驱动力图中工作点沿曲线移动。', cls: '' };
  }
  requestGear(g) {
    if (g === this.gear) return;
    if (this.stalled && g !== 0) { this.msg = { text: '发动机已熄火——先点“重置”或回空挡 N。', cls: 'warn' }; return; }
    this.shiftAnim = { t: 0, from: this.gear, to: g, done: false };
    this.slipT = 0;
  }
  update(dt) {
    const th = this.stalled ? 0 : this.throttle;
    const R = resistForce(this.v);

    // 换挡动画（自动踩离合 0.7s）
    if (this.shiftAnim) {
      const a = this.shiftAnim;
      a.t += dt;
      if (!a.done && a.t >= 0.3) { this.gear = a.to; a.done = true; this.slipT = 0; }
      if (a.t >= 0.7) this.shiftAnim = null;
    }
    const shifting = !!this.shiftAnim;
    const pedalTarget = shifting ? Math.sin(clamp01(this.shiftAnim.t / 0.7) * Math.PI) : 0;

    let F = 0, inputRpm = 0;
    const ig = this.gear > 0 ? GEAR_RATIOS[this.gear - 1] : 0;

    if (this.stalled) {
      this.engineRpm = approach(this.engineRpm, 0, 3, dt);
      F = 0;
      inputRpm = this.gear > 0 ? rpmOfSpeed(this.v, ig) : this.engineRpm;
    } else if (this.gear === 0) {
      // 空挡自由转
      const T = engineTorque(this.engineRpm, th);
      this.engineRpm = clamp(this.engineRpm + (T / ENG.inertia) * (60 / (2 * Math.PI)) * dt * 0.55, 0, ENG.redline);
      if (this.engineRpm < ENG.idle && th < 0.05) this.engineRpm = approach(this.engineRpm, ENG.idle, 4, dt);
      inputRpm = this.engineRpm; // 空挡+离合接合：输入轴随发动机转
      this.fuelCut = false;
    } else {
      const ng = rpmOfSpeed(this.v, ig); // 齿轮决定的发动机转速
      if (ng >= ENG.idle * 0.98 || shifting) {
        // 刚性连接
        this.slipT = 0;
        this.engineRpm = approach(this.engineRpm, ng, 18, dt);
        this.fuelCut = this.engineRpm >= ENG.redline - 20;
        const effTh = this.fuelCut || shifting ? 0 : th;
        F = tractionForce(Math.max(ng, ENG.stall), effTh, ig);
        this.lugging = ng < ENG.idle * 0.95 && this.v > 1;
        if (ng < ENG.stall && this.v > 0.5) { this.stalled = true; }
      } else {
        // 起步滑摩（离合器容量随时间线性接合，1.6 秒后强制接合）
        this.slipT += dt;
        this.engineRpm = approach(this.engineRpm, ENG.idle + th * 1800, 6, dt);
        const cap = clamp01(this.slipT / 1.6);
        const Teng = Math.max(engineTorque(this.engineRpm, th), 0);
        const Tcl = Math.min(Teng, 260 * Math.max(cap, th * 0.3 + 0.1));
        F = (Tcl * ig * VEH.finalDrive * VEH.eta) / VEH.wheelR;
        if (this.slipT > 1.6) {
          // 离合器完全接合，转速被强拉到齿轮转速
          if (ng < ENG.stall) { this.stalled = true; }
          else this.engineRpm = ng;
        }
        this.fuelCut = false;
        this.lugging = false;
      }
      inputRpm = ng;
    }

    const a = (F - R * (this.v > 0.01 ? 1 : F > R ? 1 : 0)) / VEH.mass;
    this.v = Math.max(0, this.v + a * dt);

    // 场景状态过渡
    const sc = this.scene;
    const tgt = SLEEVES[this.gear];
    sc.pedal = approach(sc.pedal, pedalTarget, 12, dt);
    const rate = 10;
    // 换挡动画先回空挡再进新挡（由 pedal 峰值时 gear 已切换保证顺序感）
    sc.s34 = approach(sc.s34, tgt.s34, rate, dt);
    sc.s12 = approach(sc.s12, tgt.s12, rate, dt);
    sc.s5 = approach(sc.s5, tgt.s5, rate, dt);
    sc.sel = approach(sc.sel, tgt.sel, rate, dt);
    sc.eng = approach(sc.eng, tgt.eng, rate, dt);

    // 消息
    if (this.stalled) this.msg = { text: '💥 熄火了！挡位太高、车速太低——发动机被拖到 550 rpm 以下。点“重置”重来，起步请用 1 挡。', cls: 'warn' };
    else if (this.fuelCut) this.msg = { text: `⛔ ${this.gear} 挡已顶到红线 6500 rpm，断油保护中——这就是必须升挡的时刻！当前 ${(this.v * KMH).toFixed(0)} km/h。`, cls: 'warn' };
    else if (this.lugging) this.msg = { text: '⚠️ 发动机在怠速以下“拖磨”（lugging），扭矩极低且伤发动机——请降挡。', cls: 'warn' };
    else if (this.gear > 0 && this.slipT > 0 && this.slipT < 1.6 && this.v < 3) {
      const need = tractionForce(this.engineRpm, this.throttle, ig);
      this.msg = need < R + 50 && this.throttle > 0.1
        ? { text: `${this.gear} 挡起步：驱动力 ${need.toFixed(0)}N ≤ 阻力，车不动，离合器持续滑摩……即将熄火`, cls: 'warn' }
        : { text: `离合器滑摩起步中：发动机 ${this.engineRpm.toFixed(0)} rpm，车速侧 ${rpmOfSpeed(this.v, ig).toFixed(0)} rpm，转速差由摩擦片滑动吸收。`, cls: '' };
    }
    else if (this.gear > 0 && this.throttle > 0.05) {
      const room = ENG.redline - this.engineRpm;
      this.msg = room < 900
        ? { text: `${this.gear} 挡 ${this.engineRpm.toFixed(0)} rpm，接近红线，准备升挡。`, cls: '' }
        : { text: `${this.gear} 挡行驶中：${(this.v * KMH).toFixed(0)} km/h · ${this.engineRpm.toFixed(0)} rpm。升一挡转速将 ×${this.gear < 5 ? (GEAR_RATIOS[this.gear] / ig).toFixed(2) : '—'}。`, cls: '' };
    }
    return this.getState();
  }
  getState() {
    const ig = this.gear > 0 ? GEAR_RATIOS[this.gear - 1] : 1;
    const inputRpm = this.gear === 0 ? this.engineRpm * (1 - this.scene.pedal) : rpmOfSpeed(this.v, ig);
    const outputRpm = rpmOfSpeed(this.v, 1);
    const F = this.gear > 0 && !this.stalled
      ? tractionForce(Math.max(this.engineRpm, ENG.stall), this.fuelCut ? 0 : this.throttle, ig) : 0;
    return {
      engineRpm: this.engineRpm, inputRpm, outputRpm,
      v: this.v, gear: this.gear, F,
      pedal: this.scene.pedal,
      sleeve34: this.scene.s34, sleeve12: this.scene.s12, sleeve5: this.scene.s5,
      leverSel: this.scene.sel, leverEng: this.scene.eng,
      stalled: this.stalled, fuelCut: this.fuelCut,
    };
  }
}

// ================= 模式二：换挡时间轴 =================
// 输出轴转速系数：rpm/车速(m/s)
const KOUT = rpmOfSpeed(1, 1);            // ≈120.1 rpm / (m/s)
const I2 = GEAR_RATIOS[1], I3 = GEAR_RATIOS[2];
const G3F = 1 / I3;                        // 3挡齿轮转速 = 输入轴 × (17/29)(24/20) = 输入轴 / i3

export class ManualSeq {
  constructor() {
    // 每阶段: dur, 标题, 描述, 相机焦点, 高亮, 插值函数
    this.phases = [
      {
        dur: 2.0, name: '巡航', focus: 'whole', hl: [],
        title: '<b>2 挡稳定行驶</b> · 50 km/h · 3600 rpm',
        cap: '动力路径：发动机 → 飞轮 → 离合器 → <b>输入轴 → 中间轴 → 2挡齿轮副 → 接合套 → 输出轴</b> → 传动轴 → 后桥。注意：所有前进挡齿轮都常啮合空转，只有被接合套锁住的那对在传力。',
        f: (t, S) => { S.throttle = 0.45; S.vv = lerp(13.9, 13.9, t); },
      },
      {
        dur: 0.8, name: '松油门', focus: 'whole', hl: [],
        title: '<b>① 松油门</b>',
        cap: '抬起油门，卸掉传动系里的驱动扭矩——带着大扭矩硬拉离合器会使分离冲击很大。',
        f: (t, S) => { S.throttle = lerp(0.45, 0, smooth(t)); S.vv = lerp(13.9, 13.82, t); },
      },
      {
        dur: 0.9, name: '踩离合', focus: 'clutch', hl: ['bearing', 'diaphragm', 'pressurePlate', 'disc', 'releaseFork'],
        title: '<b>② 踩下离合器踏板</b>',
        cap: '分离拨叉推动<b>分离轴承</b>前移 → 顶动<b>膜片弹簧</b>指尖 → 弹簧绕支承环翻转，外缘把<b>压盘</b>向后拉起约 2mm → <b>从动盘</b>两侧腾空。发动机与变速箱之间的扭矩通道被切断，发动机转速开始自由回落。',
        f: (t, S) => {
          S.pedal = smooth(t); S.throttle = 0;
          S.vv = lerp(13.82, 13.66, t);
          S.eng = lerp(3578, 2600, smooth(t));
        },
      },
      {
        dur: 0.7, name: '摘挡', focus: 'gearbox', hl: ['fork12', 'syn12_sleeve', 'lever'],
        title: '<b>③ 摘出 2 挡（回空挡）</b>',
        cap: '换挡杆带动 <b>1/2挡拨叉</b>，把接合套推回中位。输出轴与 2 挡齿轮脱开——此刻变速箱空挡，输入轴系靠惯性继续旋转、缓慢减速。',
        f: (t, S) => {
          S.pedal = 1; S.s12 = lerp(-1, 0, smooth(t)); S.leverEng = lerp(1, 0, smooth(t)); S.leverSel = -1;
          S.vv = lerp(13.66, 13.54, t);
          S.eng = lerp(2600, 2050, t);
          S.inFree = lerp(3495, 3430, t); // 摘挡后输入轴自由减速
        },
      },
      {
        dur: 0.6, name: '选位', focus: 'lever', hl: ['lever'],
        title: '<b>④ 横向选位：移到 3/4 挡门</b>',
        cap: '换挡杆在空挡横槽中横移，从 1/2 挡门移到 3/4 挡门——这一步只是选择哪根拨叉轴，还没有碰任何齿轮。',
        f: (t, S) => {
          S.pedal = 1; S.leverSel = lerp(-1, 0, smooth(t)); S.leverEng = 0;
          S.vv = lerp(13.54, 13.44, t);
          S.eng = lerp(2050, 1600, t);
          S.inFree = lerp(3430, 3350, t);
        },
      },
      {
        dur: 1.2, name: '同步', focus: 'synchro', hl: ['fork34', 'syn34_sleeve', 'syn34_ring1'],
        title: '<b>⑤ 同步器工作（关键！）</b>',
        cap: '接合套前压，先推动<b>黄铜同步环</b>贴上 3 挡齿轮的锥面。锥面摩擦力矩把整个输入轴系从 ~3350 rpm <b>拖到与输出轴匹配的 ~2280 rpm</b>。转速没相等之前，同步环偏转半个齿距顶住接合套（锁止），想硬推也推不进去——看右侧图表中两条转速线正在合拢。',
        f: (t, S) => {
          S.pedal = 1; S.s34 = lerp(0, 0.55, smooth(t)); S.leverEng = lerp(0, -0.5, smooth(t));
          S.vv = lerp(13.44, 13.36, t);
          S.eng = lerp(1600, 1250, t);
          const target = S.vv * KOUT * I3;   // 同步目标（输入轴侧）
          S.inFree = lerp(3350, target, smooth(t));
        },
      },
      {
        dur: 0.5, name: '挂入', focus: 'synchro', hl: ['syn34_sleeve'],
        title: '<b>⑥ 挂入 3 挡</b>',
        cap: '转速相等的瞬间，锥面摩擦力矩消失，同步环回位让开——接合套滑过同步环齿、咬合 3 挡齿轮的<b>接合齿圈</b>，形成刚性连接。挡位挂入完成。',
        f: (t, S) => {
          S.pedal = 1; S.s34 = lerp(0.55, 1, smooth(t)); S.leverEng = lerp(-0.5, -1, smooth(t));
          S.vv = lerp(13.36, 13.30, t);
          S.eng = lerp(1250, 1150, t);
          S.inFree = S.vv * KOUT * I3;
        },
      },
      {
        dur: 1.3, name: '松离合', focus: 'clutch', hl: ['bearing', 'pressurePlate', 'disc'],
        title: '<b>⑦ 松离合 + 补油</b>',
        cap: '压盘重新压紧从动盘。此时发动机 ~1150 rpm、输入轴 ~2280 rpm，摩擦片短暂滑摩把发动机<b>拉升到 2280 rpm</b>同步（同时补一点油让衔接更顺）。动力恢复，换挡完成。',
        f: (t, S) => {
          S.pedal = lerp(1, 0, smooth(t)); S.throttle = t > 0.25 ? lerp(0, 0.45, smooth((t - 0.25) / 0.75)) : 0;
          S.vv = lerp(13.30, 13.34, t);
          S.inFree = S.vv * KOUT * I3;
          S.eng = lerp(1150, S.inFree, smooth(Math.min(t * 1.5, 1)));
        },
      },
      {
        dur: 2.0, name: '完成', focus: 'whole', hl: [],
        title: '<b>3 挡继续加速</b>',
        cap: '升挡后发动机从 3600 rpm 回落到 2280 rpm，重新处于扭矩带中段——用更低的转速维持同样车速，这就是升挡的意义。整个换挡约 4 秒，其中动力中断约 3 秒（这正是 AT/DCT 想消灭的）。',
        f: (t, S) => {
          S.throttle = 0.45;
          S.vv = lerp(13.34, 14.4, t);
          S.eng = S.vv * KOUT * I3;
          S.inFree = S.eng;
        },
      },
    ];
    this.total = this.phases.reduce((s, p) => s + p.dur, 0);
    this.rate = 0.6;
    this.playing = false;
    this.t = 0;
    this.history = [];
    this.lastHistT = -1;
  }
  phaseAt(t) {
    let acc = 0;
    for (let i = 0; i < this.phases.length; i++) {
      if (t < acc + this.phases[i].dur || i === this.phases.length - 1) {
        return { i, local: clamp01((t - acc) / this.phases[i].dur), t0: acc };
      }
      acc += this.phases[i].dur;
    }
  }
  jumpTo(i) {
    let acc = 0;
    for (let k = 0; k < i; k++) acc += this.phases[k].dur;
    this.t = acc + 0.0001;
    this.history = this.history.filter((h) => h.t < this.t);
    this.lastHistT = this.t - 1;
  }
  update(dt) {
    if (this.playing) {
      this.t += dt * this.rate;
      if (this.t >= this.total) { this.t = this.total - 0.0001; this.playing = false; }
    }
    return this.eval(this.t, dt);
  }
  eval(t, dt) {
    const { i, local } = this.phaseAt(t);
    const S = {
      throttle: 0, pedal: 0, s34: 0, s12: 0, s5: 0, leverSel: -1, leverEng: 1,
      vv: 13.9, eng: 3600, inFree: null,
    };
    // 从头依次执行到当前阶段，保证前序状态正确（各阶段函数均为确定性）
    for (let k = 0; k < i; k++) this.phases[k].f(1, S);
    this.phases[i].f(local, S);

    const outputRpm = S.vv * KOUT;
    // 输入轴转速：0-2阶段仍挂2挡 → 由车速决定；3+ 阶段用 inFree；8 阶段挂3挡
    let inputRpm;
    if (i <= 2) inputRpm = S.vv * KOUT * I2;
    else inputRpm = S.inFree ?? S.vv * KOUT * I3;
    const engineRpm = i <= 1 ? inputRpm : S.eng;

    // 同步图历史
    if (this.playing && t - this.lastHistT > 0.05) {
      this.lastHistT = t;
      this.history.push({ t, dog: inputRpm * G3F, sleeve: outputRpm });
      if (this.history.length > 400) this.history.shift();
    }

    const ph = this.phases[i];
    return {
      engineRpm, inputRpm, outputRpm,
      v: S.vv, gear: i <= 2 ? 2 : i >= 6 ? 3 : 0,
      pedal: S.pedal,
      sleeve34: S.s34, sleeve12: S.s12, sleeve5: S.s5,
      leverSel: S.leverSel, leverEng: S.leverEng,
      phase: i, local, focus: ph.focus, hl: ph.hl, title: ph.title, cap: ph.cap,
      throttle: S.throttle,
    };
  }
}

// ================= 模式三：自动挡 =================
export class AutoSim {
  constructor() { this.reset(); }
  reset() {
    this.v = 0; this.gear = 1; this.throttle = 0; this.brake = false;
    this.engineRpm = ENG.idle;
    this.shift = null; // {from, to, t, dur}
    this.cooldown = 0;
    this.kick = 0;
    this.msg = { text: '给油起步。观察换挡图上的工作点穿越换挡线。', cls: '' };
  }
  ratioOf(g) { return AT.ratios[g - 1]; }
  update(dt) {
    let th = this.throttle;
    if (this.kick > 0) { this.kick -= dt; th = 1; }
    const fd = VEH.finalDriveAT;

    // 换挡过程
    let ratio, blend = 0;
    if (this.shift) {
      this.shift.t += dt;
      blend = clamp01(this.shift.t / this.shift.dur);
      ratio = lerp(this.ratioOf(this.shift.from), this.ratioOf(this.shift.to), smooth(blend));
      if (blend >= 1) { this.gear = this.shift.to; this.shift = null; this.cooldown = 0.6; }
    } else {
      ratio = this.ratioOf(this.gear);
      this.cooldown = Math.max(0, this.cooldown - dt);
    }

    const turbine = rpmOfSpeed(this.v, ratio, fd);
    // 锁止：4挡 & >70km/h
    const lockTarget = (!this.shift && this.gear === 4 && this.v * KMH > 70) ? 1 : 0;
    this.lockup = approach(this.lockup ?? 0, lockTarget, 4, dt);

    // 发动机转速：涡轮转速 + 滑差（随耦合程度减小）
    const slip = (120 + th * 1750) * (1 - 0.72 * clamp01(turbine / 2900)) * (1 - this.lockup);
    const targetEng = clamp(turbine + slip, ENG.idle, ENG.redline);
    this.engineRpm = approach(this.engineRpm, targetEng, 7, dt);

    const sr = this.engineRpm > 60 ? clamp01(turbine / this.engineRpm) : 0;
    const K = this.lockup > 0.5 ? 1 : converterTorqueRatio(sr);
    let Tt = Math.max(engineTorque(this.engineRpm, th), th > 0.02 ? 0 : engineTorque(this.engineRpm, 0) * 0.35) * K;
    let F = (Tt * ratio * fd * VEH.eta) / VEH.wheelR;
    if (this.shift) F *= 0.5; // 换挡扭矩中断
    if (th < 0.03 && this.v < 2.5 && !this.brake) F = Math.max(F, 320); // 变矩器蠕动
    const R = resistForce(this.v) + (this.brake ? 4600 : 0);
    const a = (F - R * (this.v > 0.01 ? 1 : F > R ? 1 : 0)) / VEH.mass;
    this.v = Math.max(0, this.v + a * dt);

    // TCU 决策
    if (!this.shift && this.cooldown <= 0) {
      const vk = this.v * KMH;
      if (this.gear < 4 && vk > SHIFT_MAP.up[this.gear - 1](th)) {
        this.shift = { from: this.gear, to: this.gear + 1, t: 0, dur: 0.75 };
        this.msg = { text: `TCU：车速穿过 ${this.gear}→${this.gear + 1} 升挡线（油门 ${(th * 100).toFixed(0)}%），液压切换执行元件，升入 ${this.gear + 1} 挡。`, cls: 'good' };
      } else if (this.gear > 1 && vk < SHIFT_MAP.down[this.gear - 2](th)) {
        this.shift = { from: this.gear, to: this.gear - 1, t: 0, dur: 0.75 };
        this.msg = { text: th > 0.85
          ? `TCU：深踩油门使降挡线右移到当前车速之上——强制降挡（kickdown）到 ${this.gear - 1} 挡拉高转速获得大功率！`
          : `TCU：车速低于 ${this.gear}→${this.gear - 1} 降挡线，降入 ${this.gear - 1} 挡。`, cls: 'good' };
      }
    }

    this.turbineRpm = turbine;
    this.sr = sr;
    return this.getState();
  }
  kickdown() { this.kick = 2.2; }
  // 行星排各构件转速（主排 s1/c1/r1，OD排 s2/c2/r2）
  membersFor(gear, turbine) {
    let s1, c1, r1, s2, c2, r2;
    switch (gear) {
      case 1: s1 = turbine; r1 = 0; c1 = turbine / 3; break;
      case 2: r1 = turbine; s1 = 0; c1 = (turbine * 2) / 3; break;
      default: s1 = r1 = c1 = turbine;
    }
    if (gear === 4) { c2 = c1; s2 = 0; r2 = c1 * 1.5; }
    else { c2 = c1; s2 = c1; r2 = c1; }
    return { s1, c1, r1, s2, c2, r2 };
  }
  elementsFor(gear) {
    switch (gear) {
      case 1: return { C1: 1, C3: 0, B1: 0, B2: 1, Cod: 1, Bod: 0 };
      case 2: return { C1: 0, C3: 1, B1: 1, B2: 0, Cod: 1, Bod: 0 };
      case 3: return { C1: 1, C3: 1, B1: 0, B2: 0, Cod: 1, Bod: 0 };
      default: return { C1: 1, C3: 1, B1: 0, B2: 0, Cod: 0, Bod: 1 };
    }
  }
  getState() {
    const t = this.turbineRpm || 0;
    let members, elements, gearShown = this.gear;
    if (this.shift) {
      const b = smooth(clamp01(this.shift.t / this.shift.dur));
      const m0 = this.membersFor(this.shift.from, t), m1 = this.membersFor(this.shift.to, t);
      members = {};
      for (const k of Object.keys(m0)) members[k] = lerp(m0[k], m1[k], b);
      const e0 = this.elementsFor(this.shift.from), e1 = this.elementsFor(this.shift.to);
      elements = {};
      for (const k of Object.keys(e0)) elements[k] = lerp(e0[k], e1[k], b);
      gearShown = b < 0.5 ? this.shift.from : this.shift.to;
    } else {
      members = this.membersFor(this.gear, t);
      elements = this.elementsFor(this.gear);
    }
    return {
      engineRpm: this.engineRpm, turbineRpm: t, v: this.v,
      gear: gearShown, shifting: !!this.shift, sr: this.sr || 0,
      lockup: this.lockup || 0, members, elements,
      outputRpm: members.r2,
    };
  }
}
