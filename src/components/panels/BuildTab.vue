<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import AssemblyPanel from './AssemblyPanel.vue'
import ExportPanel from './ExportPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:assembly" title="Assembly" class="px-4">
      <AssemblyPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:export" title="Export" class="px-4">
      <ExportPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
