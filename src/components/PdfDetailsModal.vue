<!-- PdfDetailsModal.vue -->
<script setup>
import { onMounted, onUnmounted } from 'vue';

const props = defineProps({
  open: { type: Boolean, required: true },
  filename: { type: String, default: 'bdo-solver-notes.pdf' },
});
const emit = defineEmits(['close']);

// Resolves correctly on both localhost and GitHub Pages subpaths
const pdfUrl = `${import.meta.env.BASE_URL}${props.filename}`;
const embedUrl = `${pdfUrl}#view=FitH`;

function onKeydown(e) {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pdf-backdrop" @click.self="emit('close')">
      <div class="pdf-modal">
        <div class="pdf-header">
          <span class="pdf-title">BDO Worker Empire Solver — Notes</span>
          <div class="pdf-actions">
            <a :href="pdfUrl" target="_blank" rel="noopener" class="pdf-btn">
              Open in New Tab
            </a>
            <a :href="pdfUrl" download class="pdf-btn">Download</a>
            <button class="pdf-btn pdf-close" @click="emit('close')">✕</button>
          </div>
        </div>

        <!-- Lazy-mounted via v-if on parent, so the PDF only downloads when clicked -->
        <iframe
          :src="embedUrl"
          class="pdf-frame"
          title="Solver Technical Notes"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pdf-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.pdf-modal {
  width: min(1000px, 92vw);
  height: 88vh;
  background: #1e222a;
  border: 1px solid #383e4a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
}

.pdf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #161920;
  border-bottom: 1px solid #2e3440;
  color: #e5e9f0;
  font-size: 14px;
}

.pdf-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.pdf-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #434c5e;
  background: #2e3440;
  color: #eceff4;
  text-decoration: none;
  cursor: pointer;
  font-size: 12px;
}

.pdf-btn:hover {
  background: #3b4252;
}

.pdf-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: #2b2f38;
}
</style>