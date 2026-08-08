<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { FileSpreadsheet, RotateCcw } from '@lucide/vue'

const project = useDomeProject()
const { state, costEstimate } = project

const money = (v: number) =>
  `${state.currency}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <section>
      <h3 class="section-title">Cost estimate</h3>
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-md border border-border bg-card px-3 py-2">
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Total</div>
          <div class="font-mono text-lg">~{{ money(costEstimate.total) }}</div>
        </div>
        <div class="rounded-md border border-border bg-card px-3 py-2">
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">
            Per {{ state.units === 'imperial' ? 'ft²' : 'm²' }} floor
          </div>
          <div class="font-mono text-lg">{{ money(costEstimate.perArea) }}</div>
        </div>
        <div
          class="rounded-md border px-3 py-2"
          :class="
            costEstimate.unpricedCount > 0
              ? 'border-destructive/60 bg-destructive/5'
              : 'border-border bg-card'
          "
        >
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Unpriced</div>
          <div class="font-mono text-lg">{{ costEstimate.unpricedCount }}</div>
        </div>
      </div>
      <p class="mt-2 text-xs text-muted-foreground leading-relaxed">
        Shipped prices are rough US estimates — edit any line with your local numbers. Unpriced
        lines are excluded from the total.
      </p>
    </section>

    <Separator />

    <section>
      <div class="flex items-center justify-between">
        <h3 class="section-title mb-0">Materials &amp; hardware</h3>
        <div class="flex items-center gap-2">
          <Input
            class="h-7 w-12 font-mono text-center"
            maxlength="3"
            title="Currency symbol"
            :model-value="state.currency"
            @update:model-value="(v) => (state.currency = String(v).slice(0, 3) || '$')"
          />
          <Button size="sm" variant="ghost" class="text-xs" @click="project.resetPrices()">
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
        </div>
      </div>
      <div class="mt-2 flex flex-col gap-1">
        <div
          v-for="l in costEstimate.lines"
          :key="l.key + l.label"
          class="grid grid-cols-[1fr_auto_4.5rem_5rem] items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
        >
          <span class="min-w-0">
            {{ l.label }}
            <span v-if="l.note" class="text-muted-foreground"> · {{ l.note }}</span>
          </span>
          <span class="font-mono text-muted-foreground whitespace-nowrap">×{{ l.quantity }}</span>
          <Input
            v-if="l.key !== 'glue-seam'"
            type="number"
            min="0"
            step="0.01"
            class="h-7 font-mono text-right"
            :model-value="l.priceEach || ''"
            @update:model-value="(v) => project.setPrice(l.key, Number(v))"
          />
          <span v-else />
          <span class="text-right font-mono whitespace-nowrap">
            <Badge v-if="l.unpriced" variant="destructive" class="text-[10px]">unpriced</Badge>
            <template v-else-if="l.key !== 'glue-seam'">{{ money(l.total) }}</template>
          </span>
        </div>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        Valence lines (e.g. 6-way hubs) share one unit price per hardware kind.
      </p>
    </section>

    <Button variant="outline" class="w-full" @click="project.exporters.costsCsv()">
      <FileSpreadsheet data-icon="inline-start" />
      Costs CSV
    </Button>
  </div>
</template>
