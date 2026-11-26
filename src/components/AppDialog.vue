<script setup>
  import { onMounted, ref, useId } from 'vue'

  const props = defineProps({
    title: { type: String, required: true },
    wide: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    startAtEnd: { type: Boolean, default: false },
  })

  const emit = defineEmits(['close', 'scroll'])
  const titleId = useId()
  const dialog = ref(null)
  const dialogBody = ref(null)

  function close() {
    dialog.value.close()
    emit('close')
  }

  onMounted(() => {
    dialog.value.showModal()
    if (props.startAtEnd) dialogBody.value.scrollTop = dialogBody.value.scrollHeight
  })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="app-dialog"
      :class="{ 'app-dialog-wide': wide, 'app-dialog-compact': compact }"
      :aria-labelledby="titleId"
      @cancel.prevent="close"
      @click.self="close"
    >
      <div class="dialog-frame">
        <header class="dialog-header">
          <div>
            <h2 :id="titleId">
              <slot name="title">{{ title }}</slot>
            </h2>
            <p v-if="$slots.subtitle" class="dialog-subtitle"><slot name="subtitle" /></p>
          </div>
          <button
            class="action-button dialog-close"
            type="button"
            aria-label="Close"
            autofocus
            @click="close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div ref="dialogBody" class="dialog-body" tabindex="0" @scroll="emit('scroll')">
          <slot />
        </div>
      </div>
      <slot name="overlay" />
    </dialog>
  </Teleport>
</template>
