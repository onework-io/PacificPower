import * as THREE from 'three'

/**
 * 依 animation/0911_TSMC.mp4 的分鏡重建的相機路徑。
 *
 * MP4 只保存像素，不含原始 DCC 相機座標；以下鏡位用場景框景尺度正規化，
 * 讓模型改版後仍能維持相近的全景、設備近景與完工環繞節奏。
 */
interface CameraKeyframe {
  at: number
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  fov: number
}

export interface CameraTourPose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

/**
 * 保留既有影片運鏡的觀看方向，但把鏡頭焦點移到當下施工構件。
 * 距離依構件包圍盒與畫面比例計算，讓構件完整入鏡並保留少量周邊環境。
 */
export function focusCameraTour(
  base: CameraTourPose,
  box: THREE.Box3,
  sceneSpan: number,
  aspect = 1,
): CameraTourPose {
  if (box.isEmpty()) return {
    position: base.position.clone(),
    target: base.target.clone(),
    fov: base.fov,
  }

  const size = box.getSize(new THREE.Vector3())
  const target = box.getCenter(new THREE.Vector3())
  const fov = Math.min(base.fov, 44)
  const halfV = THREE.MathUtils.degToRad(fov) / 2
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 0.25))
  const horizontalRadius = Math.hypot(size.x, size.z) / 2
  const requiredDistance = Math.max(
    horizontalRadius / Math.tan(halfH),
    size.y / 2 / Math.tan(halfV),
    size.length() * 0.55,
  )
  const distance = Math.max(requiredDistance * 1.3, Math.max(sceneSpan, 1) * 0.08)
  const direction = base.position.clone().sub(base.target)
  if (direction.lengthSq() < 1e-8) direction.set(0.75, 0.55, 0.75)

  return {
    position: target.clone().add(direction.normalize().multiplyScalar(distance)),
    target,
    fov,
  }
}

export const CAMERA_TOUR_KEYFRAMES: readonly CameraKeyframe[] = [
  { at: 0, position: [0.88, 0.62, 0.92], target: [0, -0.08, 0], fov: 49 },
  { at: 0.08, position: [0.18, 1.02, 0.82], target: [0, -0.18, 0], fov: 48 },
  { at: 0.17, position: [-0.82, 0.48, 0.72], target: [0, -0.12, 0], fov: 47 },
  { at: 0.27, position: [-0.28, 0.82, -0.88], target: [0.04, 0.02, 0], fov: 45 },
  { at: 0.38, position: [0.76, 0.38, -0.62], target: [0.04, -0.06, -0.02], fov: 46 },
  { at: 0.49, position: [0.46, 0.26, -0.36], target: [0.02, -0.1, 0], fov: 43 },
  { at: 0.6, position: [-0.54, 0.3, 0.48], target: [0.08, -0.1, 0.02], fov: 44 },
  { at: 0.71, position: [-0.36, 0.22, -0.38], target: [0.03, -0.08, 0], fov: 42 },
  { at: 0.8, position: [0.1, 0.3, 0.52], target: [0, -0.08, 0], fov: 47 },
  { at: 0.9, position: [0.72, 0.46, 0.82], target: [0, -0.08, 0], fov: 50 },
  { at: 1, position: [0.9, 0.56, 0.9], target: [0, -0.08, 0], fov: 50 },
]

const smootherstep = (v: number) => v * v * v * (v * (v * 6 - 15) + 10)

export function sampleCameraTour(progress: number, span: number): CameraTourPose {
  const p = THREE.MathUtils.clamp(progress, 0, 1)
  let left = CAMERA_TOUR_KEYFRAMES[0]
  let right = CAMERA_TOUR_KEYFRAMES[CAMERA_TOUR_KEYFRAMES.length - 1]

  for (let i = 1; i < CAMERA_TOUR_KEYFRAMES.length; i += 1) {
    if (p <= CAMERA_TOUR_KEYFRAMES[i].at) {
      left = CAMERA_TOUR_KEYFRAMES[i - 1]
      right = CAMERA_TOUR_KEYFRAMES[i]
      break
    }
  }

  const local = right.at === left.at ? 0 : smootherstep((p - left.at) / (right.at - left.at))
  const scaled = Math.max(span, 1)
  const position = new THREE.Vector3(...left.position)
    .lerp(new THREE.Vector3(...right.position), local)
    .multiplyScalar(scaled)
  const target = new THREE.Vector3(...left.target)
    .lerp(new THREE.Vector3(...right.target), local)
    .multiplyScalar(scaled)

  return { position, target, fov: THREE.MathUtils.lerp(left.fov, right.fov, local) }
}
