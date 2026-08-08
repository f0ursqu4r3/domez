<script setup lang="ts">
import { computed } from 'vue'
import { useDomeProject, MATERIALS } from '@/composables/useDomeProject'
import { JOINT_METHODS } from '@/engine/cutlist'
import type { Fraction, Frequency } from '@/engine/types'
import { formatLength } from '@/engine/units'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Zap } from '@lucide/vue'

const project = useDomeProject()
const { state, increments, availableStock, jointMethod, diameter, endOffset, kerf, riserHeight } =
  project

const frequency = computed({
  get: () => String(state.frequency),
  set: (v: string) => (state.frequency = Number(v) as Frequency),
})
const fraction = computed({
  get: () => state.fraction,
  set: (v: string) => (state.fraction = v as Fraction),
})
const unitLabel = computed(() => (state.units === 'imperial' ? 'ft' : 'm'))
const smallUnit = computed(() => (state.units === 'imperial' ? 'in' : 'mm'))
const increment = computed({
  get: () => String(state.increment),
  set: (v: string) => (state.increment = Number(v)),
})
const best = computed(() => state.optimizer.result?.best ?? null)
</script>

<template>
  <div class="flex flex-col gap-5 p-4">
    <section>
      <h3 class="section-title">Geometry</h3>
      <FieldGroup class="gap-4">
        <Field>
          <FieldLabel>Frequency</FieldLabel>
          <ToggleGroup v-model="frequency" type="single" variant="outline" class="w-full">
            <ToggleGroupItem
              v-for="f in ['3', '4', '5', '6']"
              :key="f"
              :value="f"
              class="flex-1 font-mono"
            >
              {{ f }}V
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Sphere fraction</FieldLabel>
          <ToggleGroup v-model="fraction" type="single" variant="outline" class="w-full">
            <ToggleGroupItem
              v-for="fr in ['3/8', '1/2', '5/8']"
              :key="fr"
              :value="fr"
              class="flex-1 font-mono"
            >
              {{ fr }}
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            Snaps to the nearest clean ring — actual
            <span class="font-mono text-foreground"
              >{{ (project.summary.value.actualFraction * 100).toFixed(1) }}%</span
            >
            of sphere height.
          </FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel class="flex-1">Leveled base ring</FieldLabel>
          <Switch
            :model-value="state.baseMode === 'leveled'"
            @update:model-value="(v: boolean) => (state.baseMode = v ? 'leveled' : 'natural')"
          />
        </Field>
        <Field>
          <FieldLabel
            >Riser wall <span class="text-muted-foreground">({{ smallUnit }})</span></FieldLabel
          >
          <Input
            type="number"
            step="1"
            min="0"
            class="font-mono"
            :disabled="state.baseMode !== 'leveled'"
            :model-value="riserHeight"
            @update:model-value="
              (v) => {
                const n = Number(v)
                if (n >= 0) riserHeight = n
              }
            "
          />
          <FieldDescription>
            {{
              state.baseMode === 'leveled'
                ? 'Stud-framed knee wall under the base ring — 0 for none. Doors cut through it; plates, studs, and sheathing join the takeoff.'
                : 'Level the base to add a riser wall.'
            }}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel
            >Diameter <span class="text-muted-foreground">({{ unitLabel }})</span></FieldLabel
          >
          <Input
            type="number"
            :step="state.units === 'imperial' ? 0.125 : 0.05"
            min="1"
            :model-value="diameter"
            class="font-mono"
            @update:model-value="
              (v) => {
                const n = Number(v)
                if (n > 0) diameter = n
              }
            "
          />
        </Field>
        <Field>
          <FieldLabel>Units</FieldLabel>
          <ToggleGroup
            :model-value="state.units"
            type="single"
            variant="outline"
            class="w-full"
            @update:model-value="(v: any) => v && (state.units = v)"
          >
            <ToggleGroupItem value="imperial" class="flex-1">Imperial</ToggleGroupItem>
            <ToggleGroupItem value="metric" class="flex-1">Metric</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </FieldGroup>
    </section>

    <Separator />

    <section>
      <h3 class="section-title">Material &amp; joints</h3>
      <FieldGroup class="gap-4">
        <Field>
          <FieldLabel>Strut material</FieldLabel>
          <Select v-model="state.materialId">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="m in MATERIALS" :key="m.id" :value="m.id">{{
                  m.label
                }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{{ project.material.value.profile }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Joint method</FieldLabel>
          <Select v-model="state.jointId">
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="j in JOINT_METHODS" :key="j.id" :value="j.id">{{
                  j.label
                }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{{ jointMethod.note }}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Panel skin</FieldLabel>
          <ToggleGroup
            :model-value="state.panelPlacement"
            type="single"
            variant="outline"
            class="w-full"
            @update:model-value="(v: any) => v && (state.panelPlacement = v)"
          >
            <ToggleGroupItem value="outside" class="flex-1 text-xs">Outside</ToggleGroupItem>
            <ToggleGroupItem value="inside" class="flex-1 text-xs">Inside</ToggleGroupItem>
            <ToggleGroupItem value="both" class="flex-1 text-xs">Both</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            Which strut face the skin mounts to — both doubles the sheet takeoff.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel
            >End offset per strut end
            <span class="text-muted-foreground">({{ smallUnit }})</span></FieldLabel
          >
          <Input
            type="number"
            step="0.05"
            min="0"
            class="font-mono"
            :model-value="endOffset"
            @update:model-value="
              (v) => {
                const n = Number(v)
                if (n >= 0) endOffset = n
              }
            "
          />
        </Field>
      </FieldGroup>
    </section>

    <Separator />

    <section>
      <h3 class="section-title">Fabrication</h3>
      <FieldGroup class="gap-4">
        <Field>
          <FieldLabel>Cut rounding</FieldLabel>
          <Select v-model="increment">
            <SelectTrigger class="w-full font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                  v-for="inc in increments"
                  :key="inc.label"
                  :value="String(inc.value)"
                  class="font-mono"
                >
                  {{ inc.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel
            >Saw kerf <span class="text-muted-foreground">({{ smallUnit }})</span></FieldLabel
          >
          <Input
            type="number"
            step="0.05"
            min="0"
            class="font-mono"
            :model-value="kerf"
            @update:model-value="
              (v) => {
                const n = Number(v)
                if (n >= 0) kerf = n
              }
            "
          />
        </Field>
        <Field>
          <FieldLabel>Available stock</FieldLabel>
          <div class="flex flex-col gap-2">
            <label
              v-for="s in availableStock"
              :key="s.label"
              class="flex items-center justify-between rounded-md border border-border px-3 py-1.5"
            >
              <span class="font-mono text-sm">{{ s.label }}</span>
              <Switch
                :model-value="!state.disabledStock[s.label]"
                @update:model-value="(v: boolean) => (state.disabledStock[s.label] = !v)"
              />
            </label>
          </div>
        </Field>
      </FieldGroup>
    </section>

    <Separator />

    <section>
      <h3 class="section-title">Diameter optimizer</h3>
      <FieldGroup class="gap-4">
        <div class="flex gap-3">
          <Field class="flex-1">
            <FieldLabel>Min ({{ unitLabel }})</FieldLabel>
            <Input
              type="number"
              class="font-mono"
              :model-value="state.optimizer.min"
              @update:model-value="(v) => (state.optimizer.min = Number(v))"
            />
          </Field>
          <Field class="flex-1">
            <FieldLabel>Max ({{ unitLabel }})</FieldLabel>
            <Input
              type="number"
              class="font-mono"
              :model-value="state.optimizer.max"
              @update:model-value="(v) => (state.optimizer.max = Number(v))"
            />
          </Field>
        </div>
        <Button :disabled="state.optimizer.running" @click="project.runOptimizer()">
          <Zap data-icon="inline-start" />
          Search cleanest diameter
        </Button>
        <div
          v-if="best"
          class="rounded-md border border-primary/40 bg-primary/5 p-3 flex flex-col gap-1.5"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs uppercase tracking-widest text-muted-foreground"
              >Best diameter</span
            >
            <Badge variant="secondary" class="font-mono"
              >{{ best.diameterDisplay.toFixed(3) }} {{ unitLabel }}</Badge
            >
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            max cut error
            <span class="font-mono text-foreground">{{
              formatLength(best.maxRoundingError, state.units)
            }}</span>
            · waste
            <span class="font-mono text-foreground"
              >{{ (best.wasteFraction * 100).toFixed(1) }}%</span
            >
            · <span class="font-mono text-foreground">{{ best.boardsNeeded }}</span> boards ·
            {{ state.optimizer.result!.evaluated }} candidates
          </p>
          <Button size="sm" variant="outline" @click="project.applyOptimizedDiameter()"
            >Apply diameter</Button
          >
        </div>
      </FieldGroup>
    </section>
  </div>
</template>
