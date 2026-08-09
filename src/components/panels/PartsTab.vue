<script setup lang="ts">
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Separator } from '@/components/ui/separator'
import StrutsPanel from './StrutsPanel.vue'
import HubsPanel from './HubsPanel.vue'
</script>

<template>
  <div class="flex flex-col pt-3 pb-4">
    <CollapsibleSection id="right:struts" title="Struts" class="px-4">
      <StrutsPanel class="-mx-4" />
    </CollapsibleSection>
    <Separator class="my-3" />
    <CollapsibleSection id="right:hubs" title="Hubs" class="px-4">
      <HubsPanel class="-mx-4" />
    </CollapsibleSection>
  </div>
</template>
