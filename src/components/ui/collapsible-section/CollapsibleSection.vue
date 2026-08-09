<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { ChevronDown } from '@lucide/vue'
import { useUiState } from '@/composables/useUiState'

const props = defineProps<{
  /** Stable persistence key, e.g. 'left:geometry'. */
  id: string
  title: string
}>()
const ui = useUiState()
</script>

<template>
  <CollapsibleRoot
    :open="ui.isOpen(props.id)"
    @update:open="(v: boolean) => ui.setOpen(props.id, v)"
  >
    <h3 class="section-title mb-0">
      <CollapsibleTrigger class="group flex w-full cursor-pointer items-center gap-2 text-left">
        <span class="flex-1 uppercase">{{ props.title }}</span>
        <slot name="badge" />
        <ChevronDown
          aria-hidden="true"
          class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90"
        />
      </CollapsibleTrigger>
    </h3>
    <CollapsibleContent class="collapsible-body">
      <div class="pt-3"><slot /></div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
