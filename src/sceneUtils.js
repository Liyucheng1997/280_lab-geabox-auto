// ============================================================
// 场景公共工具：标注、外框线、车轮/后桥、地面等
// ============================================================
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MAT } from './materials.js';
import { gearGeometry } from './gearFactory.js';

const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** 创建 CSS2D 中文标注并挂到 parent（offset 为局部坐标） */
export function makeLabel(parent, text, offset = [0, 0, 0]) {
  const div = document.createElement('div');
  div.className = 'lbl';
  div.textContent = text;
  const obj = new CSS2DObject(div);
  obj.position.set(...offset);
  parent.add(obj);
  obj.userData.el = div;
  return obj;
}

/** 半透明壳体加轮廓线 */
export function addEdges(mesh, threshold = 28) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, threshold);
  const line = new THREE.LineSegments(eg, MAT.housingEdge);
  mesh.add(line);
  return line;
}

/** 车轮（轮胎+轮辋+辐条），轴向沿 Z */
export function buildWheel(r = 0.31) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - 0.095, 0.095, 18, 40), MAT.rubber);
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.13, r - 0.13, 0.12, 28), MAT.alu);
  rim.geometry.rotateX(Math.PI / 2);
  g.add(rim);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, r - 0.14, 0.06), MAT.steelBright);
    sp.position.y = (r - 0.14) / 2;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 5) * Math.PI * 2;
    holder.add(sp);
    rim.add(holder);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 20), MAT.steelDark);
  hub.geometry.rotateX(Math.PI / 2);
  g.add(hub);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

/**
 * 后桥总成：差速器壳 + 主减速器锥齿轮 + 半轴 + 两个车轮。
 * 输入：传动轴末端 x 位置。返回 { group, crown, pinion, wheels, update(propAngle, wheelAngle) }
 */
export function buildRearAxle(x0, labelStore) {
  const g = new THREE.Group();
  g.position.x = x0;

  // 差速器壳（半透明）
  const housing = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 18), MAT.housing);
  addEdges(housing);
  g.add(housing);

  // 主动锥齿轮（与传动轴相连，轴向 X）
  const mPin = 0.0055;
  const pinion = new THREE.Mesh(gearGeometry(13, mPin, 0.06, { hole: 0.02 }), MAT.gearGold);
  pinion.position.set(-0.14, 0, 0);
  g.add(pinion);

  // 从动锥齿轮/盆齿（轴向 Z），齿数 51 → 主减速比 3.92
  const crownGeo = gearGeometry(51, mPin, 0.045, { hole: 0.05, lighten: 6, lightenR: 0.09 });
  const crown = new THREE.Mesh(crownGeo, MAT.gearGold);
  crown.rotation.y = Math.PI / 2; // 轴向 x → z
  crown.position.set(0, 0, -0.05);
  g.add(crown);

  // 半轴套管
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.48, 16), MAT.ironCast);
    tube.geometry.rotateX(Math.PI / 2);
    tube.position.set(0, 0, s * 0.38);
    g.add(tube);
  }

  // 车轮
  const wheels = [];
  for (const s of [-1, 1]) {
    const w = buildWheel();
    w.position.set(0, 0, s * 0.68);
    g.add(w);
    wheels.push(w);
  }

  if (labelStore) {
    labelStore.push(makeLabel(g, '主减速器 + 差速器（≈3.9:1）', [0, 0.3, 0]));
    labelStore.push(makeLabel(wheels[1], '车轮', [0, 0.42, 0]));
  }

  return {
    group: g, crown, pinion, wheels,
    update(propAngle, wheelAngle) {
      pinion.rotation.x = propAngle;
      // 盆齿几何轴向为 x：先转到 z 轴方向，再绕世界 z 随车轮旋转
      crown.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
      const spin = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, wheelAngle);
      crown.quaternion.premultiply(spin);
      for (const w of wheels) w.rotation.z = wheelAngle;
    },
  };
}

/** 展台地面 + 网格 */
export function buildGround(scene, y = -0.85, size = 14) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), MAT.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = y;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(size, size * 2, 0x2c2c2a, 0x232322);
  grid.position.y = y + 0.001;
  scene.add(grid);
}

/** 支撑架（V 型托架） */
export function buildStand(x, yTop, yGround = -0.85) {
  const g = new THREE.Group();
  const h = yTop - yGround;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), MAT.black);
  post.position.set(x, yGround + h / 2, 0);
  g.add(post);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.5), MAT.black);
  base.position.set(x, yGround + 0.02, 0);
  g.add(base);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.26), MAT.black);
  cradle.position.set(x, yTop, 0);
  g.add(cradle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** 平滑插值工具 */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const RPM2RAD = (2 * Math.PI) / 60;
