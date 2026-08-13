// ============================================================
// 齿轮/轴类几何工厂 —— 程序化生成渐开线近似齿形，齿数与速比严格一致
// ============================================================
import * as THREE from 'three';

const geoCache = new Map();

/**
 * 生成直齿轮 2D 轮廓（渐开线近似：齿根圆弧 + 二次贝塞尔齿面 + 齿顶圆弧）
 * @param {number} z 齿数
 * @param {number} m 模数（世界单位）
 */
export function gearShape(z, m, { addendum = 1.0, dedendum = 1.2, tipRatio = 0.4, rootRatio = 0.62 } = {}) {
  const rPitch = (m * z) / 2;
  const rTip = rPitch + addendum * m;
  const rRoot = Math.max(rPitch - dedendum * m, rPitch * 0.5);
  const pitchAng = (2 * Math.PI) / z;       // 一个齿+一个槽
  const tipHalf = pitchAng * tipRatio * 0.5;  // 齿顶半角宽
  const rootHalf = pitchAng * rootRatio * 0.5; // 齿根槽半角宽

  const shape = new THREE.Shape();
  for (let i = 0; i < z; i++) {
    const a = i * pitchAng;             // 本齿中心角
    const g = a + pitchAng / 2;         // 齿槽中心角
    const ts = a - tipHalf, te = a + tipHalf;             // 齿顶弧
    const rs = a - (pitchAng / 2 - 0) + (pitchAng / 2 - rootHalf); // 齿根起点角 = a - rootHalf... 用对称式
    const rootStart = a - rootHalf - (pitchAng / 2 - rootHalf) * 0; // 左侧根部角
    const leftRoot = a - pitchAng / 2 + (pitchAng / 2 - rootHalf);  // = a - rootHalf
    const rightRoot = a + rootHalf;

    if (i === 0) shape.moveTo(Math.cos(a - pitchAng / 2) * rRoot, Math.sin(a - pitchAng / 2) * rRoot);
    // 左侧齿根圆弧 → 左齿面起点
    shape.absarc(0, 0, rRoot, a - pitchAng / 2, leftRoot, false);
    // 左齿面（贝塞尔外凸，近似渐开线）
    const midL = a - (tipHalf + rootHalf) * 0.42;
    shape.quadraticCurveTo(
      Math.cos(midL) * rPitch * 1.0, Math.sin(midL) * rPitch * 1.0,
      Math.cos(ts) * rTip, Math.sin(ts) * rTip
    );
    // 齿顶圆弧
    shape.absarc(0, 0, rTip, ts, te, false);
    // 右齿面
    const midR = a + (tipHalf + rootHalf) * 0.42;
    shape.quadraticCurveTo(
      Math.cos(midR) * rPitch, Math.sin(midR) * rPitch,
      Math.cos(rightRoot) * rRoot, Math.sin(rightRoot) * rRoot
    );
    // 右侧齿根圆弧至下一齿起点
    shape.absarc(0, 0, rRoot, rightRoot, a + pitchAng / 2, false);
  }
  shape.closePath();
  return shape;
}

/**
 * 直齿轮网格几何。孔径 hole，可带减重孔 lighten。
 */
export function gearGeometry(z, m, thickness, { hole = 0, lighten = 0, lightenR = 0, bevel = true } = {}) {
  const key = `g${z}_${m.toFixed(5)}_${thickness}_${hole}_${lighten}_${lightenR}`;
  if (geoCache.has(key)) return geoCache.get(key);

  const shape = gearShape(z, m);
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  if (lighten > 0 && lightenR > 0) {
    for (let i = 0; i < lighten; i++) {
      const a = (i / lighten) * Math.PI * 2 + Math.PI / lighten;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * lightenR, Math.sin(a) * lightenR, m * z * 0.075, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
  }
  const bv = bevel ? Math.min(0.12 * m, thickness * 0.16) : 0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - 2 * bv,
    bevelEnabled: bevel,
    bevelThickness: bv,
    bevelSize: bv * 0.9,
    bevelSegments: 1,
    curveSegments: Math.max(6, Math.round(140 / z)),
  });
  geo.translate(0, 0, -(thickness - 2 * bv) / 2);
  geo.rotateY(Math.PI / 2); // 挤出方向 z → x（轴向沿 x）
  geoCache.set(key, geo);
  return geo;
}

/**
 * 内齿圈：外圆环 + 内齿（孔轮廓为齿形）
 */
export function ringGearGeometry(z, m, thickness, { rimRatio = 1.18 } = {}) {
  const key = `r${z}_${m.toFixed(5)}_${thickness}_${rimRatio}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const rOuter = ((m * z) / 2 + m) * rimRatio;
  const outer = new THREE.Shape();
  outer.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  // 内齿：孔轮廓即外齿轮齿形（齿顶朝内的效果）
  const holeShape = gearShape(z, m, { addendum: 1.05, dedendum: 1.1, tipRatio: 0.42, rootRatio: 0.55 });
  const hole = new THREE.Path();
  hole.curves = holeShape.curves;
  outer.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(outer, {
    depth: thickness, bevelEnabled: false, curveSegments: Math.max(6, Math.round(160 / z)),
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateY(Math.PI / 2);
  geoCache.set(key, geo);
  return geo;
}

/** 花键小齿圈（接合齿/dog teeth）：细密三角齿 */
export function dogRingGeometry(rOut, thickness, teeth = 30, depthRatio = 0.13) {
  const key = `d${rOut}_${thickness}_${teeth}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const rIn = rOut * (1 - depthRatio);
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
    shape.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
    shape.lineTo(Math.cos(a2) * rOut, Math.sin(a2) * rOut);
  }
  shape.closePath();
  const h = new THREE.Path();
  h.absarc(0, 0, rIn * 0.55, 0, Math.PI * 2, true);
  shape.holes.push(h);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateY(Math.PI / 2);
  geoCache.set(key, geo);
  return geo;
}

/** 轴段（沿 X 轴的圆柱） */
export function shaftMesh(r, len, mat, segs = 28) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

/** 锥环（同步环等）：沿 X 轴 */
export function coneRingGeometry(r1, r2, rInner, len, segs = 36) {
  const pts = [
    new THREE.Vector2(rInner, -len / 2),
    new THREE.Vector2(r1, -len / 2),
    new THREE.Vector2(r2, len / 2),
    new THREE.Vector2(rInner, len / 2),
  ];
  const geo = new THREE.LatheGeometry(pts, segs);
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

/** 空心圆环截面套筒（Lathe 轮廓），沿 X 轴。profile: [[r,x],...] */
export function latheX(profile, segs = 40) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(Math.max(r, 1e-4), x));
  const geo = new THREE.LatheGeometry(pts, segs);
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

/**
 * 外啮合齿轮的初始相位：使 A 齿对准 B 槽。
 * B 轮相对 A 轮位于方位角 phi（从 A 中心看向 B 中心）。
 */
export function meshPhase(zDriven, phi = 0) {
  // 让 B 轮的一个齿槽中心正对方位角 phi+π（面向 A）
  const pitch = (2 * Math.PI) / zDriven;
  const facing = phi + Math.PI;
  // 槽中心位于 k*pitch + pitch/2
  const k = Math.round((facing - pitch / 2) / pitch);
  return facing - (k * pitch + pitch / 2);
}
