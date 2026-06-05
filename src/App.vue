<script setup>
import { RouterView, RouterLink, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Top Nav -->
    <nav class="bg-blue-600 text-white shadow-md">
      <div class="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <span class="font-bold text-lg tracking-wide">🏸 MoonㄣLight</span>
        <div class="flex gap-4 text-sm font-medium">
          <RouterLink
            to="/"
            class="px-3 py-1 rounded-full transition"
            :class="route.path === '/' ? 'bg-white text-blue-600' : 'hover:bg-blue-500'"
          >
            主頁
          </RouterLink>
          <RouterLink
            to="/admin"
            class="px-3 py-1 rounded-full transition"
            :class="route.path === '/admin' ? 'bg-white text-blue-600' : 'hover:bg-blue-500'"
          >
            管理
          </RouterLink>
        </div>
      </div>
    </nav>

    <main class="max-w-2xl mx-auto px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
