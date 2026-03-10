<script setup lang="ts">
import { ref } from 'vue'
import XdogExtractor from './components/XdogExtractor.vue'
import PsLineExtractor from './components/PsLineExtractor.vue'

const activeTab = ref<'xdog' | 'ps'>('xdog')
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="title">
        <h1>P2Line 线稿提取工具</h1>
      </div>
      <nav class="tabs">
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'xdog' }" 
          @click="activeTab = 'xdog'"
        >
          XDOG 算法
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'ps' }" 
          @click="activeTab = 'ps'"
        >
          PS 风格算法
        </button>
      </nav>
    </header>

    <main class="app-content">
      <KeepAlive>
        <component :is="activeTab === 'xdog' ? XdogExtractor : PsLineExtractor" />
      </KeepAlive>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.title h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.tabs {
  display: flex;
  gap: 8px;
  background: #f1f5f9;
  padding: 4px;
  border-radius: 8px;
}

.tab-btn {
  border: none;
  background: transparent;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: #0f172a;
  background: rgba(255, 255, 255, 0.5);
}

.tab-btn.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.app-content {
  min-height: 600px;
}
</style>
