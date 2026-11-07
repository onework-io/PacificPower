import {
  AdditiveBlending,
  Box3,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { LoadedPart } from './ModelLoader'
import { buildExplodePlan, explodedPosition, shellOpacityFor, type ExplodePlan } from './Explode'

/** 隔離模式下，非選中構件的透明度 */
const GHOST_OPACITY = 0.12
/** WBS 選取構件的發光色；與介面的 accent 藍一致。 */
const HIGHLIGHT_EMISSIVE = 0x21b8ff
const HIGHLIGHT_INTENSITY = 1.8
const LAYOUT_GROUP = '施工放樣'

interface LayoutGlow {
  id: string
  mesh: Mesh
  material: ShaderMaterial
}

/** 放樣線專用動畫材質：以畫面座標產生流動脈衝，讓細線在複雜模型上仍清楚可見。 */
function createLayoutGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      void main() {
        vec3 expanded = position + normal * 0.012;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      void main() {
        float sweep = 0.5 + 0.5 * sin(uTime * 5.0 + gl_FragCoord.x * 0.055 + gl_FragCoord.y * 0.025);
        float pulse = 0.62 + 0.38 * sin(uTime * 3.2);
        vec3 cyan = mix(vec3(0.08, 0.55, 1.0), vec3(0.72, 0.96, 1.0), sweep);
        gl_FragColor = vec4(cyan * (1.2 + sweep * 0.8), (0.42 + sweep * 0.45) * pulse);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  })
}

interface Entry {
  part: LoadedPart
  /** 使用者在清單勾選的顯示意願，與「因全透明而不繪製」分開記錄 */
  wantVisible: boolean
  /** 該構件所有 mesh 的材質（載入時已 clone，改動不影響其他構件） */
  materials: Material[]
  /** 各材質的原始 transparent / opacity / depthWrite，供還原 */
  original: {
    transparent: boolean
    opacity: number
    depthWrite: boolean
    emissive: number | null
    emissiveIntensity: number | null
  }[]
  box: Box3
}

/**
 * 保管 partId → Object3D 的對照，並集中處理顯示、隔離與爆炸。
 *
 * 材質在建構時一律 clone：Blender 匯出的同一個 GLB 內多個 mesh 可能共用材質實例，
 * 直接改 opacity 會讓不該變透明的構件跟著變，且還原時難以回到原值。
 */
export class PartRegistry {
  private entries = new Map<string, Entry>()
  private plan: ExplodePlan = { entries: [], span: 0 }
  private explodeFactor = 0
  private isolatedId: string | null = null
  private highlightedIds = new Set<string>()
  private layoutGlows: LayoutGlow[] = []
  private shellGhost = false
  /** 進度模擬過濾：只顯示集合內的設備；null 表示不過濾 */
  private progressFilter: Set<string> | null = null
  /** 進度模擬當下的施工構件；即使圖層原先關閉，也會在聚焦期間暫時顯示 */
  private simulationFocusId: string | null = null

  constructor(parts: LoadedPart[]) {
    const boxes = new Map<string, Box3>()
    const positions = new Map<string, Vector3>()

    for (const part of parts) {
      const materials: Material[] = []
      const sourceMeshes: Mesh[] = []
      part.object.traverse((o: Object3D) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        sourceMeshes.push(mesh)
        const cloned = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : mesh.material.clone()
        mesh.material = cloned
        materials.push(...(Array.isArray(cloned) ? cloned : [cloned]))
      })

      const box = new Box3().setFromObject(part.object)
      boxes.set(part.def.id, box)
      positions.set(part.def.id, part.object.position.clone())

      this.entries.set(part.def.id, {
        part,
        wantVisible: true,
        materials,
        original: materials.map((m) => ({
          transparent: m.transparent,
          opacity: m.opacity,
          depthWrite: m.depthWrite,
          emissive: m instanceof MeshStandardMaterial ? m.emissive.getHex() : null,
          emissiveIntensity: m instanceof MeshStandardMaterial ? m.emissiveIntensity : null,
        })),
        box,
      })

      if (part.def.group === LAYOUT_GROUP) {
        for (const source of sourceMeshes) {
          const material = createLayoutGlowMaterial()
          const glow = new Mesh(source.geometry, material)
          glow.name = `${part.def.id}-layout-glow`
          glow.visible = false
          glow.renderOrder = 1000
          source.add(glow)
          this.layoutGlows.push({ id: part.def.id, mesh: glow, material })
        }
      }
    }

    this.plan = buildExplodePlan(
      parts.map((p) => p.def),
      boxes,
      positions,
    )
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  setVisible(id: string, visible: boolean): void {
    const e = this.entries.get(id)
    if (!e) return
    e.wantVisible = visible
    this.applyOpacity()
  }

  /** 設定隔離對象；傳 null 取消隔離。非選中構件變半透明而非隱藏，以保留空間關係 */
  setIsolated(id: string | null): void {
    this.isolatedId = id
    this.applyOpacity()
  }

  /** 讓排程選取的構件發光；可同時亮顯同一工項所包含的多個 GLB。 */
  setHighlighted(ids: Set<string>): void {
    this.highlightedIds = new Set(ids)
    this.applyOpacity()
  }

  /** 由 render loop 更新放樣 Shader，未選取時 overlay 不參與繪製。 */
  updateHighlightAnimation(elapsedSeconds: number): void {
    for (const glow of this.layoutGlows) {
      glow.material.uniforms.uTime.value = elapsedSeconds
    }
  }

  /** 開關「外牆透視」：機房外殼變半透明但仍保留輪廓，與爆炸淡出取較透明者 */
  setShellGhost(on: boolean): void {
    this.shellGhost = on
    this.applyOpacity()
  }

  /**
   * 設定進度模擬過濾。傳 null 關閉過濾。
   * 只作用於設備；機房外殼與施工參考線不隨進度出現或消失，避免失去空間參照。
   */
  setProgressFilter(ids: Set<string> | null): void {
    this.progressFilter = ids
    this.applyOpacity()
  }

  setSimulationFocus(id: string | null): void {
    this.simulationFocusId = id
    this.applyOpacity()
  }

  /** 設定爆炸係數 0–1，同時更新機房外殼透明度 */
  setExplodeFactor(factor: number): void {
    this.explodeFactor = factor
    for (const entry of this.plan.entries) {
      const e = this.entries.get(entry.id)
      if (e) e.part.object.position.copy(explodedPosition(entry, this.plan.span, factor))
    }
    this.applyOpacity()
  }

  /** 依目前的隔離與爆炸狀態重算每個構件的材質透明度 */
  private applyOpacity(): void {
    const shellFade = shellOpacityFor(this.explodeFactor, this.shellGhost)

    for (const [id, e] of this.entries) {
      let opacity = 1
      if (this.isolatedId && id !== this.isolatedId) opacity = GHOST_OPACITY
      if (e.part.def.kind === 'shell') opacity = Math.min(opacity, shellFade)

      const highlighted = this.highlightedIds.has(id)
      const focused = id === this.simulationFocusId
      const forcedVisible = focused || highlighted
      const installed =
        forcedVisible || !this.progressFilter || e.part.def.kind !== 'equipment' || this.progressFilter.has(id)

      // 用 wantVisible 而非當下的 visible，否則外殼淡出後把爆炸拉回 0 也回不來
      e.part.object.visible = (e.wantVisible || forcedVisible) && installed && opacity > 0.001
      for (const glow of this.layoutGlows) {
        if (glow.id === id) glow.mesh.visible = highlighted && e.part.object.visible
      }

      e.materials.forEach((m, i) => {
        const orig = e.original[i]
        if (opacity >= 1) {
          m.transparent = orig.transparent
          m.opacity = orig.opacity
          m.depthWrite = orig.depthWrite
        } else {
          m.transparent = true
          m.opacity = orig.opacity * opacity
          m.depthWrite = false
        }
        if (m instanceof MeshStandardMaterial && orig.emissive !== null) {
          if (highlighted) {
            m.emissive.setHex(HIGHLIGHT_EMISSIVE)
            m.emissiveIntensity = Math.max(orig.emissiveIntensity ?? 0, HIGHLIGHT_INTENSITY)
          } else {
            m.emissive.setHex(orig.emissive)
            m.emissiveIntensity = orig.emissiveIntensity ?? 1
          }
        }
        m.needsUpdate = true
      })
    }
  }

  dispose(): void {
    for (const glow of this.layoutGlows) {
      glow.mesh.removeFromParent()
      glow.material.dispose()
    }
    this.layoutGlows = []
    for (const e of this.entries.values()) {
      for (const m of e.materials) m.dispose()
      e.part.object.traverse((o) => {
        const mesh = o as Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
    }
    this.entries.clear()
  }
}
