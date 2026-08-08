<script setup lang="ts">
import { useDomeProject } from '@/composables/useDomeProject'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PencilRuler, Tag } from '@lucide/vue'

const { assemblyPlan, exporters } = useDomeProject()
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <div class="flex items-center justify-between">
      <h3 class="section-title mb-0">Assembly — base up</h3>
      <div class="flex gap-1.5">
        <Button size="sm" variant="outline" @click="exporters.assemblyGuide()">
          <PencilRuler data-icon="inline-start" />
          Print guide
        </Button>
        <Button size="sm" variant="outline" @click="exporters.labelsSvg()">
          <Tag data-icon="inline-start" />
          Hub labels
        </Button>
      </div>
    </div>
    <ol class="flex flex-col gap-2">
      <li
        v-for="course in assemblyPlan.courses"
        :key="course.index"
        class="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-sm">
            <span class="text-primary font-mono">{{
              String(course.index + 1).padStart(2, '0')
            }}</span>
            {{
              course.index === 0
                ? 'Base ring'
                : course.index === assemblyPlan.courses.length - 1
                  ? 'Apex'
                  : `Course ${course.index + 1}`
            }}
          </span>
          <span class="text-xs font-mono text-muted-foreground"
            >{{ course.hubIds.length }} hubs</span
          >
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Badge
            v-for="(count, label) in course.strutTally"
            :key="label"
            variant="secondary"
            class="font-mono"
          >
            {{ count }}× {{ label }}
          </Badge>
        </div>
        <p class="text-xs text-muted-foreground">
          {{ course.riserStrutIds.length }} risers from below ·
          {{ course.ringStrutIds.length }} in-course struts
        </p>
      </li>
    </ol>
    <p class="text-xs text-muted-foreground leading-relaxed">
      Raise course by course: stand the risers from the ring below, then close the course's own
      ring. Print hub labels and tape each hub's pattern to its plate before the build day.
    </p>
  </div>
</template>
