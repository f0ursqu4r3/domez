<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDomeProject } from '@/composables/useDomeProject'
import { buildDomeGroup, type DomePickMaps } from '@/lib/three-builders'

const { state, model, radius, strutSectionWorking, openingGroups, paintFace } = useDomeProject()

const container = ref<HTMLDivElement | null>(null)
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let domeGroup: THREE.Group | null = null
let groundGroup: THREE.Group | null = null
let raf = 0
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
    strutSection: state.trueSize ? strutSectionWorking.value : undefined,
    openings: state.openings,
    highlightFaces,
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
  const grid = new THREE.PolarGridHelper(r * 1.6, 12, 8, 48, 0x2a3648, 0x1a2230)
  grid.position.y = -0.001 * r
  groundGroup.add(grid)
  scene.add(groundGroup)
}

function frameCamera() {
  if (!camera || !controls) return
  const r = radius.value
  if (scene) scene.fog = new THREE.Fog(0x0a0e15, r * 6, r * 24)
  camera.position.set(r * 2.1, r * 1.35, r * 2.1)
  camera.near = r / 100
  camera.far = r * 40
  camera.updateProjectionMatrix()
  controls.target.set(0, r * (model.value.unitHeight / 2 - Math.max(0, -model.value.cutZ)) * 0.9, 0)
  controls.update()
}

function onPointerDown(ev: PointerEvent) {
  downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }
}

function onPointerUp(ev: PointerEvent) {
  // Only treat as click when the pointer barely moved (not an orbit drag).
  if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return
  if (!renderer || !camera || !domeGroup) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const pick = domeGroup.userData.pick as DomePickMaps

  // Opening tool active: clicks paint panels instead of selecting parts.
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

  const meshes: THREE.Object3D[] = [...pick.strutMaps.keys()]
  if (pick.hubMesh) meshes.push(pick.hubMesh)
  const hits = raycaster.intersectObjects(meshes, false)
  const hit = hits[0]
  if (!hit || hit.instanceId === undefined) {
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

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera) return
    const w = el.clientWidth
    const h = el.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(el)

  const loop = () => {
    raf = requestAnimationFrame(loop)
    controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  loop()
})

watch([model, radius], () => {
  rebuildDome()
  rebuildGround()
  frameCamera()
})
watch(
  () => [
    state.viewMode,
    state.explode,
    state.selection,
    state.trueSize,
    strutSectionWorking.value,
    state.openings,
    state.highlightOpening,
  ],
  () => rebuildDome(),
  { deep: true },
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
