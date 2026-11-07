import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { Group, MathUtils, Object3D, Vector3 } from 'three'
import { SceneKit } from '@/three/SceneKit'
import { PartRegistry } from '@/three/PartRegistry'
import { framingBox, loadParts, type LoadedPart } from '@/three/ModelLoader'
import { PARTS, SHELL_PART_ID } from '@/data/parts'
import { useViewerStore } from '@/stores/viewer'
import { usePoiStore } from '@/stores/poi'
import { PoiLayer } from '@/three/PoiLayer'
import { createTechGrid, type TechGrid } from '@/three/techGrid'
import { Box3 } from 'three'
import { focusCameraTour, sampleCameraTour } from '@/three/cameraTour'

/** 爆炸係數每幀趨近目標值的比例，讓拖曳滑桿時是滑順的而非跳動 */
const EASE = 0.15

/**
 * 把 SceneKit / PartRegistry 綁到 Vue 生命週期，並把 store 狀態同步進 3D 場景。
 */
export function useViewer(host: Ref<HTMLElement | null>) {
  const store = useViewerStore()
  const poiStore = usePoiStore()
  const fatal = ref<string | null>(null)
  /** 展開中的 POI 卡片要釘在畫布上的哪個像素位置；不可見時為 null */
  const activePoiScreen = ref<{ x: number; y: number } | null>(null)

  let kit: SceneKit | null = null
  let registry: PartRegistry | null = null
  let poiLayer: PoiLayer | null = null
  let techGrid: TechGrid | null = null
  let partObjects = new Map<string, Object3D>()
  /** 貼在地面高度的平板（機房地板、地坪本身），可獨立於構件顯示切換 */
  let groundSlabs: Object3D[] = []
  let groundPartId: string | null = null
  let currentFactor = 0
  let framingSpan = 20
  let currentCameraProgress: number | null = null
  const scratch = new Vector3()
  const focusBox = new Box3()

  async function boot() {
    try {
      kit = new SceneKit(host.value!)
    } catch (e) {
      fatal.value = `無法建立 WebGL 場景：${e instanceof Error ? e.message : String(e)}`
      return
    }

    const loaded: LoadedPart[] = await loadParts(kit.root as Group, (p) => {
      store.setStatus(p.part.id, p.error ? 'failed' : 'ready')
      store.loadedCount = p.done
      if (p.error) console.error(`載入失敗：${p.part.file}`, p.error)
      // 邊載邊框景，畫面不會等到最後才動
      if (kit) {
        kit.root.updateMatrixWorld(true)
        const box = framingBox(p.loaded, kit.root)
        framingSpan = box.getSize(new Vector3()).length() || framingSpan
        kit.frame(box)
      }
    })

    if (!kit) return
    if (loaded.length === 0) {
      fatal.value = '所有模型都載入失敗，請確認 public/models 指向 3D/ 資料夾。'
      return
    }

    kit.root.updateMatrixWorld(true)
    const finalBox = framingBox(loaded, kit.root)
    framingSpan = finalBox.getSize(new Vector3()).length() || framingSpan
    kit.frame(finalBox)
    kit.root.updateMatrixWorld(true)
    registry = new PartRegistry(loaded)
    if (!PARTS.some((p) => p.id === 'site')) installTechGrid(loaded)
    applyAll()

    partObjects = new Map<string, Object3D>(loaded.map((l) => [l.def.id, l.object]))
    poiLayer = new PoiLayer(partObjects, (id) => {
      poiStore.activeId = id
    })
    poiLayer.sync(poiStore.pois)
    if (store.freeFocusRequest) focusFreeCamera(store.freeFocusRequest.partId)

    kit.setFrameCallback(() => {
      poiLayer?.update()
      updateActivePoiScreen()
      registry?.updateHighlightAnimation(performance.now() * 0.001)

      const tourTarget = store.cameraTourEnabled && !store.freeCameraMode ? store.cameraTourProgress : null
      if (tourTarget !== null && kit) {
        currentCameraProgress ??= tourTarget
        currentCameraProgress += (tourTarget - currentCameraProgress) * 0.09
        if (Math.abs(tourTarget - currentCameraProgress) < 0.0001) currentCameraProgress = tourTarget
        const basePose = sampleCameraTour(currentCameraProgress, framingSpan)
        const focusObject = store.cameraFocusPartId
          ? partObjects.get(store.cameraFocusPartId)
          : null
        const pose = focusObject
          ? focusCameraTour(
              basePose,
              focusBox.setFromObject(focusObject),
              framingSpan,
              kit.camera.aspect,
            )
          : basePose
        kit.controls.enabled = false
        // 從目前鏡位平順靠近新工項，避免跨工項時相機瞬間跳動。
        kit.camera.position.lerp(pose.position, 0.085)
        kit.controls.target.lerp(pose.target, 0.085)
        kit.camera.fov = MathUtils.lerp(kit.camera.fov, pose.fov, 0.085)
        kit.camera.updateProjectionMatrix()
        kit.camera.lookAt(pose.target)
      } else if (kit) {
        if (!kit.controls.enabled) kit.controls.enabled = true
        currentCameraProgress = null
      }

      const target = store.explodeFactor
      if (Math.abs(currentFactor - target) > 0.0005) {
        currentFactor += (target - currentFactor) * EASE
        registry?.setExplodeFactor(currentFactor)
      } else if (currentFactor !== target) {
        currentFactor = target
        registry?.setExplodeFactor(currentFactor)
      }
    })
  }

  /**
   * 在建築完成面上建立科技風格格線地坪。
   *
   * 格線直接掛在場景 root 之下，**不掛在地坪構件底下**——那樣會讓格線跟著
   * 側欄「地坪」的勾選一起消失。地坪的 GLB 預設不顯示（見 stores/viewer 的
   * 初始 visible 集合），格線則恆常存在。
   *
   * 必須在 PartRegistry 建立之後才加入，否則自訂 shader 材質會被
   * 隔離用的透明度處理當成一般材質複製與改寫。
   */
  function installTechGrid(loaded: LoadedPart[]) {
    const ground = loaded.find((l) => l.def.kind === 'site')
    const shell = loaded.find((l) => l.def.kind === 'shell')
    if ((!ground && !shell) || !kit) return

    // 格線位於場景 root 底下，座標必須換回模型座標。
    // setFromObject 拿到的是世界座標（已含 root 的置中位移），要換算回來。
    const toModel = kit.root.getWorldPosition(new Vector3()).negate()
    const top = ground
      ? new Box3().setFromObject(ground.object).translate(toModel).max.y
      : inferFloorTop(shell!.object, toModel)
    if (top === null) return

    // 建築模型內含結構樓板與完成面，會蓋住格線。
    // 收集大型薄板後交給「機房地板」切換鈕控制。
    groundSlabs = collectGroundSlabs(loaded, top, toModel)
    setGroundSlabsVisible(store.roomFloor)

    // 格線以設備群為中心淡出，而非以 170m 地坪自身的中心。
    // framingBox 傳入 root 時回傳的就是模型座標，不需要再換算。
    const center = framingBox(loaded, kit.root).getCenter(new Vector3())

    groundPartId = ground?.def.id ?? null
    techGrid = createTechGrid(top, { center })
    kit.root.add(techGrid.group)
    syncGridBase()
  }

  /**
   * 新版模型把地板併入「建築.glb」，不再另附 ground.glb。
   * 從建築底部附近的大型薄板推導完成面高程，避免把模型座標寫死在程式裡。
   */
  function inferFloorTop(shell: Object3D, toModel: Vector3): number | null {
    const shellBox = new Box3().setFromObject(shell).translate(toModel)
    if (shellBox.isEmpty()) return null

    let top: number | null = null
    shell.traverse((o) => {
      if (!(o as { isMesh?: boolean }).isMesh) return
      const b = new Box3().setFromObject(o).translate(toModel)
      const size = b.getSize(new Vector3())
      const nearBottom = b.min.y < shellBox.min.y + 0.5
      if (size.y <= 0.25 && size.x > 2 && size.z > 2 && nearBottom) {
        top = Math.max(top ?? -Infinity, b.max.y)
      }
    })
    return top
  }

  /**
   * 找出貼在地面高度的平板：厚度趨近 0、且上緣落在地坪高程附近。
   * 用幾何條件判斷而非寫死材質或節點名稱，模型改版時比較不會失效。
   */
  function collectGroundSlabs(
    loaded: LoadedPart[],
    groundTop: number,
    toModel: Vector3,
  ): Object3D[] {
    const found: Object3D[] = []
    for (const { def, object } of loaded) {
      if (def.kind === 'site') continue // 地坪本身已整個隱藏
      object.traverse((o) => {
        if (!(o as { isMesh?: boolean }).isMesh) return
        const b = new Box3().setFromObject(o).translate(toModel)
        const thickness = b.max.y - b.min.y
        const onGround = Math.abs(b.max.y - groundTop) < 0.3
        const large = b.max.x - b.min.x > 2 && b.max.z - b.min.z > 2
        if (thickness <= 0.2 && onGround && large) found.push(o)
      })
    }
    return found
  }

  function setGroundSlabsVisible(on: boolean) {
    for (const o of groundSlabs) o.visible = on
  }

  /**
   * 格線底板只是用來接陰影的。使用者把原本的地坪 GLB 開回來時要關掉它，
   * 否則兩片共面的平板會 z-fighting 出現條紋；地坪本身就會接陰影。
   */
  function syncGridBase() {
    if (!techGrid) return
    techGrid.base.visible = groundPartId ? !store.isVisible(groundPartId) : !store.roomFloor
  }

  function applyAll() {
    if (!registry) return
    for (const p of PARTS) registry.setVisible(p.id, store.isVisible(p.id))
    registry.setIsolated(store.isolatedId)
    registry.setHighlighted(store.highlightedIds)
    registry.setShellGhost(store.shellGhost)
    registry.setProgressFilter(store.progressFilter)
    registry.setSimulationFocus(store.cameraFocusPartId)
  }

  /** 每幀更新卡片位置，讓它跟著 3D 點走 */
  function updateActivePoiScreen() {
    const id = poiStore.activeId
    if (!id || !kit || !poiLayer) {
      if (activePoiScreen.value !== null) activePoiScreen.value = null
      return
    }
    const world = poiLayer.worldPosition(id, scratch)
    const next = world ? kit.project(world) : null
    const prev = activePoiScreen.value
    // 只在真的移動時寫入，避免每幀觸發 Vue 更新
    if (!next) {
      if (prev !== null) activePoiScreen.value = null
      return
    }
    if (!prev || Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5) {
      activePoiScreen.value = next
    }
  }

  function resetView() {
    // 「重設視角」同時退出影片運鏡；立即開回控制器，避免等到下一個 render frame
    // 才能拖曳，讓使用者在播放進度仍持續時也能自由檢視模型。
    store.unlockCamera()
    currentCameraProgress = null
    if (kit) kit.controls.enabled = true

    // 回到全模型總覽，但尊重使用者對外牆的兩個獨立選擇：隱藏狀態與透視狀態。
    const shellWasVisible = store.isVisible(SHELL_PART_ID)
    store.showAll()
    if (!shellWasVisible) store.setVisible(SHELL_PART_ID, false)
    store.highlightedIds = new Set()
    store.progressFilterSuppressed = true
    store.progressFilter = null
    store.freeFocusRequest = null
    kit?.resetView()
  }

  /** 一次性框選構件；完成後 OrbitControls 保持啟用，使用者可自由旋轉與縮放。 */
  function focusFreeCamera(partId: string) {
    if (!kit) return
    const object = partObjects.get(partId)
    if (!object) return
    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return

    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const span = size.length() || framingSpan * 0.15
    const halfV = MathUtils.degToRad(kit.camera.fov) / 2
    const halfH = Math.atan(Math.tan(halfV) * kit.camera.aspect)
    const halfWidth = Math.hypot(size.x, size.z) / 2
    const distance = Math.max(
      halfWidth / Math.tan(halfH),
      size.y / 2 / Math.tan(halfV),
      span,
    ) * 1.45
    const direction = kit.camera.position.clone().sub(kit.controls.target)
    if (direction.lengthSq() < 0.0001) direction.set(0.75, 0.55, 0.75)
    direction.normalize()

    currentCameraProgress = null
    kit.controls.enabled = true
    kit.controls.target.copy(center)
    kit.camera.position.copy(center).add(direction.multiplyScalar(distance))
    kit.controls.minDistance = Math.max(span * 0.12, 0.1)
    kit.controls.maxDistance = Math.max(span * 12, framingSpan * 2)
    kit.camera.lookAt(center)
    kit.controls.update()
  }

  /**
   * 在模型表面新增 POI。
   * 命中點是世界座標，要轉成所屬構件的區域座標，POI 才會跟著構件移動。
   */
  function placePoiAt(clientX: number, clientY: number): boolean {
    if (!kit) return false
    const hit = kit.pick(clientX, clientY)
    if (!hit) return false

    // 由命中的 mesh 往上找到構件根節點（loadParts 已把 object.name 設為 partId）
    let node: Object3D | null = hit.object
    while (node && !PARTS.some((p) => p.id === node!.name)) node = node.parent
    if (!node) return false

    const local = node.worldToLocal(hit.point.clone())
    poiStore.add(node.name, [local.x, local.y, local.z])
    return true
  }

  onMounted(boot)

  watch(
    () => store.visible,
    () => {
      if (!registry) return
      for (const p of PARTS) registry.setVisible(p.id, store.isVisible(p.id))
      syncGridBase()
    },
    { deep: true },
  )

  watch(
    () => store.isolatedId,
    (id) => registry?.setIsolated(id),
  )

  watch(
    () => store.highlightedIds,
    (ids) => registry?.setHighlighted(ids),
    { deep: true },
  )

  watch(
    () => store.shellGhost,
    (on) => registry?.setShellGhost(on),
  )

  watch(
    () => store.progressFilter,
    (ids) => registry?.setProgressFilter(ids),
  )

  watch(
    () => store.cameraFocusPartId,
    (id) => registry?.setSimulationFocus(id),
  )

  watch(
    () => store.freeFocusRequest,
    (request) => {
      if (request) focusFreeCamera(request.partId)
    },
  )

  watch(
    () => store.roomFloor,
    (on) => {
      setGroundSlabsVisible(on)
      syncGridBase()
    },
  )

  watch(
    () => poiStore.pois,
    (list) => poiLayer?.sync(list),
    { deep: true },
  )

  watch(
    () => poiStore.activeId,
    (id) => {
      poiLayer?.setActive(id)
      updateActivePoiScreen()
    },
  )

  onBeforeUnmount(() => {
    kit?.setFrameCallback(null)
    poiLayer?.disposeAll()
    poiLayer = null
    techGrid?.dispose()
    techGrid = null
    groundSlabs = []
    partObjects.clear()
    registry?.dispose()
    kit?.dispose()
    kit = null
    registry = null
  })

  return { fatal, resetView, placePoiAt, activePoiScreen }
}
