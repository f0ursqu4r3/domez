<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject } from '@/composables/useDomeProject'
import { formatLength } from '@/engine/units'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TriangleAlert } from '@lucide/vue'

const project = useDomeProject()
const { state, model, loadsResult, radius } = project

const imperial = computed(() => state.units === 'imperial')
// Stored SI (kPa, kg/m²); displayed psf / lb·ft² in imperial.
const PSF_PER_KPA = 20.8854
const LBFT2_PER_KGM2 = 0.204816
const pressureField = (key: 'snowKPa' | 'windKPa') =>
  computed({
    get: () =>
      Number(
        (imperial.value ? state.loadInputs[key] * PSF_PER_KPA : state.loadInputs[key]).toFixed(2),
      ),
    set: (v: number) => {
      if (v >= 0) state.loadInputs[key] = imperial.value ? v / PSF_PER_KPA : v
    },
  })
const snow = pressureField('snowKPa')
const wind = pressureField('windKPa')
const skin = computed({
  get: () =>
    Number(
      (imperial.value
        ? state.loadInputs.skinKgM2 * LBFT2_PER_KGM2
        : state.loadInputs.skinKgM2
      ).toFixed(2),
    ),
  set: (v: number) => {
    if (v >= 0) state.loadInputs.skinKgM2 = imperial.value ? v / LBFT2_PER_KGM2 : v
  },
})
const pUnit = computed(() => (imperial.value ? 'psf' : 'kPa'))
const dUnit = computed(() => (imperial.value ? 'lb/ft²' : 'kg/m²'))

const force = (n: number) =>
  imperial.value ? `${Math.abs(n * 0.224809).toFixed(0)} lbf` : `${Math.abs(n).toFixed(0)} N`

const worst = computed(() => {
  const r = loadsResult.value
  if (!r.ok) return []
  return [...r.members].sort((a, b) => b.utilization - a.utilization).slice(0, 10)
})
const upliftCount = computed(() => {
  const r = loadsResult.value
  return r.ok ? r.reactions.filter((x) => x.uplift).length : 0
})
const maxReaction = computed(() => {
  const r = loadsResult.value
  return r.ok ? Math.max(...r.reactions.map((x) => Math.abs(x.fN[2]))) : 0
})
const utilClass = (u: number) =>
  u >= 1 ? 'text-destructive' : u >= 0.7 ? 'text-amber-500' : 'text-emerald-500'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:load-inputs" title="Load inputs" class="px-4">
      <FieldGroup class="gap-4 pt-1">
        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel>Snow ({{ pUnit }})</FieldLabel>
            <Input
              :model-value="snow"
              type="number"
              min="0"
              step="1"
              class="font-mono"
              @update:model-value="(v) => (snow = Number(v))"
            />
          </Field>
          <Field class="flex-1">
            <FieldLabel>Wind ({{ pUnit }})</FieldLabel>
            <Input
              :model-value="wind"
              type="number"
              min="0"
              step="1"
              class="font-mono"
              @update:model-value="(v) => (wind = Number(v))"
            />
          </Field>
        </div>
        <Field>
          <FieldLabel>Panel skin ({{ dUnit }})</FieldLabel>
          <Input
            :model-value="skin"
            type="number"
            min="0"
            step="0.1"
            class="font-mono"
            @update:model-value="(v) => (skin = Number(v))"
          />
        </Field>
      </FieldGroup>
    </CollapsibleSection>

    <Separator class="my-3" />

    <CollapsibleSection id="right:load-results" title="Results" class="px-4">
      <Alert v-if="!loadsResult.ok && loadsResult.reason === 'unsupported-family'">
        <TriangleAlert />
        <AlertTitle>Pin-frame is a mechanism</AlertTitle>
        <AlertDescription>
          A pin-jointed {{ state.mode === 'zome' ? 'zome' : 'hex/pent' }} frame is not rigid — the
          panels (stressed skin) carry the shape. Frame-only numbers would be meaningless — skin
          analysis is out of scope.
        </AlertDescription>
      </Alert>
      <Alert v-else-if="!loadsResult.ok" variant="destructive">
        <TriangleAlert />
        <AlertTitle>Not self-supporting</AlertTitle>
        <AlertDescription>
          The frame is not self-supporting as a pin-jointed truss.
        </AlertDescription>
      </Alert>
      <template v-else>
        <div class="grid grid-cols-3 gap-2">
          <div
            class="rounded-md border px-3 py-2"
            :class="
              loadsResult.maxUtilization >= 1
                ? 'border-destructive/60 bg-destructive/5'
                : loadsResult.maxUtilization >= 0.7
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-border bg-card'
            "
          >
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Max util</div>
            <div class="font-mono text-lg">
              {{ (loadsResult.maxUtilization * 100).toFixed(0) }}%
            </div>
          </div>
          <div class="rounded-md border border-border bg-card px-3 py-2">
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Weight</div>
            <div class="font-mono text-lg">{{ force(loadsResult.totalWeightN) }}</div>
          </div>
          <div class="rounded-md border border-border bg-card px-3 py-2">
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Uplift</div>
            <div class="font-mono text-lg">{{ upliftCount }} hubs</div>
          </div>
        </div>

        <div class="mt-3 flex flex-col gap-1">
          <h4 class="text-xs uppercase tracking-widest text-muted-foreground">Worst members</h4>
          <div
            v-for="m in worst"
            :key="m.edgeId"
            class="grid grid-cols-[3rem_1fr_5rem_4rem_3rem] items-baseline gap-2 rounded-md border border-border px-2.5 py-1 font-mono text-[11px]"
          >
            <span class="font-semibold">{{ model.strutTypes[model.edges[m.edgeId].typeId].label }}</span>
            <span class="text-muted-foreground">
              {{ formatLength(model.edges[m.edgeId].chordFactor * radius, state.units) }}
            </span>
            <span>{{ force(m.forceN) }} {{ m.forceN >= 0 ? 'T' : 'C' }}</span>
            <span :class="utilClass(m.utilization)">{{ (m.utilization * 100).toFixed(0) }}%</span>
            <span class="text-muted-foreground">{{ m.caseLabel }}</span>
          </div>
        </div>

        <p class="mt-2 text-xs text-muted-foreground">
          Max base reaction {{ force(maxReaction) }} vertical ·
          {{ upliftCount > 0 ? `${upliftCount} hubs need hold-down anchors` : 'no uplift' }}
        </p>
        <p v-if="state.materialId === 'pvc-1'" class="mt-1 text-xs text-amber-500">
          PVC creeps under sustained load — treat capacity as short-term only.
        </p>
      </template>
    </CollapsibleSection>

    <Separator class="my-3" />

    <p class="px-4 text-xs text-muted-foreground leading-relaxed">
      Educational estimate. Pin joints, intact frame (openings not modeled — door bucks must
      restore the cut members' load path), simplified wind, no code load combinations. Not a
      substitute for a structural engineer.
    </p>
  </div>
</template>
