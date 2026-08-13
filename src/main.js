// ============================================================
// 主程序：渲染器 / 模式切换 / UI 交互 / 主循环
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { initMaterials } from './materials.js';
import { buildGround } from './sceneUtils.js';
import { buildDrivelineScene } from './drivelineScene.js';
import { buildAutoScene } from './autoScene.js';
import { WhySim, ManualSeq, AutoSim } from './sim.js';
import {
  makeEngineChart, makeTractionChart, makeRpmSpeedChart, makeSyncChart,
  makeShiftMapChart, makeConverterChart, drawGauge,
} from './charts.js';
import { KMH } from './params.js';

// ---------- 渲染器 ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

initMaterials();

// ---------- 场景 ----------
function dressScene(scene) {
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(-4, 2.5, -4);
  scene.add(fill);
  buildGround(scene);
}

const driveline = buildDrivelineScene();
const auto = buildAutoScene();
dressScene(driveline.scene);
dressScene(auto.scene);

// ---------- 相机 ----------
const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 60);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 14;
controls.minDistance = 0.4;
controls.maxPolarAngle = Math.PI * 0.55;

const camTween = { active: false, pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function focusCam(preset, immediate = false) {
  camTween.pos.set(...preset.pos);
  camTween.tgt.set(...preset.tgt);
  if (immediate) {
    camera.position.copy(camTween.pos);
    controls.target.copy(camTween.tgt);
    camTween.active = false;
  } else camTween.active = true;
}
controls.addEventListener('start', () => { camTween.active = false; });
focusCam(driveline.CAMS.whole, true);

// ---------- 仿真器 ----------
const whySim = new WhySim();
const manualSeq = new ManualSeq();
const autoSim = new AutoSim();

// ---------- 图表 ----------
const chEngine = makeEngineChart(document.getElementById('chart-engine'));
const chTraction = makeTractionChart(document.getElementById('chart-traction'));
const chRpmSpeed = makeRpmSpeedChart(document.getElementById('chart-rpmspeed'));
const chSync = makeSyncChart(document.getElementById('chart-sync'));
const chShiftMap = makeShiftMapChart(document.getElementById('chart-shiftmap'));
const chConverter = makeConverterChart(document.getElementById('chart-converter'));
const gaugeRpm = document.getElementById('gauge-rpm');
const gaugeSpeed = document.getElementById('gauge-speed');

// ---------- 模式管理 ----------
let mode = 'why';
const camSaved = {};
const paneOf = { why: 'pane-why', manual: 'pane-manual', auto: 'pane-auto' };

function switchMode(m) {
  if (m === mode) return;
  camSaved[mode] = { pos: camera.position.toArray(), tgt: controls.target.toArray() };
  mode = m;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  for (const [k, id] of Object.entries(paneOf)) {
    document.getElementById(id).classList.toggle('hidden', k !== m);
  }
  document.getElementById('seq-bar').classList.toggle('hidden', m !== 'manual');
  if (m !== 'manual') hideToast();
  if (camSaved[m]) focusCam({ pos: camSaved[m].pos, tgt: camSaved[m].tgt }, true);
  else focusCam(m === 'auto' ? auto.CAMS.whole : driveline.CAMS.whole, true);
  if (m === 'manual') { manualSeq.playing = false; applySeqUI(-1); }
  document.getElementById('panel').scrollTop = 0;
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));

// ---------- 顶栏开关 ----------
let spinOn = true;
document.getElementById('toggle-labels').addEventListener('change', (e) => {
  driveline.setLabelsVisible(e.target.checked);
  auto.setLabelsVisible(e.target.checked);
});
document.getElementById('toggle-housing').addEventListener('change', (e) => {
  driveline.setHousingVisible(e.target.checked);
  auto.setHousingVisible(e.target.checked);
});
document.getElementById('toggle-spin').addEventListener('change', (e) => { spinOn = e.target.checked; });

// ---------- Toast ----------
const toastEl = document.getElementById('scene-toast');
let toastKey = '';
function showToast(html, warn = false) {
  if (toastKey === html) return;
  toastKey = html;
  toastEl.innerHTML = html;
  toastEl.classList.remove('hidden');
  toastEl.classList.toggle('warn', warn);
}
function hideToast() { toastKey = ''; toastEl.classList.add('hidden'); }

// ---------- 模式一 UI ----------
const whyThrottle = document.getElementById('why-throttle');
const whyThrottleVal = document.getElementById('why-throttle-val');
whyThrottle.addEventListener('input', () => {
  whySim.throttle = Number(whyThrottle.value) / 100;
  whyThrottleVal.textContent = whyThrottle.value + '%';
});
const whyGearBtns = [...document.querySelectorAll('#why-gears button')];
whyGearBtns.forEach((b) => b.addEventListener('click', () => whySim.requestGear(Number(b.dataset.g))));
document.getElementById('why-reset').addEventListener('click', () => {
  whySim.reset();
  whyThrottle.value = 0; whyThrottleVal.textContent = '0%';
});
const whyMsg = document.getElementById('why-msg');

// ---------- 模式二 UI ----------
const stepsEl = document.getElementById('manual-steps');
manualSeq.phases.forEach((p, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<div>${p.title}<small>${p.name}</small></div>`;
  li.addEventListener('click', () => { manualSeq.jumpTo(i); manualSeq.playing = false; });
  stepsEl.appendChild(li);
});
const stepLis = [...stepsEl.children];
const seqPlayBtn = document.getElementById('seq-play');
seqPlayBtn.addEventListener('click', () => {
  if (manualSeq.t >= manualSeq.total - 0.01) { manualSeq.t = 0; manualSeq.history = []; manualSeq.lastHistT = -1; }
  manualSeq.playing = !manualSeq.playing;
});
document.getElementById('seq-rate').addEventListener('change', (e) => { manualSeq.rate = Number(e.target.value); });

const seqStepsBar = document.getElementById('seq-steps');
manualSeq.phases.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = `${i}. ${p.name}`;
  b.addEventListener('click', () => { manualSeq.jumpTo(i); manualSeq.playing = false; });
  seqStepsBar.appendChild(b);
});
const seqBtns = [...seqStepsBar.children];
let lastSeqPhase = -2;
function applySeqUI(phase) {
  seqBtns.forEach((b, i) => {
    b.classList.toggle('active', i === phase);
    b.classList.toggle('done', i < phase);
  });
  stepLis.forEach((li, i) => {
    li.classList.toggle('active', i === phase);
    li.classList.toggle('done', i < phase);
  });
}
// 同步图阶段底纹
const seqSpans = (() => {
  let acc = 0;
  const spans = [];
  manualSeq.phases.forEach((p, i) => {
    if (i === 2 || i === 5 || i === 7) {
      spans.push({ t0: acc, t1: acc + p.dur, name: p.name, color: i === 5 ? 'rgba(57,135,229,0.12)' : 'rgba(137,135,129,0.10)' });
    }
    acc += p.dur;
  });
  return spans;
})();
const barPedal = document.getElementById('bar-pedal');
const barClamp = document.getElementById('bar-clamp');
const barTorque = document.getElementById('bar-torque');
const barPedalV = document.getElementById('bar-pedal-v');
const barClampV = document.getElementById('bar-clamp-v');
const barTorqueV = document.getElementById('bar-torque-v');

// ---------- 模式三 UI ----------
const autoThrottle = document.getElementById('auto-throttle');
const autoThrottleVal = document.getElementById('auto-throttle-val');
autoThrottle.addEventListener('input', () => {
  autoSim.throttle = Number(autoThrottle.value) / 100;
  autoThrottleVal.textContent = autoThrottle.value + '%';
});
const brakeBtn = document.getElementById('auto-brake');
brakeBtn.addEventListener('pointerdown', () => { autoSim.brake = true; brakeBtn.classList.add('active'); });
window.addEventListener('pointerup', () => { autoSim.brake = false; brakeBtn.classList.remove('active'); });
document.getElementById('auto-kick').addEventListener('click', () => {
  autoSim.kickdown();
  autoThrottle.value = 100; autoThrottleVal.textContent = '100%';
  autoSim.throttle = 1;
});
const autoMsg = document.getElementById('auto-msg');
const clutchRows = [...document.querySelectorAll('#clutch-table tbody tr')];

// 行星排原理演示
const DEMOS = {
  reduce: {
    members: { s1: 75, c1: 25, r1: 0, s2: 25, c2: 25, r2: 25 },
    elements: { C1: 1, C3: 0, B1: 0, B2: 1, Cod: 1, Bod: 0 },
    msg: '1挡·<b>太阳轮输入、齿圈被 B2 刹住、行星架输出</b>：i = 1 + Zr/Zs = 1 + 48/24 = <b>3.00</b>，转速降为 1/3，扭矩放大 3 倍。',
  },
  reduce2: {
    members: { s1: 0, c1: 50, r1: 75, s2: 50, c2: 50, r2: 50 },
    elements: { C1: 0, C3: 1, B1: 1, B2: 0, Cod: 1, Bod: 0 },
    msg: '2挡·<b>齿圈输入、太阳轮被 B1 刹住、行星架输出</b>：i = 1 + Zs/Zr = <b>1.50</b>。',
  },
  lock: {
    members: { s1: 75, c1: 75, r1: 75, s2: 75, c2: 75, r2: 75 },
    elements: { C1: 1, C3: 1, B1: 0, B2: 0, Cod: 1, Bod: 0 },
    msg: '3挡·<b>C1 与 C3 同时接合</b>：太阳轮与齿圈被强制同速，整排锁死随输入同转，<b>i = 1.00</b> 直接挡。',
  },
  od: {
    members: { s1: 75, c1: 75, r1: 75, s2: 0, c2: 75, r2: 112.5 },
    elements: { C1: 1, C3: 1, B1: 0, B2: 0, Cod: 0, Bod: 1 },
    msg: '4挡·OD排：<b>行星架输入、太阳轮被 B-od 刹住、齿圈输出</b>：ω齿圈 = 1.5×ω行星架，<b>i = 0.67</b>，输出比发动机还快 —— 高速巡航省油的超速挡。',
  },
  reverse: {
    members: { s1: 75, c1: 0, r1: -37.5, s2: 0, c2: 0, r2: 0 },
    elements: { C1: 1, C3: 0, B1: 0, B2: 0, Cod: 0, Bod: 0 },
    msg: 'R挡·<b>太阳轮输入、行星架被刹住、齿圈反转输出</b>：ω齿圈 = −(Zs/Zr)·ω太阳轮 = <b>−0.5×</b>（演示用；真实 AT 由额外的制动器刹住行星架）。倒挡不需要任何倒挡齿轮副！',
  },
};
let demoMode = null;
const demoBtns = [...document.querySelectorAll('#planetary-modes button')];
const planetaryMsg = document.getElementById('planetary-msg');
demoBtns.forEach((b) => b.addEventListener('click', () => {
  demoMode = demoMode === b.dataset.m ? null : b.dataset.m;
  demoBtns.forEach((x) => x.classList.toggle('active', x.dataset.m === demoMode));
  if (demoMode) {
    planetaryMsg.innerHTML = DEMOS[demoMode].msg;
    focusCam(auto.CAMS.planetary);
  } else planetaryMsg.innerHTML = '已回到驾驶仿真联动。';
}));
planetaryMsg.innerHTML = DEMOS.reduce.msg;

// ---------- HUD ----------
const hudGear = document.getElementById('hud-gear-value');
function updateHUD(rpm, v, gearText, shifting = false) {
  drawGauge(gaugeRpm, { value: rpm, min: 0, max: 7000, redFrom: 6500, label: '发动机转速', unit: 'rpm', fmt: (x) => (x / 1000).toFixed(0) + 'k' });
  drawGauge(gaugeSpeed, { value: v * KMH, min: 0, max: 220, redFrom: null, label: '车速', unit: 'km/h' });
  hudGear.textContent = gearText;
  hudGear.classList.toggle('shifting', shifting);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let frame = 0;
let lastFocus = '';

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', () => { resize(); });

function animate() {
  requestAnimationFrame(animate);
  step(Math.min(clock.getDelta(), 0.05));
}

function step(dt) {
  resize();
  frame++;

  if (camTween.active) {
    camera.position.lerp(camTween.pos, 1 - Math.exp(-3.2 * dt));
    controls.target.lerp(camTween.tgt, 1 - Math.exp(-3.2 * dt));
    if (camera.position.distanceTo(camTween.pos) < 0.02) camTween.active = false;
  }
  controls.update();

  let activeScene;
  if (mode === 'why') {
    const st = whySim.update(dt);
    st.spin = spinOn;
    driveline.setGlowTarget(st.stalled || st.fuelCut ? [] : []);
    driveline.update(st, dt);
    activeScene = driveline.scene;
    if (frame % 2 === 0) {
      chEngine(st.engineRpm);
      chTraction({ v: st.v, gear: st.gear, F: st.F });
      chRpmSpeed({ v: st.v, gear: st.gear, rpm: st.engineRpm });
    }
    whyMsg.textContent = whySim.msg.text;
    whyMsg.className = 'msg ' + whySim.msg.cls;
    whyGearBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.g) === st.gear));
    updateHUD(st.engineRpm, st.v, st.stalled ? '✖' : st.gear === 0 ? 'N' : String(st.gear), !!whySim.shiftAnim);
  } else if (mode === 'manual') {
    const st = manualSeq.update(dt);
    st.spin = spinOn;
    driveline.setGlowTarget(st.hl);
    driveline.update(st, dt);
    activeScene = driveline.scene;
    if (st.phase !== lastSeqPhase) {
      lastSeqPhase = st.phase;
      applySeqUI(st.phase);
      focusCam(driveline.CAMS[st.focus] || driveline.CAMS.whole);
    }
    showToast(`${st.title}<br><span style="color:#c3c2b7">${st.cap}</span>`);
    seqPlayBtn.textContent = manualSeq.playing ? '⏸ 暂停' : (manualSeq.t >= manualSeq.total - 0.01 ? '⟲ 重新播放' : '▶ 播放全过程');
    seqPlayBtn.classList.toggle('playing', manualSeq.playing);
    if (frame % 2 === 0) chSync(manualSeq.history, manualSeq.total, seqSpans);
    const pedalPct = Math.round(st.pedal * 100);
    barPedal.style.width = pedalPct + '%';
    barClamp.style.width = (100 - pedalPct) + '%';
    barTorque.style.width = (100 - pedalPct) + '%';
    barPedalV.textContent = pedalPct + '%';
    barClampV.textContent = (100 - pedalPct) + '%';
    barTorqueV.textContent = (100 - pedalPct) + '%';
    updateHUD(st.engineRpm, st.v, st.gear === 0 ? 'N' : String(st.gear), st.gear === 0);
  } else {
    const st = autoSim.update(dt);
    st.spin = spinOn;
    if (demoMode) {
      const d = DEMOS[demoMode];
      st.members = d.members;
      st.elements = d.elements;
      st.engineRpm = 90;
      st.turbineRpm = 75;
      st.lockup = 0;
    }
    auto.update(st, dt);
    activeScene = auto.scene;
    if (frame % 2 === 0) {
      chShiftMap({ v: st.v, throttle: autoSim.kick > 0 ? 1 : autoSim.throttle, gear: autoSim.shift ? autoSim.shift.to : autoSim.gear });
      chConverter(st.sr, st.lockup);
    }
    autoMsg.innerHTML = autoSim.msg.text;
    autoMsg.className = 'msg ' + autoSim.msg.cls;
    const curGear = autoSim.shift ? autoSim.shift.to : autoSim.gear;
    clutchRows.forEach((r) => r.classList.toggle('cur', Number(r.dataset.g) === curGear));
    updateHUD(st.engineRpm, st.v, 'D' + st.gear, st.shifting);
    if (st.shifting) showToast(`⚙ 正在换挡 ${autoSim.shift.from} → ${autoSim.shift.to}：一组离合器/制动带松开、另一组接合（重叠换挡，动力几乎不中断）`);
    else if (st.lockup > 0.6) showToast('🔒 锁止离合器已闭合：泵轮与涡轮机械直连，消除液力损失，效率≈100%。');
    else if (toastKey && mode === 'auto' && !demoMode) hideToast();
    if (demoMode) showToast('🪐 行星排原理演示中（慢速旋转）—— 点击按钮可切换模式，再点一次返回驾驶仿真。');
  }

  renderer.render(activeScene, camera);
  labelRenderer.render(activeScene, camera);
}

resize();
animate();

// 调试句柄（供开发检查）
window.__app = {
  renderer, camera, controls, driveline, auto,
  whySim, manualSeq, autoSim, step,
  get mode() { return mode; },
  setMode: switchMode,
  focusCam,
  snapshot(w = 1280, h = 800) {
    // 离屏渲染一帧并导出 PNG dataURL
    const oldW = canvas.width, oldH = canvas.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const scene = mode === 'auto' ? auto.scene : driveline.scene;
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    renderer.setSize(oldW / renderer.getPixelRatio(), oldH / renderer.getPixelRatio(), false);
    camera.aspect = oldW / oldH;
    camera.updateProjectionMatrix();
    return url;
  },
};
