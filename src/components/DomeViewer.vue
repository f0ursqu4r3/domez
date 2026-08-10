<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDomeProject } from '@/composables/useDomeProject'
import { buildDomeGroup, type DomePickMaps } from '@/lib/three-builders'
import { gridSpec } from '@/lib/scale'
import { buildFigure, FIGURE_HEIGHT } from '@/lib/figure'

const {
  state,
  model,
  radius,
  strutSectionWorking,
  workingEndOffset,
  openingGroups,
  paintFace,
  addDoorAt,
  addWindowAt,
  doorway,
  riser,
  workingRiserHeight,
  loadsResult,
} = useDomeProject()

const container = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let domeGroup: THREE.Group | null = null
let groundGroup: THREE.Group | null = null
let figureGroup: THREE.Group | null = null
let raf = 0
// The camera actually rendered/raycast against — the perspective camera by
// default, swapped to planCamera while in plan view.
let currentCamera: THREE.Camera | null = null
let planCamera: THREE.OrthographicCamera | null = null
let planHalfExtent = 0
let savedView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
let resizeObserver: ResizeObserver | null = null
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let downAt = { x: 0, y: 0, t: 0 }

function disposeGroup(g: THREE.Group) {
  g.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
      obj.geometry.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m) => m.dispose())
    }
  })
}

function rebuildDome() {
  if (!scene) return
  if (domeGroup) {
    scene.remove(domeGroup)
    disposeGroup(domeGroup)
  }
  const highlightFaces = state.highlightOpening
    ? openingGroups.value.find((g) => g.label === state.highlightOpening)?.faceIds
    : undefined
  domeGroup = buildDomeGroup(model.value, radius.value, {
    mode: state.viewMode,
    explode: state.explode,
    selection: state.selection,
    strutSection: state.trueSize && state.viewMode !== 'loads' ? strutSectionWorking.value : undefined,
    openings: state.openings,
    highlightFaces,
    doorway: doorway.value,
    closeDoorways: state.closeDoorways,
    panelPlacement: state.panelPlacement,
    riser: riser.value,
    jointId: state.jointId,
    endOffset: workingEndOffset.value,
    loads:
      state.viewMode === 'loads' && loadsResult.value.ok
        ? loadsResult.value.members.map((m) => ({ forceN: m.forceN, utilization: m.utilization }))
        : undefined,
  })
  scene.add(domeGroup)
}

function rebuildGround() {
  if (!scene) return
  if (groundGroup) {
    scene.remove(groundGroup)
    disposeGroup(groundGroup)
  }
  groundGroup = new THREE.Group()
  const r = radius.value
  const spec = gridSpec(r, state.units)
  const grid = new THREE.PolarGridHelper(spec.radius, 12, spec.rings, 48, 0x2a3648, 0x1a2230)
  // The floor sits at the foundation: the base plane, dropped by the riser.
  const groundY = model.value.cutZ * r - workingRiserHeight.value - 0.001 * r
  grid.position.y = groundY
  groundGroup.add(grid)

  const h = FIGURE_HEIGHT[state.units]
  figureGroup = buildFigure(h)
  // +z reads as front-left from the default diagonal camera: the figure
  // stands before the dome, clear of the strut-legend overlay at the right.
  figureGroup.position.set(
    0,
    groundY,
    Math.max(model.value.unitBaseRadius, 0.9) * r * 1.1 + 0.2 * h,
  )
  figureGroup.visible = state.showFigure && state.viewMode !== 'plan'
  groundGroup.add(figureGroup)
  scene.add(groundGroup)
}

function updateProjection(r: number) {
  if (!camera) return
  if (scene) scene.fog = new THREE.Fog(0x0a0e15, r * 6, r * 24)
  camera.near = r / 100
  camera.far = r * 40
  camera.updateProjectionMatrix()
}

/** Initial framing only — later parameter changes preserve the user's orbit. */
function frameCamera() {
  if (!camera || !controls) return
  const r = radius.value
  updateProjection(r)
  // 2.35 keeps the scale figure (at ~1.1× base radius) inside the frame.
  camera.position.set(r * 2.35, r * 1.35, r * 2.35)
  controls.target.set(0, r * (model.value.cutZ + model.value.unitHeight / 2), 0)
  controls.update()
}

/** On radius change (diameter edit, unit flip) scale the orbit with the
 * dome so the view stays put instead of resetting. */
let prevRadius = 0
function adjustCameraForRadius() {
  if (!camera || !controls) return
  const r = radius.value
  if (prevRadius > 0 && Math.abs(r - prevRadius) > 1e-9) {
    const scale = r / prevRadius
    camera.position.multiplyScalar(scale)
    controls.target.multiplyScalar(scale)
    // The saved plan-entry view must track radius changes made while in plan mode.
    if (savedView) {
      savedView.position.multiplyScalar(scale)
      savedView.target.multiplyScalar(scale)
    }
    updateProjection(r)
    controls.update()
  }
  prevRadius = r
}

/** True top-down orthographic frustum, fit to the dome's footprint. Called
 * on entering plan mode and whenever the dome's size changes while in it. */
function applyPlanCamera() {
  if (!container.value) return
  const el = container.value
  const r = radius.value
  const e = gridSpec(r, state.units).radius * 1.05
  planHalfExtent = e
  const aspect = el.clientWidth / el.clientHeight
  if (!planCamera) {
    planCamera = new THREE.OrthographicCamera(-e * aspect, e * aspect, e, -e, r * 0.01, r * 10)
  } else {
    planCamera.left = -e * aspect
    planCamera.right = e * aspect
    planCamera.top = e
    planCamera.bottom = -e
    planCamera.near = r * 0.01
    planCamera.far = r * 10
  }
  planCamera.position.set(0, r * 4, 0)
  planCamera.up.set(0, 0, -1)
  planCamera.lookAt(0, 0, 0)
  planCamera.updateProjectionMatrix()
}

function onPointerDown(ev: PointerEvent) {
  downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }
}

function onPointerUp(ev: PointerEvent) {
  // Only treat as click when the pointer barely moved (not an orbit drag).
  if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return
  if (!renderer || !currentCamera || !domeGroup) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, currentCamera)
  const pick = domeGroup.userData.pick as DomePickMaps

  // Door/window tools: place a parametric opening at the clicked spot.
  if (state.openingTool === 'door' || state.openingTool === 'window') {
    const targets: THREE.Object3D[] = [
      ...pick.panelMaps.keys(),
      ...pick.strutMaps.keys(),
      ...pick.strutFaceMaps.keys(),
    ]
    const hit = raycaster.intersectObjects(targets, false)[0]
    if (hit) {
      // three (x, z, -y) -> engine azimuth atan2(y, x) = atan2(-z, x).
      const azimuthDeg = (Math.atan2(-hit.point.z, hit.point.x) * 180) / Math.PI
      if (state.openingTool === 'door') {
        addDoorAt(azimuthDeg)
      } else {
        // Window centers on the clicked height, measured from the FLOOR
        // (the foundation when a riser is active; three y == engine z).
        const heightAboveFloor =
          hit.point.y - (model.value.cutZ * radius.value - workingRiserHeight.value)
        const mmPerWorking = state.units === 'imperial' ? 25.4 : 1
        addWindowAt(azimuthDeg, heightAboveFloor * mmPerWorking)
      }
    }
    return
  }

  // Paint tools: clicks assign panels instead of selecting parts.
  if (state.openingTool !== 'off') {
    const panelHits = raycaster.intersectObjects([...pick.panelMaps.keys()], false)
    const panelHit = panelHits[0]
    if (panelHit && panelHit.faceIndex != null) {
      const map = pick.panelMaps.get(panelHit.object as THREE.Mesh)
      const faceId = map?.[panelHit.faceIndex]
      if (faceId !== undefined) paintFace(faceId)
    }
    return
  }

  const meshes: THREE.Object3D[] = [...pick.strutMaps.keys(), ...pick.strutFaceMaps.keys()]
  if (pick.hubMesh) meshes.push(pick.hubMesh)
  const hits = raycaster.intersectObjects(meshes, false)
  const hit = hits[0]
  if (!hit) {
    state.selection = null
    return
  }
  const faceMap = pick.strutFaceMaps.get(hit.object as THREE.Mesh)
  if (faceMap && hit.faceIndex != null) {
    state.selection = { kind: 'strut', edgeId: faceMap[hit.faceIndex] }
    return
  }
  if (hit.instanceId === undefined) {
    state.selection = null
    return
  }
  if (hit.object === pick.hubMesh) {
    state.selection = { kind: 'hub', vertexId: pick.hubMap[hit.instanceId] }
  } else {
    const map = pick.strutMaps.get(hit.object as THREE.InstancedMesh)
    if (map) state.selection = { kind: 'strut', edgeId: map[hit.instanceId] }
  }
}

onMounted(() => {
  const el = container.value!
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a0e15)
  scene.fog = new THREE.Fog(0x0a0e15, radius.value * 6, radius.value * 24)

  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 5000)
  currentCamera = camera
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight)
  el.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.55

  scene.add(new THREE.HemisphereLight(0x8fa3bf, 0x131a24, 0.9))
  const key = new THREE.DirectionalLight(0xfff2dd, 1.6)
  key.position.set(3, 5, 2)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x74a8ff, 0.5)
  rim.position.set(-4, 2, -3)
  scene.add(rim)

  rebuildGround()
  rebuildDome()
  frameCamera()
  prevRadius = radius.value

  // A share link or restored project may open directly into plan mode.
  if (state.viewMode === 'plan') {
    applyPlanCamera()
    if (planCamera && controls) {
      currentCamera = planCamera
      controls.object = planCamera
      controls.target.set(0, 0, 0)
      controls.enableRotate = false
      controls.update()
    }
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)

  resizeObserver = new ResizeObserver(() => {
    if (!renderer) return
    const w = el.clientWidth
    const h = el.clientHeight
    const aspect = w / h
    if (camera) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    if (planCamera && state.viewMode === 'plan') {
      planCamera.left = -planHalfExtent * aspect
      planCamera.right = planHalfExtent * aspect
      planCamera.updateProjectionMatrix()
    }
    renderer.setSize(w, h)
  })
  resizeObserver.observe(el)

  const loop = () => {
    raf = requestAnimationFrame(loop)
    controls?.update()
    if (figureGroup && currentCamera) {
      figureGroup.rotation.y = Math.atan2(
        currentCamera.position.x - figureGroup.position.x,
        currentCamera.position.z - figureGroup.position.z,
      )
    }
    if (renderer && scene && currentCamera) renderer.render(scene, currentCamera)
  }
  loop()
})

watch([model, radius, workingRiserHeight], () => {
  rebuildDome()
  rebuildGround()
  adjustCameraForRadius()
  if (state.viewMode === 'plan') applyPlanCamera()
})
// Reset-to-defaults re-frames the view from scratch.
watch(
  () => state.viewResetToken,
  () => {
    frameCamera()
    prevRadius = radius.value
  },
)
watch(
  () => [
    state.viewMode,
    state.explode,
    state.selection,
    state.trueSize,
    strutSectionWorking.value,
    state.openings,
    state.highlightOpening,
    doorway.value,
    state.closeDoorways,
    state.panelPlacement,
    riser.value,
    state.jointId,
    workingEndOffset.value,
    state.viewMode === 'loads' ? loadsResult.value : null,
  ],
  () => rebuildDome(),
  { deep: true },
)
watch(
  () => [state.showFigure, state.viewMode] as const,
  ([show, mode]) => {
    if (figureGroup) figureGroup.visible = show && mode !== 'plan'
  },
)
// Swap the active camera between the perspective view and a true top-down
// orthographic projection, preserving the perspective orbit to restore later.
watch(
  () => state.viewMode,
  (mode, prevMode) => {
    if (mode === 'plan' && prevMode !== 'plan') {
      if (camera && controls) {
        savedView = { position: camera.position.clone(), target: controls.target.clone() }
      }
      applyPlanCamera()
      if (planCamera && controls) {
        currentCamera = planCamera
        controls.object = planCamera
        controls.target.set(0, 0, 0)
        controls.enableRotate = false
        controls.update()
      }
    } else if (prevMode === 'plan' && mode !== 'plan') {
      if (camera && controls) {
        currentCamera = camera
        controls.object = camera
        if (savedView) {
          camera.position.copy(savedView.position)
          controls.target.copy(savedView.target)
        }
        controls.enableRotate = true
        controls.update()
      }
    }
  },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
  renderer?.domElement.removeEventListener('pointerdown', onPointerDown)
  renderer?.domElement.removeEventListener('pointerup', onPointerUp)
  if (domeGroup) disposeGroup(domeGroup)
  if (groundGroup) disposeGroup(groundGroup)
  controls?.dispose()
  renderer?.dispose()
})
</script>

<template>
  <div ref="container" class="size-full min-h-0 cursor-crosshair" />
</template>
