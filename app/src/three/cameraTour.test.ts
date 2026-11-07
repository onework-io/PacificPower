import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { CAMERA_TOUR_KEYFRAMES, focusCameraTour, sampleCameraTour } from './cameraTour'

describe('影片參考運鏡', () => {
  it('關鍵幀涵蓋完整流程且時間嚴格遞增', () => {
    expect(CAMERA_TOUR_KEYFRAMES[0].at).toBe(0)
    expect(CAMERA_TOUR_KEYFRAMES.at(-1)!.at).toBe(1)
    for (let i = 1; i < CAMERA_TOUR_KEYFRAMES.length; i += 1) {
      expect(CAMERA_TOUR_KEYFRAMES[i].at).toBeGreaterThan(CAMERA_TOUR_KEYFRAMES[i - 1].at)
    }
  })

  it('超出範圍的播放位置會夾在首尾鏡位', () => {
    expect(sampleCameraTour(-1, 20).position.toArray()).toEqual(
      sampleCameraTour(0, 20).position.toArray(),
    )
    expect(sampleCameraTour(2, 20).position.toArray()).toEqual(
      sampleCameraTour(1, 20).position.toArray(),
    )
  })

  it('相機距離會隨場景尺度等比例調整', () => {
    const small = sampleCameraTour(0.5, 10)
    const large = sampleCameraTour(0.5, 20)
    expect(large.position.length()).toBeCloseTo(small.position.length() * 2)
    expect(large.target.length()).toBeCloseTo(small.target.length() * 2)
  })

  it('可保留原運鏡方向並靠近當下施工構件', () => {
    const base = sampleCameraTour(0.5, 100)
    const box = new Box3(new Vector3(9, 1, -4), new Vector3(11, 3, -2))
    const focused = focusCameraTour(base, box, 100, 1.6)

    expect(focused.target.toArray()).toEqual([10, 2, -3])
    expect(focused.position.distanceTo(focused.target)).toBeLessThan(
      base.position.distanceTo(base.target),
    )
    const focusedDirection = focused.position.clone().sub(focused.target).normalize()
    const baseDirection = base.position.clone().sub(base.target).normalize()
    expect(focusedDirection.angleTo(baseDirection)).toBeCloseTo(0, 10)
  })

  it('空包圍盒會安全沿用原鏡位', () => {
    const base = sampleCameraTour(0.25, 20)
    const focused = focusCameraTour(base, new Box3(), 20)
    expect(focused.position.toArray()).toEqual(base.position.toArray())
    expect(focused.target.toArray()).toEqual(base.target.toArray())
  })
})
