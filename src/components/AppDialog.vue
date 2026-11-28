<script setup>
  import { computed, onMounted, ref, useId, watch } from 'vue'

  const props = defineProps({
    title: { type: String, default: '' },
    pages: { type: Array, default: () => [] },
    wide: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    startAtEnd: { type: Boolean, default: false },
  })

  const emit = defineEmits(['close', 'scroll'])
  const titleId = useId()
  const dialog = ref(null)
  const dialogBody = ref(null)
  const pageIndex = ref(0)
  const activePage = computed(() => props.pages[pageIndex.value])
  const hasPagination = computed(() => props.pages.length > 1)

  function goToPage(index) {
    if (index >= 0 && index < props.pages.length) pageIndex.value = index
  }

  watch(
    () => props.pages.length,
    (length) => {
      pageIndex.value = Math.min(pageIndex.value, Math.max(0, length - 1))
    }
  )

  watch(
    pageIndex,
    () => {
      dialogBody.value.scrollTop = 0
    },
    { flush: 'post' }
  )

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
      :class="{
        'app-dialog-paged': hasPagination,
        'app-dialog-wide': wide,
        'app-dialog-compact': compact,
      }"
      :aria-labelledby="titleId"
      @cancel.prevent="close"
      @click.self="close"
    >
      <div class="dialog-frame" :class="{ 'dialog-frame-paged': hasPagination }">
        <header class="dialog-header">
          <div>
            <h2 :id="titleId" :aria-live="hasPagination ? 'polite' : undefined">
              <slot name="title">{{ activePage?.title ?? title }}</slot>
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
        <button
          v-if="hasPagination"
          class="dialog-page-arrow dialog-page-previous"
          type="button"
          aria-label="Previous page"
          :aria-disabled="pageIndex === 0"
          @click="goToPage(pageIndex - 1)"
        ></button>
        <div ref="dialogBody" class="dialog-body" tabindex="0" @scroll="emit('scroll')">
          <slot :name="activePage?.id ?? 'default'" />
        </div>
        <button
          v-if="hasPagination"
          class="dialog-page-arrow dialog-page-next"
          type="button"
          aria-label="Next page"
          :aria-disabled="pageIndex === pages.length - 1"
          @click="goToPage(pageIndex + 1)"
        ></button>
        <nav v-if="hasPagination" class="dialog-page-dots" aria-label="Dialog pages">
          <button
            v-for="(page, index) in pages"
            :key="page.id"
            class="dialog-page-dot"
            type="button"
            :aria-label="`Page ${index + 1} of ${pages.length} – ${page.title}`"
            :aria-current="index === pageIndex ? 'page' : undefined"
            @click="goToPage(index)"
          ></button>
        </nav>
      </div>
      <slot name="overlay" />
    </dialog>
  </Teleport>
</template>
