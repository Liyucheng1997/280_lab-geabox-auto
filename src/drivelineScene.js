// ============================================================
// 传动系剖视场景：直列四缸发动机 → 离合器 → 5 速手动变速箱 → 传动轴 → 后桥
// 模式一 / 模式二 共用。所有齿轮按 params.js 中的真实齿数生成。
// ============================================================
import * as THREE from 'three';
import { MAT, glowable } from './materials.js';
import { GEARSET } from './params.js';
import {
  gearGeometry, dogRingGeometry, shaftMesh, coneRingGeometry, latheX,
} from './gearFactory.js';
import {
  makeLabel, addEdges, buildRearAxle, buildStand, lerp, clamp01, RPM2RAD,
} from './sceneUtils.js';

// ---- 布局常量 ----
const A = GEARSET.centerDist;      // 输入轴-中间轴中心距
const Y_COUNTER = -A;              // 中间轴高度
const X = {
  crank0: -2.42, cylPitch: 0.28,
  flywheel: -1.288, disc: -1.244, plate: -1.211, coverBack: -1.135,
  fulcrum: -1.16, bearing: -1.115,
  inputGear: -0.80, syn34: -0.665, g3: -0.55, g2: -0.42, syn12: -0.305,
  g1: -0.19, g5: -0.05, syn5: 0.06,
  tailEnd: 0.62, uj1: 0.66, uj2: 1.66, axle: 1.78,
};
const CRANK_E = 0.09;   // 曲柄半径
const ROD_L = 0.28;     // 连杆长度
const PHASES = [0, Math.PI, Math.PI, 0];

// 齿轮副模数（中心距一致）
const mOf = (z1, z2) => (2 * A) / (z1 + z2);
const M_IN = mOf(17, 29), M_1 = mOf(14, 30), M_2 = mOf(19, 24), M_3 = mOf(24, 20), M_5 = mOf(30, 14);

// 外啮合相位：驱动轮转角 θ1、被动轮齿数 z2、中心连线方位 φ（从主动轮指向被动轮）
function drivenAngle(theta1, z1, z2, phi) {
  return (phi + Math.PI) + Math.PI / z2 - (theta1 - phi) * (z1 / z2);
}

export function buildDrivelineScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d);
  scene.fog = new THREE.Fog(0x0d0d0d, 9, 22);

  const root = new THREE.Group();
  scene.add(root);

  const labels = [];
  const housings = [];
  const parts = {};           // 可高亮部件
  const glowTargets = new Map();

  const registerGlow = (name, mesh) => {
    mesh.material = glowable(mesh.material);
    parts[name] = mesh;
    glowTargets.set(name, { mesh, k: 0, target: 0 });
  };

  // ============ 发动机 ============
  const engineG = new THREE.Group();
  root.add(engineG);

  // 缸体（半透明壳）
  const block = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.66, 0.32), MAT.housing);
  block.position.set(X.crank0 + 1.5 * X.cylPitch, 0.145, 0);
  addEdges(block);
  engineG.add(block);
  housings.push(block);
  labels.push(makeLabel(engineG, '发动机（直列四缸）', [X.crank0 + 0.42, 0.52, 0]));

  // 曲轴组（绕 x 旋转）
  const crank = new THREE.Group();
  engineG.add(crank);
  const journalGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.09, 18);
  journalGeo.rotateZ(Math.PI / 2);
  const webGeo = new THREE.CylinderGeometry(0.135, 0.135, 0.022, 24);
  webGeo.rotateZ(Math.PI / 2);
  const pinGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.07, 14);
  pinGeo.rotateZ(Math.PI / 2);
  const cwGeo = new THREE.BoxGeometry(0.02, 0.1, 0.16);

  const pins = [];
  for (let i = 0; i < 4; i++) {
    const xc = X.crank0 + i * X.cylPitch;
    const ph = PHASES[i];
    const dirY = Math.cos(ph), dirZ = Math.sin(ph);
    for (const s of [-1, 1]) {
      const web = new THREE.Mesh(webGeo, MAT.steelDark);
      web.position.set(xc + s * 0.05, 0, 0);
      crank.add(web);
      const cw = new THREE.Mesh(cwGeo, MAT.steelDark);
      cw.position.set(xc + s * 0.05, -dirY * 0.11, -dirZ * 0.11);
      crank.add(cw);
    }
    const pin = new THREE.Mesh(pinGeo, MAT.steelBright);
    pin.position.set(xc, dirY * CRANK_E, dirZ * CRANK_E);
    crank.add(pin);
    pins.push({ x: xc, phase: ph });
    if (i < 3) {
      const j = new THREE.Mesh(journalGeo, MAT.steel);
      j.position.set(xc + X.cylPitch / 2, 0, 0);
      crank.add(j);
    }
  }
  // 前端皮带轮 & 后端法兰
  const pulley = shaftMesh(0.09, 0.05, MAT.steelDark);
  pulley.position.x = X.crank0 - 0.13;
  crank.add(pulley);
  const nose = shaftMesh(0.045, 0.16, MAT.steel);
  nose.position.x = X.crank0 - 0.06;
  crank.add(nose);
  const flange = shaftMesh(0.05, 0.32, MAT.steel);
  flange.position.x = X.crank0 + 3 * X.cylPitch + 0.2;
  crank.add(flange);
  labels.push(makeLabel(engineG, '曲轴', [X.crank0 - 0.15, -0.22, 0]));

  // 活塞 + 连杆 + 缸套
  const pistons = [], rods = [];
  const pistonGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.1, 22);
  const rodGeo = new THREE.CylinderGeometry(0.018, 0.024, ROD_L, 10);
  const linerGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.34, 22, 1, true);
  const linerMat = MAT.housing.clone(); linerMat.opacity = 0.1;
  for (let i = 0; i < 4; i++) {
    const xc = X.crank0 + i * X.cylPitch;
    const piston = new THREE.Mesh(pistonGeo, MAT.alu);
    engineG.add(piston);
    pistons.push(piston);
    const rod = new THREE.Mesh(rodGeo, MAT.steel);
    engineG.add(rod);
    rods.push(rod);
    const liner = new THREE.Mesh(linerGeo, linerMat);
    liner.position.set(xc, 0.31, 0);
    engineG.add(liner);
  }
  labels.push(makeLabel(engineG, '活塞·连杆', [X.crank0 + 2 * X.cylPitch, 0.62, 0]));

  // ============ 离合器 ============
  const clutchG = new THREE.Group();
  root.add(clutchG);

  // 飞轮 + 起动齿圈
  const flywheelGrp = new THREE.Group();
  flywheelGrp.position.x = X.flywheel;
  clutchG.add(flywheelGrp);
  const flyDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.055, 48).rotateZ(Math.PI / 2), MAT.steel);
  flywheelGrp.add(flyDisc);
  const ringZ = 96, ringM = (2 * 0.345) / ringZ;
  const startRing = new THREE.Mesh(gearGeometry(ringZ, ringM, 0.03, { hole: 0.32, bevel: false }), MAT.steelDark);
  flywheelGrp.add(startRing);
  const frictionFace = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.004, 40).rotateZ(Math.PI / 2), MAT.steelBright);
  frictionFace.position.x = 0.028;
  flywheelGrp.add(frictionFace);
  registerGlow('flywheel', flyDisc);
  labels.push(makeLabel(clutchG, '飞轮 + 起动齿圈', [X.flywheel, 0.44, 0]));

  // 从动盘（摩擦片 + 减振弹簧 + 花键毂）
  const discGrp = new THREE.Group();
  discGrp.position.x = X.disc;
  clutchG.add(discGrp);
  const facing = new THREE.Mesh(latheX([[0.205, -0.014], [0.325, -0.014], [0.325, 0.014], [0.205, 0.014]]), MAT.friction);
  discGrp.add(facing);
  const discPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.01, 36).rotateZ(Math.PI / 2), MAT.steel);
  discGrp.add(discPlate);
  // 减振弹簧（切向布置）
  const sprGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.075, 10);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spr = new THREE.Mesh(sprGeo, MAT.spring);
    spr.position.set(0, Math.cos(a) * 0.125, Math.sin(a) * 0.125);
    spr.rotation.x = a; // 切向
    discGrp.add(spr);
  }
  const hub = new THREE.Mesh(dogRingGeometry(0.062, 0.055, 18, 0.22), MAT.steelDark);
  discGrp.add(hub);
  registerGlow('disc', facing);
  labels.push(makeLabel(clutchG, '从动盘（摩擦片）', [X.disc, -0.45, 0.1]));

  // 压盘
  const plateGrp = new THREE.Group();
  plateGrp.position.x = X.plate;
  clutchG.add(plateGrp);
  const pressPlate = new THREE.Mesh(latheX([[0.19, -0.017], [0.33, -0.017], [0.33, 0.017], [0.19, 0.017]]), MAT.ironCast);
  plateGrp.add(pressPlate);
  registerGlow('pressurePlate', pressPlate);
  labels.push(makeLabel(clutchG, '压盘', [X.plate, 0.42, -0.12]));

  // 离合器盖（外圈带 + 辐条）
  const coverGrp = new THREE.Group();
  clutchG.add(coverGrp);
  const band = new THREE.Mesh(latheX([[0.345, -0.05], [0.36, -0.05], [0.36, 0.05], [0.345, 0.05]]), MAT.steelDark);
  band.position.x = -1.185;
  coverGrp.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.05), MAT.steelDark);
    const hold = new THREE.Group();
    hold.rotation.x = a;
    spoke.position.set(X.coverBack, 0.245, 0);
    hold.add(spoke);
    coverGrp.add(hold);
  }
  // 支承环（膜片弹簧支点）
  const fulcrumRing = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.007, 8, 40).rotateY(Math.PI / 2), MAT.steelBright);
  fulcrumRing.position.x = X.fulcrum;
  coverGrp.add(fulcrumRing);

  // 膜片弹簧（18 指）
  const diaphragmGrp = new THREE.Group();
  clutchG.add(diaphragmGrp);
  const fingerPivots = [];
  const fingerGeo = new THREE.BoxGeometry(0.006, 0.205, 0.036);
  const fingerMat = glowable(MAT.spring);
  for (let i = 0; i < 18; i++) {
    const hold = new THREE.Group();
    hold.rotation.x = (i / 18) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(X.fulcrum, 0.21, 0);
    const f = new THREE.Mesh(fingerGeo, fingerMat);
    f.position.y = -0.0125;
    pivot.add(f);
    hold.add(pivot);
    diaphragmGrp.add(hold);
    fingerPivots.push(pivot);
  }
  parts.diaphragm = { material: fingerMat };
  glowTargets.set('diaphragm', { mesh: { material: fingerMat }, k: 0, target: 0 });
  labels.push(makeLabel(clutchG, '膜片弹簧', [X.fulcrum + 0.02, -0.4, -0.14]));

  // 分离轴承 + 拨叉
  const bearingGrp = new THREE.Group();
  bearingGrp.position.x = X.bearing;
  clutchG.add(bearingGrp);
  const bearing = new THREE.Mesh(latheX([[0.055, -0.03], [0.095, -0.03], [0.095, 0.03], [0.055, 0.03]]), MAT.steelBright);
  bearingGrp.add(bearing);
  registerGlow('bearing', bearing);
  const forkArm = new THREE.Group();
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.34), MAT.fork);
  armMesh.position.set(0.045, -0.02, 0.2);
  forkArm.add(armMesh);
  const armBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), MAT.steelDark);
  armBall.position.set(0.045, -0.02, 0.38);
  forkArm.add(armBall);
  bearingGrp.add(forkArm);
  registerGlow('releaseFork', armMesh);
  labels.push(makeLabel(clutchG, '分离轴承', [X.bearing, 0.3, 0.05]));

  // 离合器壳（钟形）
  const bell = new THREE.Mesh(latheX([[0.47, -1.42], [0.47, -1.32], [0.28, -0.98], [0.28, -0.95]], 48), MAT.housing);
  addEdges(bell, 40);
  clutchG.add(bell);
  housings.push(bell);

  // ============ 变速箱 ============
  const boxG = new THREE.Group();
  root.add(boxG);

  // 输入轴
  const inputGrp = new THREE.Group();
  boxG.add(inputGrp);
  const inShaft = shaftMesh(0.03, 0.52, MAT.steel);
  inShaft.position.x = -1.02;
  inputGrp.add(inShaft);
  const inputGear = new THREE.Mesh(
    gearGeometry(17, M_IN, 0.05, { hole: 0.03 }), MAT.gearBlue);
  inputGear.position.x = X.inputGear;
  inputGrp.add(inputGear);
  // 4 挡接合齿（输入轴齿轮背面）
  const dogIn = new THREE.Mesh(dogRingGeometry(0.075, 0.018, 24), MAT.steelBright);
  dogIn.position.x = X.inputGear + 0.036;
  inputGrp.add(dogIn);
  registerGlow('inputShaft', inShaft);
  labels.push(makeLabel(boxG, '输入轴', [-1.02, 0.24, 0]));
  labels.push(makeLabel(boxG, '常啮合齿轮副', [X.inputGear, -0.02 + 0.22, 0]));

  // 中间轴（一体齿轮簇）
  const counterGrp = new THREE.Group();
  counterGrp.position.y = Y_COUNTER;
  boxG.add(counterGrp);
  const cShaft = shaftMesh(0.04, 0.95, MAT.steelDark);
  cShaft.position.x = -0.44;
  counterGrp.add(cShaft);
  const counterDefs = [
    { z: 29, m: M_IN, x: X.inputGear, w: 0.05 },
    { z: 24, m: M_3, x: X.g3, w: 0.045 },
    { z: 19, m: M_2, x: X.g2, w: 0.045 },
    { z: 14, m: M_1, x: X.g1, w: 0.05 },
    { z: 30, m: M_5, x: X.g5, w: 0.04 },
  ];
  const counterGears = counterDefs.map((d) => {
    const gm = new THREE.Mesh(gearGeometry(d.z, d.m, d.w, { hole: 0.04 }), MAT.gear);
    gm.position.x = d.x;
    counterGrp.add(gm);
    return gm;
  });
  registerGlow('counterShaft', cShaft);
  labels.push(makeLabel(boxG, '中间轴（齿轮簇）', [-0.44, Y_COUNTER - 0.2, 0]));

  // 输出轴 + 空套挡位齿轮 + 同步器
  const outputGrp = new THREE.Group();
  boxG.add(outputGrp);
  const outShaft = shaftMesh(0.033, 1.06, MAT.steel);
  outShaft.position.x = -0.23;
  outputGrp.add(outShaft);
  const tailShaft = shaftMesh(0.028, 0.34, MAT.steel);
  tailShaft.position.x = 0.47;
  outputGrp.add(tailShaft);
  registerGlow('outputShaft', outShaft);
  labels.push(makeLabel(boxG, '输出轴', [0.24, 0.2, 0]));

  // 空套齿轮（不随输出轴转，由中间轴常啮合驱动）
  const idleDefs = [
    { key: 'g3', z: 20, zc: 24, m: M_3, x: X.g3, dogSide: -1, lbl: '3挡齿轮' },
    { key: 'g2', z: 24, zc: 19, m: M_2, x: X.g2, dogSide: 1, lbl: '2挡齿轮' },
    { key: 'g1', z: 30, zc: 14, m: M_1, x: X.g1, dogSide: -1, lbl: '1挡齿轮' },
    { key: 'g5', z: 14, zc: 30, m: M_5, x: X.g5, dogSide: 1, lbl: '5挡齿轮' },
  ];
  const idleGears = {};
  for (const d of idleDefs) {
    const grp = new THREE.Group();
    grp.position.x = d.x;
    const gm = new THREE.Mesh(gearGeometry(d.z, d.m, 0.045, {
      hole: 0.036, lighten: d.z > 22 ? 5 : 0, lightenR: d.z * d.m * 0.31,
    }), MAT.gear);
    grp.add(gm);
    // 接合齿圈 + 同步锥面
    const dog = new THREE.Mesh(dogRingGeometry(0.075, 0.016, 24), MAT.steelBright);
    dog.position.x = d.dogSide * 0.032;
    grp.add(dog);
    const cone = new THREE.Mesh(coneRingGeometry(0.068, 0.056, 0.04, 0.014), MAT.steel);
    cone.position.x = d.dogSide * 0.048;
    if (d.dogSide < 0) cone.rotation.z = Math.PI;
    grp.add(cone);
    outputGrp.add(grp);
    idleGears[d.key] = { grp, def: d };
    labels.push(makeLabel(boxG, d.lbl, [d.x, 0.16, 0.1]));
  }

  // 同步器总成（毂 + 接合套 + 黄铜同步环）
  function buildSynchro(x, name) {
    const asm = new THREE.Group();
    asm.position.x = x;
    const hubMesh = new THREE.Mesh(dogRingGeometry(0.082, 0.046, 30, 0.1), MAT.hub);
    asm.add(hubMesh);
    const sleeveGrp = new THREE.Group();
    const sleeve = new THREE.Mesh(latheX([
      [0.084, -0.026], [0.104, -0.026], [0.104, -0.009], [0.096, -0.009],
      [0.096, 0.009], [0.104, 0.009], [0.104, 0.026], [0.084, 0.026],
    ]), MAT.sleeve);
    sleeveGrp.add(sleeve);
    asm.add(sleeveGrp);
    // 两侧黄铜同步环
    const rings = [];
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(coneRingGeometry(0.058, 0.07, 0.05, 0.013), MAT.brass);
      if (s > 0) r.rotation.z = Math.PI;
      r.position.x = s * 0.062;
      asm.add(r);
      rings.push(r);
    }
    outputGrp.add(asm);
    registerGlow(name + '_sleeve', sleeve);
    const rr = rings.map((r, i) => {
      r.material = glowable(r.material);
      glowTargets.set(name + '_ring' + i, { mesh: r, k: 0, target: 0 });
      return r;
    });
    return { asm, sleeveGrp, rings: rr, x0: x };
  }
  const syn34 = buildSynchro(X.syn34, 'syn34');
  const syn12 = buildSynchro(X.syn12, 'syn12');
  const syn5 = buildSynchro(X.syn5, 'syn5');
  labels.push(makeLabel(boxG, '同步器 3/4挡（接合套）', [X.syn34, -0.28, 0.12]));
  labels.push(makeLabel(boxG, '同步器 1/2挡', [X.syn12, 0.22, -0.1]));
  labels.push(makeLabel(boxG, '同步器 5挡', [X.syn5, 0.2, 0.1]));

  // 换挡拨叉 + 导轨
  const railY = 0.185;
  const forkDefs = [
    { syn: syn34, z: 0.0, name: 'fork34' },
    { syn: syn12, z: 0.075, name: 'fork12' },
    { syn: syn5, z: -0.075, name: 'fork5' },
  ];
  const forks = [];
  for (const fd of forkDefs) {
    const rail = shaftMesh(0.012, 1.0, MAT.steelDark, 12);
    rail.position.set(-0.35, railY, fd.z);
    boxG.add(rail);
    const forkGrp = new THREE.Group();
    forkGrp.position.set(fd.syn.x0, 0, 0);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.108, 0.011, 8, 24, Math.PI * 1.15).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.075),
      MAT.fork);
    forkGrp.add(arc);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, railY - 0.09, 0.028), MAT.fork);
    arm.position.set(0, 0.09 + (railY - 0.09) / 2, fd.z * 0.55);
    arm.rotation.x = -Math.atan2(fd.z * 0.9, railY) * 0.5;
    forkGrp.add(arm);
    const collar = new THREE.Mesh(latheX([[0.014, -0.02], [0.026, -0.02], [0.026, 0.02], [0.014, 0.02]], 14), MAT.fork);
    collar.position.set(0, railY, fd.z);
    forkGrp.add(collar);
    boxG.add(forkGrp);
    registerGlow(fd.name, arc);
    forks.push({ grp: forkGrp, syn: fd.syn });
  }
  labels.push(makeLabel(boxG, '换挡拨叉 + 导轨', [-0.665, railY + 0.12, 0]));

  // 换挡杆
  const leverGrp = new THREE.Group();
  leverGrp.position.set(0.12, 0.3, 0);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.46, 12), MAT.steelDark);
  stick.position.y = 0.23;
  leverGrp.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 18, 14), MAT.black);
  knob.position.y = 0.47;
  leverGrp.add(knob);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), MAT.steelBright);
  leverGrp.add(ball);
  const lowerEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 10), MAT.steelDark);
  lowerEnd.position.y = -0.06;
  leverGrp.add(lowerEnd);
  boxG.add(leverGrp);
  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 16), MAT.ironCast);
  towerBase.position.set(0.12, 0.28, 0);
  boxG.add(towerBase);
  registerGlow('lever', stick);
  labels.push(makeLabel(boxG, '换挡杆', [0.12, 0.82, 0]));

  // 选换挡连杆（换挡杆 → 拨叉轴，简化示意）
  const linkRod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 8), MAT.steelDark);
  boxG.add(linkRod);

  // 变速箱壳体
  const caseBox = new THREE.Mesh(new THREE.BoxGeometry(1.31, 0.62, 0.44), MAT.housing);
  caseBox.position.set(-0.295, -0.1, 0);
  addEdges(caseBox);
  boxG.add(caseBox);
  housings.push(caseBox);
  const tailHouse = new THREE.Mesh(latheX([[0.16, 0.36], [0.16, 0.42], [0.07, 0.6], [0.07, 0.64]], 32), MAT.housing);
  addEdges(tailHouse, 40);
  boxG.add(tailHouse);
  housings.push(tailHouse);
  labels.push(makeLabel(boxG, '变速箱壳体', [-0.3, -0.48, 0.2]));

  // ============ 传动轴 + 后桥 ============
  const propGrp = new THREE.Group();
  root.add(propGrp);
  const propTube = shaftMesh(0.05, 0.88, MAT.steel);
  propTube.position.x = (X.uj1 + X.uj2) / 2;
  propGrp.add(propTube);
  // 万向节（十字轴 + 叉）
  for (const xu of [X.uj1, X.uj2]) {
    const crossY = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10), MAT.steelBright);
    crossY.position.x = xu;
    propGrp.add(crossY);
    const crossZ = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10).rotateX(Math.PI / 2), MAT.steelBright);
    crossZ.position.x = xu;
    propGrp.add(crossZ);
    // 前后两个叉：各由两条抱住十字轴销的臂组成
    for (const s of [-1, 1]) {
      for (const d of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.024), MAT.steelDark);
        if (s < 0) arm.position.set(xu - 0.028, 0, d * 0.062); // 前叉抱 z 向销
        else arm.position.set(xu + 0.028, d * 0.062, 0);       // 后叉抱 y 向销
        propGrp.add(arm);
      }
      const collar = shaftMesh(0.032, 0.03, MAT.steelDark, 14);
      collar.position.x = xu + s * 0.055;
      propGrp.add(collar);
    }
  }
  labels.push(makeLabel(propGrp, '传动轴', [1.15, 0.18, 0]));
  labels.push(makeLabel(propGrp, '万向节', [X.uj1, -0.2, 0]));

  const axle = buildRearAxle(X.axle, labels);
  root.add(axle.group);

  // ============ 支架 ============
  root.add(buildStand(-2.25, -0.2));
  root.add(buildStand(-1.55, -0.2));
  root.add(buildStand(-1.12, -0.45));
  root.add(buildStand(0.08, -0.44));
  root.add(buildStand(X.axle, -0.22));

  // 阴影
  root.traverse((o) => { if (o.isMesh && o.material !== MAT.housing) o.castShadow = true; });

  // ============ 状态与更新 ============
  const S = {
    thetaE: 0, thetaI: 0, thetaO: 0,
  };

  function setGlowTarget(names) {
    for (const [k, v] of glowTargets) v.target = names.includes(k) ? 0.85 : 0;
  }

  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  function update(st, dt) {
    const spin = st.spin !== false;
    if (spin) {
      S.thetaE += (st.engineRpm || 0) * RPM2RAD * dt;
      S.thetaI += (st.inputRpm || 0) * RPM2RAD * dt;
      S.thetaO += (st.outputRpm || 0) * RPM2RAD * dt;
    }
    const p = clamp01(st.pedal || 0);

    // --- 发动机 ---
    crank.rotation.x = S.thetaE;
    for (let i = 0; i < 4; i++) {
      const a = S.thetaE + PHASES[i];
      const py = CRANK_E * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - CRANK_E * CRANK_E * Math.sin(a) ** 2);
      const xc = pins[i].x;
      pistons[i].position.set(xc, py + 0.04, 0);
      // 连杆两端：曲柄销 → 活塞销
      _v1.set(xc, CRANK_E * Math.cos(a), CRANK_E * Math.sin(a));
      _v2.set(xc, py, 0);
      rods[i].position.copy(_v1).add(_v2).multiplyScalar(0.5);
      _v2.sub(_v1).normalize();
      rods[i].quaternion.setFromUnitVectors(_up, _v2);
    }

    // --- 离合器 ---
    flywheelGrp.rotation.x = S.thetaE;
    coverGrp.rotation.x = S.thetaE;
    diaphragmGrp.rotation.x = S.thetaE;
    plateGrp.rotation.x = S.thetaE;
    plateGrp.position.x = X.plate + 0.02 * p;
    discGrp.rotation.x = S.thetaI;
    discGrp.position.x = X.disc + 0.007 * p;
    const tilt = 0.22 - 0.4 * p;
    for (const piv of fingerPivots) piv.rotation.z = tilt;
    bearingGrp.position.x = X.bearing - 0.042 * p;

    // --- 变速箱 ---
    inputGrp.rotation.x = S.thetaI;
    const thetaC = drivenAngle(S.thetaI, 17, 29, -Math.PI / 2);
    counterGrp.rotation.x = thetaC;
    for (const key of ['g3', 'g2', 'g1', 'g5']) {
      const { grp, def } = idleGears[key];
      grp.rotation.x = drivenAngle(thetaC, def.zc, def.z, Math.PI / 2);
    }
    outputGrp.rotation.x = S.thetaO;
    // 同步器毂/套随输出轴转，但接合套的轴向滑移单独控制
    for (const [syn, val, span] of [
      [syn34, st.sleeve34 || 0, 0.043],
      [syn12, st.sleeve12 || 0, 0.043],
      [syn5, st.sleeve5 || 0, 0.043],
    ]) {
      syn.sleeveGrp.position.x = val * span;
      // 同步环被推向齿轮锥面
      const push = Math.abs(val);
      const side = val > 0 ? 1 : 0;
      syn.rings[side].position.x = (side ? 1 : -1) * (0.062 + 0.006 * Math.min(push * 2, 1));
    }
    for (const f of forks) f.grp.position.x = f.syn.x0 + f.syn.sleeveGrp.position.x;

    // 换挡杆姿态（sel: 左右选位 -1/0/1，eng: 前后挂挡 -1..1）
    leverGrp.rotation.z = -(st.leverEng || 0) * 0.3;
    leverGrp.rotation.x = (st.leverSel || 0) * 0.22;
    // 连杆：换挡杆下端 → 3/4 拨叉附近（示意）
    leverGrp.updateMatrixWorld();
    _v1.set(0, -0.11, 0).applyMatrix4(leverGrp.matrixWorld);
    root.worldToLocal(_v1);
    _v2.set(-0.4, railY, 0); // 拨叉导轨末端附近
    linkRod.position.copy(_v1).add(_v2).multiplyScalar(0.5);
    const d = _v2.clone().sub(_v1);
    linkRod.scale.y = d.length();
    linkRod.quaternion.setFromUnitVectors(_up, d.normalize());

    // --- 传动轴 / 后桥 ---
    propGrp.rotation.x = S.thetaO;
    axle.update(S.thetaO, S.thetaO * (13 / 51));

    // --- 高亮过渡 ---
    for (const [, v] of glowTargets) {
      v.k = lerp(v.k, v.target, Math.min(1, dt * 8));
      const m = v.mesh.material;
      if (m && m.emissive !== undefined) m.emissiveIntensity = v.k;
    }
  }

  function setHousingVisible(vis) {
    for (const h of housings) h.visible = vis;
  }
  function setLabelsVisible(vis) {
    for (const l of labels) l.userData.el.style.display = vis ? '' : 'none';
  }

  // 相机预设
  const CAMS = {
    whole: { pos: [0.6, 2.0, 4.9], tgt: [-0.1, -0.15, 0] },
    engine: { pos: [-2.9, 1.15, 2.1], tgt: [-2.0, 0.1, 0] },
    clutch: { pos: [-0.62, 0.5, 1.35], tgt: [-1.17, -0.02, 0] },
    gearbox: { pos: [-0.15, 0.72, 1.75], tgt: [-0.42, -0.1, 0] },
    synchro: { pos: [-0.45, 0.35, 0.95], tgt: [-0.62, -0.02, 0] },
    lever: { pos: [0.75, 0.9, 1.25], tgt: [0.1, 0.3, 0] },
    axle: { pos: [1.1, 0.85, 2.3], tgt: [1.65, -0.05, 0] },
  };

  return { scene, root, update, setGlowTarget, setHousingVisible, setLabelsVisible, CAMS, parts };
}
