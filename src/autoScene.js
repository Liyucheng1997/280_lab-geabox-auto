// ============================================================
// 自动变速箱场景：液力变矩器 → 离合器组 → 主行星排 + OD 超速排 → 输出
// 速比与 params.js 的 AT 配置严格一致（Zs=24, Zr=48 → 3.0/1.5/1.0/0.667）
// ============================================================
import * as THREE from 'three';
import { MAT, glowable } from './materials.js';
import { AT } from './params.js';
import { gearGeometry, ringGearGeometry, shaftMesh, latheX } from './gearFactory.js';
import { makeLabel, addEdges, buildRearAxle, buildStand, lerp, clamp01, RPM2RAD } from './sceneUtils.js';

function drivenAngle(theta1, z1, z2, phi) {
  return (phi + Math.PI) + Math.PI / z2 - (theta1 - phi) * (z1 / z2);
}

// ---------- 行星排 ----------
function buildPlanetary({ x, m, zs, zr, zp, n, width, labelPrefix, labels, parent }) {
  const g = new THREE.Group();
  g.position.x = x;
  parent.add(g);

  const rc = (m * (zs + zp)) / 2; // 行星轮公转半径

  const sun = new THREE.Mesh(gearGeometry(zs, m, width, { hole: 0.024 }), MAT.gearGold);
  g.add(sun);

  const ring = new THREE.Mesh(ringGearGeometry(zr, m, width * 0.94), MAT.gearBlue);
  g.add(ring);

  const carrier = new THREE.Group();
  g.add(carrier);
  // 行星架：中心毂环 + 通向各行星轮销的辐条臂（开放式，不遮挡视线）
  const hubRingGeo = latheX([[0.028, -0.008], [0.055, -0.008], [0.055, 0.008], [0.028, 0.008]], 24);
  const armGeo = new THREE.BoxGeometry(0.014, rc, 0.03);
  for (const s of [-1, 1]) {
    const hubRing = new THREE.Mesh(hubRingGeo, MAT.hub);
    hubRing.position.x = s * (width / 2 + 0.012);
    carrier.add(hubRing);
    for (let k = 0; k < n; k++) {
      const psi = (k / n) * Math.PI * 2;
      const arm = new THREE.Mesh(armGeo, MAT.hub);
      arm.position.set(s * (width / 2 + 0.012), Math.cos(psi) * rc * 0.5, Math.sin(psi) * rc * 0.5);
      arm.rotation.x = psi;
      carrier.add(arm);
    }
  }
  const planets = [];
  for (let k = 0; k < n; k++) {
    const psi = (k / n) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.position.set(0, Math.cos(psi) * rc, Math.sin(psi) * rc);
    const pg = new THREE.Mesh(gearGeometry(zp, m, width * 0.9, { hole: 0.012 }), MAT.gear);
    holder.add(pg);
    const pin = shaftMesh(0.011, width + 0.05, MAT.steelBright, 10);
    holder.add(pin);
    carrier.add(holder);
    planets.push({ holder, mesh: pg, psi0: psi });
  }

  if (labels) {
    labels.push(makeLabel(g, `${labelPrefix}·太阳轮`, [0, -0.06, zs * m * 0.5 + 0.03]));
    labels.push(makeLabel(g, `${labelPrefix}·齿圈(内齿)`, [0, zr * m * 0.62, 0]));
    labels.push(makeLabel(g, `${labelPrefix}·行星架`, [width / 2 + 0.02, -rc - 0.05, 0]));
  }

  function setAngles(ts, tc, tr) {
    sun.rotation.x = ts;
    ring.rotation.x = tr;
    carrier.rotation.x = tc;
    // 行星轮自转（相对行星架，与太阳轮外啮合）
    const tsRel = ts - tc;
    for (const p of planets) {
      const rel = drivenAngle(tsRel, zs, zp, p.psi0);
      p.mesh.rotation.x = rel;
    }
  }
  return { group: g, sun, ring, carrier, setAngles, rc };
}

// ---------- 多片离合器 ----------
function buildClutchPack({ x, rIn, rOut, parent, name, labels, labelText, labelOff }) {
  const g = new THREE.Group();
  g.position.x = x;
  parent.add(g);
  const drum = new THREE.Mesh(latheX([
    [rIn - 0.01, -0.055], [rOut + 0.018, -0.055], [rOut + 0.018, 0.05], [rOut + 0.008, 0.05],
    [rOut + 0.008, -0.045], [rIn - 0.01, -0.045],
  ], 32), glowable(MAT.steelDark));
  g.add(drum);
  const discs = [];
  const discGeoS = latheX([[rIn, -0.0035], [rOut, -0.0035], [rOut, 0.0035], [rIn, 0.0035]], 32);
  const matS = glowable(MAT.steelBright), matF = glowable(MAT.friction);
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(discGeoS, i % 2 ? matF : matS);
    g.add(d);
    discs.push(d);
  }
  if (labels && labelText) labels.push(makeLabel(g, labelText, labelOff || [0, rOut + 0.07, 0]));
  let engage = 0;
  function setEngage(k) {
    engage = k;
    const spread = lerp(0.016, 0.0085, k);
    discs.forEach((d, i) => { d.position.x = (i - 3) * spread; });
    const glow = k * 0.9;
    matS.emissiveIntensity = glow * 0.5;
    matF.emissiveIntensity = glow;
    drum.material.emissiveIntensity = glow * 0.35;
  }
  setEngage(0);
  return { group: g, setEngage, spin: (a) => { g.rotation.x = a; }, get engage() { return engage; } };
}

// ---------- 制动带 ----------
function buildBand({ x, r, parent, labels, labelText }) {
  const mat = glowable(MAT.red);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 10, 48, Math.PI * 1.72).rotateY(Math.PI / 2).rotateX(Math.PI * 0.64), mat);
  band.position.x = x;
  parent.add(band);
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), MAT.steelDark);
  anchor.position.set(x, r + 0.03, 0);
  parent.add(anchor);
  if (labels && labelText) labels.push(makeLabel(parent, labelText, [x, -(r + 0.09), 0]));
  function setEngage(k) {
    mat.emissiveIntensity = k * 0.9;
    band.scale.setScalar(lerp(1.03, 0.995, k));
  }
  setEngage(0);
  return { setEngage };
}

export function buildAutoScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d);
  scene.fog = new THREE.Fog(0x0d0d0d, 9, 22);
  const root = new THREE.Group();
  scene.add(root);
  const labels = [];
  const housings = [];

  // ============ 发动机端 ============
  const engineStub = new THREE.Mesh(latheX([[0.02, -1.95], [0.3, -1.95], [0.34, -1.75], [0.34, -1.62], [0.05, -1.62]], 28), MAT.housing);
  addEdges(engineStub, 40);
  root.add(engineStub);
  housings.push(engineStub);
  labels.push(makeLabel(root, '发动机', [-1.8, 0.44, 0]));

  const crankStub = new THREE.Group();
  root.add(crankStub);
  const crankShaft = shaftMesh(0.045, 0.4, MAT.steel);
  crankShaft.position.x = -1.75;
  crankStub.add(crankShaft);
  const flexplate = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 40).rotateZ(Math.PI / 2), MAT.steelDark);
  flexplate.position.x = -1.53;
  crankStub.add(flexplate);
  labels.push(makeLabel(root, '挠性盘（无飞轮离合器）', [-1.53, -0.4, 0]));

  // ============ 液力变矩器 ============
  const TC_X = -1.22, R0 = 0.235, RT = 0.135;
  const tcGroup = new THREE.Group();
  tcGroup.position.x = TC_X;
  root.add(tcGroup);

  const shellProfile = (phi0, phi1, rTube) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const ph = (phi0 + (phi1 - phi0) * (i / 20)) * (Math.PI / 180);
      pts.push([R0 + rTube * Math.cos(ph), rTube * Math.sin(ph)]);
    }
    return pts;
  };
  // 泵轮壳（后半，与发动机相连）— 红色半透明
  const pumpShellMat = new THREE.MeshPhysicalMaterial({
    color: 0xd06045, metalness: 0.5, roughness: 0.3, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
  const pumpGrp = new THREE.Group();
  tcGroup.add(pumpGrp);
  const pumpShell = new THREE.Mesh(latheX(shellProfile(-78, 78, RT), 48), pumpShellMat);
  pumpGrp.add(pumpShell);
  // 前盖（与泵轮同转）
  const coverMat = new THREE.MeshPhysicalMaterial({
    color: 0x99a7b8, metalness: 0.6, roughness: 0.25, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
  });
  const frontCover = new THREE.Mesh(latheX([
    [0.05, -RT - 0.035], [0.3, -RT - 0.02], [R0 + RT * 0.92, -RT * 0.35], [R0 + RT, 0],
  ], 48), coverMat);
  pumpGrp.add(frontCover);

  // 泵轮叶片（红）
  const bladeGeo = new THREE.BoxGeometry(RT * 0.85, RT * 1.35, 0.007);
  for (let i = 0; i < 19; i++) {
    const a = (i / 19) * Math.PI * 2;
    const hold = new THREE.Group();
    hold.rotation.x = a;
    const b = new THREE.Mesh(bladeGeo, MAT.pumpRed);
    b.position.set(RT * 0.42, R0, 0);
    b.rotation.y = 0.55; // 叶片倾角
    hold.add(b);
    pumpGrp.add(hold);
  }
  labels.push(makeLabel(tcGroup, '泵轮（主动·红）', [0.16, R0 + RT + 0.06, 0]));

  // 涡轮叶片（蓝）+ 涡轮盘
  const turbGrp = new THREE.Group();
  tcGroup.add(turbGrp);
  for (let i = 0; i < 19; i++) {
    const a = (i / 19 + 0.5 / 19) * Math.PI * 2;
    const hold = new THREE.Group();
    hold.rotation.x = a;
    const b = new THREE.Mesh(bladeGeo, MAT.turbineBlue);
    b.position.set(-RT * 0.42, R0, 0);
    b.rotation.y = -0.55;
    hold.add(b);
    turbGrp.add(hold);
  }
  const turbDisc = new THREE.Mesh(latheX([[0.05, -RT * 0.9], [R0 - RT * 0.5, -RT * 0.35], [R0 - RT * 0.45, -RT * 0.28], [0.05, -RT * 0.75]], 40), MAT.turbineBlue);
  turbGrp.add(turbDisc);
  labels.push(makeLabel(tcGroup, '涡轮（被动·蓝）', [-0.16, -(R0 + RT) - 0.06, 0]));

  // 锁止离合器盘（贴前盖）
  const lockMat = glowable(MAT.friction);
  const lockDisc = new THREE.Mesh(latheX([[0.1, -RT - 0.028], [0.185, -RT - 0.028], [0.185, -RT - 0.018], [0.1, -RT - 0.018]], 36), lockMat);
  turbGrp.add(lockDisc);
  labels.push(makeLabel(tcGroup, '锁止离合器', [-RT - 0.02, 0.36, 0]));

  // 导轮（黄）
  const statGrp = new THREE.Group();
  tcGroup.add(statGrp);
  const statBladeGeo = new THREE.BoxGeometry(RT * 0.7, R0 - RT * 0.55 - 0.045, 0.009);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2;
    const hold = new THREE.Group();
    hold.rotation.x = a;
    const b = new THREE.Mesh(statBladeGeo, MAT.statorYellow);
    b.position.set(0, 0.045 + (R0 - RT * 0.55 - 0.045) / 2, 0);
    b.rotation.y = -0.7;
    hold.add(b);
    statGrp.add(hold);
  }
  const statHub = shaftMesh(0.045, RT * 0.8, MAT.statorYellow);
  statGrp.add(statHub);
  labels.push(makeLabel(tcGroup, '导轮（反力·黄）+ 单向离合器', [0, -0.1, R0 - 0.02]));

  // ============ 轴系 ============
  // 涡轮轴（输入轴）
  const inputGrp = new THREE.Group();
  root.add(inputGrp);
  const inputShaft = shaftMesh(0.024, 0.72, MAT.steel);
  inputShaft.position.x = -0.72;
  inputGrp.add(inputShaft);
  labels.push(makeLabel(root, '涡轮轴（变速箱输入）', [-0.75, 0.24, 0]));

  // ============ 主行星排 ============
  const M1 = 0.009;
  const main = buildPlanetary({
    x: -0.32, m: M1, zs: AT.zSun, zr: AT.zRing, zp: AT.zPlanet, n: AT.nPlanets,
    width: 0.055, labelPrefix: '主排', labels, parent: root,
  });

  // C1: 输入 → 太阳轮
  const c1 = buildClutchPack({ x: -0.62, rIn: 0.06, rOut: 0.13, parent: root, labels, labelText: 'C1 离合器（输入→太阳轮）', labelOff: [0, 0.22, 0] });
  // C3: 输入 → 齿圈
  const c3 = buildClutchPack({ x: -0.78, rIn: 0.13, rOut: 0.2, parent: root, labels, labelText: 'C3 离合器（输入→齿圈）', labelOff: [0, 0.29, 0] });
  // C3 → 齿圈的连接鼓
  const ringDrum = new THREE.Mesh(latheX([
    [0.205, -0.43 + 0.32], [0.26, -0.2 + 0.06], [0.265, -0.06], [0.265, 0.0],
  ].map(([r, x]) => [r, x]), 40, ), new THREE.MeshStandardMaterial({ color: 0x7f9fd9, metalness: 0.85, roughness: 0.34, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  ringDrum.position.x = -0.55;
  root.add(ringDrum);

  // 太阳轮连接鼓（用于 B1 制动）
  const sunDrumMat = new THREE.MeshStandardMaterial({ color: 0xd8b563, metalness: 0.85, roughness: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const sunDrum = new THREE.Mesh(latheX([[0.026, 0], [0.15, 0.004], [0.155, 0.05], [0.155, 0.09]], 36), sunDrumMat);
  sunDrum.position.x = -0.53;
  root.add(sunDrum);

  const b1 = buildBand({ x: -0.47, r: 0.165, parent: root, labels, labelText: 'B1 制动带（刹住太阳轮）' });
  const b2 = buildBand({ x: -0.32, r: 0.275, parent: root, labels, labelText: 'B2 制动带（刹住齿圈）' });

  // ============ OD 超速排 ============
  const M2 = 0.0075;
  const od = buildPlanetary({
    x: 0.12, m: M2, zs: AT.zSun, zr: AT.zRing, zp: AT.zPlanet, n: AT.nPlanets,
    width: 0.05, labelPrefix: 'OD排', labels, parent: root,
  });
  // 中间轴：主排行星架 → OD 行星架
  const midShaft = shaftMesh(0.028, 0.36, MAT.steelDark);
  midShaft.position.x = -0.1;
  root.add(midShaft);
  const cod = buildClutchPack({ x: 0.38, rIn: 0.05, rOut: 0.115, parent: root, labels, labelText: 'C-od（锁死OD排=直连）', labelOff: [0, 0.2, 0] });
  // OD 太阳轮鼓（B-od 套在其上制动）
  const odSunDrum = new THREE.Mesh(latheX([[0.022, 0.14], [0.12, 0.135], [0.125, 0.1], [0.125, 0.055], [0.09, 0.05]], 32), sunDrumMat.clone());
  odSunDrum.position.x = 0.12;
  root.add(odSunDrum);
  const bod = buildBand({ x: 0.22, r: 0.14, parent: root, labels, labelText: 'B-od（刹OD太阳轮=超速挡）' });

  // ============ 输出 ============
  const outGrp = new THREE.Group();
  root.add(outGrp);
  const outShaft = shaftMesh(0.03, 0.5, MAT.steel);
  outShaft.position.x = 0.55;
  outGrp.add(outShaft);
  const outFlange = new THREE.Mesh(latheX([[0.03, 0.76], [0.08, 0.76], [0.08, 0.8], [0.03, 0.8]], 24), MAT.steelDark);
  outGrp.add(outFlange);
  labels.push(makeLabel(root, '输出轴（OD排齿圈驱动）', [0.6, -0.24, 0]));

  const propGrp = new THREE.Group();
  root.add(propGrp);
  const prop = shaftMesh(0.045, 0.62, MAT.steel);
  prop.position.x = 1.12;
  propGrp.add(prop);

  const axle = buildRearAxle(1.52, labels);
  root.add(axle.group);

  // 变速箱壳
  const caseShell = new THREE.Mesh(latheX([
    [0.44, -1.5], [0.44, -0.95], [0.31, -0.86], [0.31, 0.42], [0.12, 0.52], [0.12, 0.62],
  ], 48), MAT.housing);
  addEdges(caseShell, 35);
  root.add(caseShell);
  housings.push(caseShell);
  labels.push(makeLabel(root, '变速箱壳体', [-0.2, -0.42, 0.18]));

  root.add(buildStand(-1.78, -0.14));
  root.add(buildStand(-1.22, -0.48));
  root.add(buildStand(0.1, -0.36));
  root.add(buildStand(1.52, -0.22));

  root.traverse((o) => { if (o.isMesh && o.material !== MAT.housing) o.castShadow = true; });

  // ============ 更新 ============
  const S = { pump: 0, turb: 0, s1: 0, c1: 0, r1: 0, s2: 0, c2: 0, r2: 0 };

  function update(st, dt) {
    const spin = st.spin !== false;
    if (spin) {
      S.pump += (st.engineRpm || 0) * RPM2RAD * dt;
      S.turb += (st.turbineRpm || 0) * RPM2RAD * dt;
      const m = st.members || {};
      S.s1 += (m.s1 || 0) * RPM2RAD * dt;
      S.c1 += (m.c1 || 0) * RPM2RAD * dt;
      S.r1 += (m.r1 || 0) * RPM2RAD * dt;
      S.s2 += (m.s2 || 0) * RPM2RAD * dt;
      S.c2 += (m.c2 || 0) * RPM2RAD * dt;
      S.r2 += (m.r2 || 0) * RPM2RAD * dt;
    }
    crankStub.rotation.x = S.pump;
    pumpGrp.rotation.x = S.pump;
    turbGrp.rotation.x = S.turb;
    // 导轮：速比低时静止（单向离合器锁止），耦合后随液流同转
    const sr = st.engineRpm > 60 ? (st.turbineRpm || 0) / st.engineRpm : 0;
    if (sr > 0.85 && spin) statGrp.rotation.x += (st.turbineRpm || 0) * 0.6 * RPM2RAD * dt;

    inputGrp.rotation.x = S.turb;
    main.setAngles(S.s1, S.c1, S.r1);
    od.setAngles(S.s2, S.c2, S.r2);
    midShaft.rotation.x = S.c1;
    sunDrum.rotation.x = S.s1;
    ringDrum.rotation.x = S.r1;
    odSunDrum.rotation.x = S.s2;
    outGrp.rotation.x = S.r2;
    propGrp.rotation.x = S.r2;
    axle.update(S.r2, S.r2 * (13 / 51));

    const el = st.elements || {};
    c1.setEngage(clamp01(el.C1 || 0));
    c3.setEngage(clamp01(el.C3 || 0));
    b1.setEngage(clamp01(el.B1 || 0));
    b2.setEngage(clamp01(el.B2 || 0));
    cod.setEngage(clamp01(el.Cod || 0));
    bod.setEngage(clamp01(el.Bod || 0));
    c1.spin(S.turb);
    c3.spin(S.turb);
    cod.spin(S.c2);
    lockMat.emissiveIntensity = (st.lockup || 0) * 0.9;
  }

  function setHousingVisible(v) { for (const h of housings) h.visible = v; }
  function setLabelsVisible(v) { for (const l of labels) l.userData.el.style.display = v ? '' : 'none'; }

  const CAMS = {
    whole: { pos: [0.7, 1.5, 3.6], tgt: [-0.2, -0.05, 0] },
    converter: { pos: [-1.9, 0.75, 1.6], tgt: [-1.22, 0, 0] },
    planetary: { pos: [-0.05, 0.55, 1.25], tgt: [-0.25, 0, 0] },
    od: { pos: [0.5, 0.5, 1.1], tgt: [0.18, 0, 0] },
    output: { pos: [1.1, 0.8, 2.2], tgt: [1.3, -0.05, 0] },
  };

  return { scene, root, update, setHousingVisible, setLabelsVisible, CAMS };
}
