<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import MaterialsPanel from './MaterialsPanel.vue'
import CostsPanel from './CostsPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:sheets" title="Sheets & boards" class="px-4">
      <MaterialsPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:costs" title="Costs" class="px-4">
      <CostsPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
