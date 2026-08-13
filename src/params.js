// ============================================================
// 共享物理参数与动力学公式（所有模式复用，保证图表与 3D 一致）
// ============================================================

export const VEH = {
  mass: 1400,          // kg 整备质量
  wheelR: 0.31,        // m 车轮滚动半径
  finalDrive: 3.9,     // 主减速比（手动）
  finalDriveAT: 4.1,   // 主减速比（自动）
  eta: 0.92,           // 传动效率
  cdA: 0.66,           // 风阻系数×迎风面积 m²
  rho: 1.206,          // 空气密度 kg/m³
  fr: 0.013,           // 滚动阻力系数
  g: 9.81,
};

export const ENG = {
  idle: 800,
  redline: 6500,
  stall: 550,          // 低于该转速视为熄火
  inertia: 0.25,       // kg·m² 发动机+飞轮转动惯量
};

// ---- 变速箱齿数（用真实齿数推导速比，3D 齿轮与数值完全一致）----
// 常啮合输入副：输入轴齿轮 → 中间轴常啮合齿轮
export const GEARSET = {
  input: { zIn: 17, zCounter: 29 },                // i = 29/17 = 1.706
  pairs: [
    { name: '1挡', zC: 14, zO: 30 },               // 中间轴齿 → 输出轴齿
    { name: '2挡', zC: 19, zO: 24 },
    { name: '3挡', zC: 24, zO: 20 },
    { name: '4挡', direct: true },                  // 直接挡：输入轴与输出轴锁死
    { name: '5挡', zC: 30, zO: 14 },
  ],
  centerDist: 0.185,   // m 输入轴与中间轴中心距（决定各齿轮模数）
};

// 由齿数计算各挡速比
export const GEAR_RATIOS = GEARSET.pairs.map((p) => {
  if (p.direct) return 1.0;
  const iIn = GEARSET.input.zCounter / GEARSET.input.zIn;
  return iIn * (p.zO / p.zC);
});
// ≈ [3.656, 2.155, 1.422, 1.000, 0.796]

// ---- 自动挡（单排行星，太阳轮 Zs=24 齿圈 Zr=48）----
export const AT = {
  zSun: 24, zRing: 48, zPlanet: 12, nPlanets: 4,
  ratios: [3.0, 1.5, 1.0, 2 / 3],
  // 各挡执行元件: C1 输入→太阳轮, C2 输入→行星架, C3 输入→齿圈, B1 刹太阳轮, B2 刹齿圈
  elements: [
    { C1: 1, C2: 0, C3: 0, B1: 0, B2: 1 },
    { C1: 0, C2: 0, C3: 1, B1: 1, B2: 0 },
    { C1: 1, C2: 0, C3: 1, B1: 0, B2: 0 },
    { C1: 0, C2: 1, C3: 0, B1: 1, B2: 0 },
  ],
};

// ---- 发动机外特性：全油门扭矩曲线（N·m），二次拟合 ----
// T(1000)=110, T(3900)≈165 峰值, T(6500)=120
export function engineTorqueWOT(rpm) {
  const n = Math.min(Math.max(rpm, 500), ENG.redline);
  return 65.24 + 0.05137 * n - 6.606e-6 * n * n;
}
// 部分油门：扭矩近似与油门开度成比例，并叠加发动机制动（负扭矩）
export function engineTorque(rpm, throttle) {
  const wot = engineTorqueWOT(rpm);
  const brake = -(8 + rpm / 400); // 反拖阻力矩
  return brake + throttle * (wot - brake);
}
export function enginePowerKW(rpm) {
  return (engineTorqueWOT(rpm) * rpm * 2 * Math.PI) / 60 / 1000;
}

// ---- 行驶阻力（平路）----
export function resistForce(v /* m/s */) {
  return VEH.mass * VEH.g * VEH.fr + 0.5 * VEH.rho * VEH.cdA * v * v;
}

// ---- 单位换算 ----
export const KMH = 3.6;
export function rpmOfSpeed(v, ratio, finalDrive = VEH.finalDrive) {
  // 车速 (m/s) → 发动机转速 (rpm)
  return (v / VEH.wheelR) * ratio * finalDrive * (60 / (2 * Math.PI));
}
export function speedOfRpm(rpm, ratio, finalDrive = VEH.finalDrive) {
  return (rpm * 2 * Math.PI / 60) * VEH.wheelR / (ratio * finalDrive);
}
// 轮上驱动力
export function tractionForce(rpm, throttle, ratio, finalDrive = VEH.finalDrive) {
  return (engineTorque(rpm, throttle) * ratio * finalDrive * VEH.eta) / VEH.wheelR;
}

// ---- 液力变矩器特性 ----
// 速比 sr = 涡轮/泵轮。失速变矩比≈1.9，耦合点 sr≈0.85
export function converterTorqueRatio(sr) {
  const s = Math.min(Math.max(sr, 0), 1);
  return s < 0.85 ? 1.9 - (0.9 / 0.85) * s : 1.0;
}
export function converterEfficiency(sr) {
  const s = Math.min(Math.max(sr, 0), 1);
  return s < 0.85 ? converterTorqueRatio(s) * s : s;
}

// ---- TCU 换挡图（车速 km/h 关于油门开度 t∈[0,1] 的函数）----
export const SHIFT_MAP = {
  up: [
    (t) => 10 + 40 * Math.pow(t, 1.35),   // 1→2
    (t) => 22 + 68 * Math.pow(t, 1.35),   // 2→3
    (t) => 38 + 96 * Math.pow(t, 1.35),   // 3→4
  ],
  down: [
    (t) => 5 + 26 * Math.pow(t, 1.35),    // 2→1
    (t) => 13 + 46 * Math.pow(t, 1.35),   // 3→2
    (t) => 24 + 88 * Math.pow(t, 1.35),   // 4→3（深油门时上探到 ~112km/h，实现高速强制降挡）
  ],
};
