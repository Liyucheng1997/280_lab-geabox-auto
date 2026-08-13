// ============================================================
// 共享材质库 —— 金属质感依赖环境贴图（在 main.js 中生成 PMREM）
// ============================================================
import * as THREE from 'three';

export const MAT = {};

export function initMaterials() {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const phy = (p) => new THREE.MeshPhysicalMaterial(p);

  MAT.steel = std({ color: 0xb8bcc4, metalness: 0.92, roughness: 0.32 });
  MAT.steelDark = std({ color: 0x767c86, metalness: 0.9, roughness: 0.42 });
  MAT.steelBright = std({ color: 0xd6dae0, metalness: 0.95, roughness: 0.18 });
  MAT.gear = std({ color: 0xc0c6cf, metalness: 0.9, roughness: 0.3 });
  MAT.gearBlue = std({ color: 0x7f9fd9, metalness: 0.85, roughness: 0.34 });
  MAT.gearGold = std({ color: 0xd8b563, metalness: 0.88, roughness: 0.3 });
  MAT.brass = std({ color: 0xc9963c, metalness: 0.95, roughness: 0.28 });
  MAT.copper = std({ color: 0xc97a4a, metalness: 0.95, roughness: 0.3 });
  MAT.ironCast = std({ color: 0x5a5e63, metalness: 0.75, roughness: 0.62 });
  MAT.alu = std({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.45 });
  MAT.black = std({ color: 0x232529, metalness: 0.4, roughness: 0.65 });
  MAT.rubber = std({ color: 0x1c1d1f, metalness: 0.05, roughness: 0.92 });
  MAT.friction = std({ color: 0x6e4a34, metalness: 0.15, roughness: 0.85 });   // 摩擦片
  MAT.spring = std({ color: 0x8b6bd6, metalness: 0.85, roughness: 0.35 });     // 弹簧（紫）
  MAT.sleeve = std({ color: 0x4f8fdd, metalness: 0.88, roughness: 0.3 });      // 接合套（蓝）
  MAT.hub = std({ color: 0x3f7448, metalness: 0.82, roughness: 0.4 });         // 同步器毂（绿）
  MAT.fork = std({ color: 0xd06a2c, metalness: 0.7, roughness: 0.45 });        // 拨叉（橙）
  MAT.red = std({ color: 0xc4524f, metalness: 0.75, roughness: 0.4 });
  MAT.pumpRed = std({ color: 0xcf6a55, metalness: 0.82, roughness: 0.38 });    // 泵轮
  MAT.turbineBlue = std({ color: 0x5d8fd6, metalness: 0.82, roughness: 0.38 });// 涡轮
  MAT.statorYellow = std({ color: 0xd3aa4e, metalness: 0.82, roughness: 0.38 });// 导轮

  // 半透明壳体
  MAT.housing = phy({
    color: 0x8fa3b8, metalness: 0.35, roughness: 0.25,
    transparent: true, opacity: 0.16, side: THREE.DoubleSide,
    depthWrite: false, envMapIntensity: 0.8,
  });
  MAT.housingEdge = new THREE.LineBasicMaterial({ color: 0x6f8298, transparent: true, opacity: 0.4 });

  // 高亮发光（换挡执行元件激活）
  MAT.glow = std({ color: 0xffb020, metalness: 0.6, roughness: 0.35, emissive: 0xff8c00, emissiveIntensity: 0.0 });

  MAT.ground = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.1, roughness: 0.95 });
  return MAT;
}

/** 复制一份可独立控制 emissive 的材质 */
export function glowable(base, emissiveHex = 0xffa020) {
  const m = base.clone();
  m.emissive = new THREE.Color(emissiveHex);
  m.emissiveIntensity = 0;
  return m;
}

export function setGlow(mesh, k) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) if (m.emissive) m.emissiveIntensity = k;
}
