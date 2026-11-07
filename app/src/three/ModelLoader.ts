import { Box3, Group, Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { PARTS, modelUrl, type PartDef } from '@/data/parts'


/**
 * 30 個 GLB 共用同一組場域座標，以原點載入即自動組裝。
 * 因此載入後只把「整個 root」平移置中，個別構件維持原座標，
 * 否則相對位置會散掉。
 *
 * 這是與 TaipeiCityHall/ThreeFloorViewer 的 frameModel() 最大差異：
 * 那裡一次只處理一個模型，可以直接對該模型置中。
 */

export interface LoadedPart {
  def: PartDef
  object: Object3D
}

export interface LoadProgress {
  /** 已完成（成功或失敗）的檔案數 */
  done: number
  total: number
  /** 剛完成的構件；失敗時 error 有值 */
  part: PartDef
  error?: unknown
  /** 目前為止成功載入的構件，供載入過程中逐步框景 */
  loaded: LoadedPart[]
}

/**
 * 新版 10–30 號 GLB 是由完整 Revit 場景匯出：除了該工項本體外，
 * 每個檔案都重複帶著同一批既有機電構件。若直接疊加載入，會造成數十份
 * 幾何重疊，且點 WBS 時整個背景都一起亮顯。
 *
 * 這裡以「建築.glb 也具有相同節點名稱」作為共用背景的可靠識別：
 * - 各工項移除共用節點，只保留該步驟本體。
 * - 建築中的共用節點移到獨立 context 群組，只繪製一次。
 * - 建築本身只留下牆、樓板、門等建築構件，隱藏／透視外牆時不會連帶
 *   隱藏既有電纜架與機電背景。
 */
export function normalizeSharedModelNodes(parts: LoadedPart[]): LoadedPart[] {
  const shell = parts.find((part) => part.def.kind === 'shell')
  if (!shell?.object.parent) return parts

  const shellNames = new Set<string>()
  shell.object.traverse((node) => {
    if (node !== shell.object && node.name) shellNames.add(node.name)
  })

  const sharedNames = new Set<string>()
  for (const part of parts) {
    if (part === shell) continue
    part.object.traverse((node) => {
      if (node !== part.object && node.name && shellNames.has(node.name)) {
        sharedNames.add(node.name)
      }
    })
  }
  if (sharedNames.size === 0) return parts

  const removeMatches = (parent: Object3D): number => {
    let removed = 0
    for (const child of [...parent.children]) {
      if (child.name && sharedNames.has(child.name)) {
        parent.remove(child)
        removed++
      } else {
        removed += removeMatches(child)
      }
    }
    return removed
  }

  for (const part of parts) {
    if (part !== shell) removeMatches(part.object)
  }

  const context = new Group()
  context.name = 'context'
  shell.object.parent.add(context)
  shell.object.parent.updateMatrixWorld(true)
  shell.object.updateMatrixWorld(true)
  context.updateMatrixWorld(true)

  const moveMatches = (parent: Object3D): number => {
    let moved = 0
    for (const child of [...parent.children]) {
      if (child.name && sharedNames.has(child.name)) {
        context.attach(child)
        moved++
      } else {
        moved += moveMatches(child)
      }
    }
    return moved
  }
  moveMatches(shell.object)

  const contextPart: LoadedPart = {
    def: {
      id: 'context',
      file: shell.def.file,
      name: '既有機房設備',
      group: shell.def.group,
      kind: 'context',
      bytes: 0,
    },
    object: context,
  }
  return [...parts, contextPart]
}

/**
 * 框景用的包圍盒，以 root 的 local 座標表示：排除場域參考線。
 *
 * 放樣中心線是施工定位輔助，不應影響設備與建築的預設框景。
 *
 * 回傳 local 座標而非世界座標，是為了讓 SceneKit.frame() 可以「絕對」設定
 * root.position。若回傳世界座標，載入過程中每次重新框景都會疊加上一次的位移。
 * root 只有位移、沒有旋轉或縮放，因此扣掉 root 的世界位置即為 local 座標。
 */
export function framingBox(loaded: LoadedPart[], root?: Object3D): Box3 {
  const box = new Box3()
  box.makeEmpty()
  for (const { def, object } of loaded) {
    if (def.kind === 'site') continue
    box.union(new Box3().setFromObject(object))
  }
  // 全部都是參考線（或什麼都沒有）時退回完整包圍盒，至少還看得到東西
  if (box.isEmpty()) {
    for (const { object } of loaded) box.union(new Box3().setFromObject(object))
  }
  if (root && !box.isEmpty()) {
    box.translate(root.getWorldPosition(new Vector3()).negate())
  }
  return box
}

/** 把 root 平移，使框景包圍盒中心落在原點 */
export function centerOffset(box: Box3): Vector3 {
  if (box.isEmpty()) return new Vector3()
  return box.getCenter(new Vector3()).negate()
}

/**
 * 依 PARTS 順序（檔案由小到大）逐一載入，邊載邊回報。
 * 單一檔案失敗不阻斷其他檔案。
 */
/**
 * 建立掛好 Draco 解碼器的載入器。
 *
 * 模型以 scripts/compress-models.sh 壓縮過（幾何 Draco、貼圖 WebP），
 * 解碼器路徑用相對路徑，網站部署在子路徑（GitHub Pages 的 /PacificPower/）時才找得到。
 * 解碼器是 WASM，同一個實例可重複使用，載完全部再釋放。
 */
function createLoader(): { loader: GLTFLoader; dispose: () => void } {
  const draco = new DRACOLoader().setDecoderPath('draco/')
  const loader = new GLTFLoader().setDRACOLoader(draco)
  return { loader, dispose: () => draco.dispose() }
}

export async function loadParts(
  root: Group,
  onProgress: (p: LoadProgress) => void,
  parts: PartDef[] = PARTS,
): Promise<LoadedPart[]> {
  const { loader, dispose } = createLoader()
  const loaded: LoadedPart[] = []
  let done = 0

  for (const def of parts) {
    try {
      const gltf = await loader.loadAsync(modelUrl(def.file))
      const object = gltf.scene
      object.name = def.id
      // Preserve the exported data-center system colors.
      object.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) {
          o.castShadow = def.kind !== 'site'
          o.receiveShadow = true
        }
      })
      root.add(object)
      loaded.push({ def, object })
      onProgress({ done: ++done, total: parts.length, part: def, loaded })
    } catch (error) {
      onProgress({ done: ++done, total: parts.length, part: def, error, loaded })
    }
  }

  dispose()
  return loaded
}
