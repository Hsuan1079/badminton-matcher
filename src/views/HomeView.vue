<script setup>
import { ref, computed } from 'vue'
import { useBadmintonStore } from '../stores/badminton.js'

const store = useBadmintonStore()

// --- Manual selection ---
const manualSelected = ref([])
function toggleManual(playerId) {
  const idx = manualSelected.value.indexOf(playerId)
  if (idx >= 0) {
    manualSelected.value.splice(idx, 1)
  } else if (manualSelected.value.length < 4) {
    manualSelected.value.push(playerId)
  }
}
function startManual() {
  if (manualSelected.value.length !== 4) return
  const [p1, p2, p3, p4] = manualSelected.value
  store.startManualMatch([p1, p2], [p3, p4])
  manualSelected.value = []
  preview.value = null
}

// --- Preview & adjust ---
const preview = ref(null)   // { team1: [id,id], team2: [id,id], courtNumber }
const previewError = ref('')
// which slot is being swapped: { team: 1|2, index: 0|1 } or null
const swapping = ref(null)

function handleGenerateMatch() {
  previewError.value = ''
  const result = store.generateMatch()
  if (!result || result.error) {
    previewError.value = result?.error ?? '配對失敗'
    return
  }
  preview.value = { team1: [...result.team1], team2: [...result.team2], courtNumber: result.courtNumber }
  swapping.value = null
}

function confirmMatch() {
  if (!preview.value) return
  store.startMatch(preview.value.team1, preview.value.team2, preview.value.courtNumber)
  preview.value = null
  swapping.value = null
}

function cancelPreview() {
  preview.value = null
  swapping.value = null
}

// Click a player slot in preview to start swapping
function startSwap(team, index) {
  if (swapping.value?.team === team && swapping.value?.index === index) {
    swapping.value = null
  } else {
    swapping.value = { team, index }
  }
}

// Click someone from the queue to swap them in
function swapFromQueue(playerId) {
  if (!swapping.value || !preview.value) return
  const { team, index } = swapping.value
  const teamKey = team === 1 ? 'team1' : 'team2'

  // If target is already in preview, swap positions
  const inTeam1 = preview.value.team1.indexOf(playerId)
  const inTeam2 = preview.value.team2.indexOf(playerId)

  if (inTeam1 >= 0) {
    // swap with team1[inTeam1]
    const displaced = preview.value[teamKey][index]
    preview.value[teamKey][index] = playerId
    preview.value.team1[inTeam1] = displaced
  } else if (inTeam2 >= 0) {
    const displaced = preview.value[teamKey][index]
    preview.value[teamKey][index] = playerId
    preview.value.team2[inTeam2] = displaced
  } else {
    // From queue: replace slot, push displaced back to queue display (just update preview)
    preview.value[teamKey][index] = playerId
  }

  swapping.value = null
}

// Swap two slots within the preview
function swapSlots(toTeam, toIndex) {
  if (!swapping.value || !preview.value) return
  const { team: fromTeam, index: fromIndex } = swapping.value
  const fromKey = fromTeam === 1 ? 'team1' : 'team2'
  const toKey = toTeam === 1 ? 'team1' : 'team2'

  const tmp = preview.value[fromKey][fromIndex]
  preview.value[fromKey][fromIndex] = preview.value[toKey][toIndex]
  preview.value[toKey][toIndex] = tmp
  swapping.value = null
}

function isSwappingSlot(team, index) {
  return swapping.value?.team === team && swapping.value?.index === index
}

// Players in queue but NOT in the current preview (for swap candidates)
const swapCandidates = computed(() => {
  if (!preview.value) return []
  const inPreview = new Set([...preview.value.team1, ...preview.value.team2])
  return store.queue.filter(e => !inPreview.has(e.playerId))
})

function playerName(id) {
  return store.getPlayer(id)?.name ?? id
}

function formatWait(joinedAt) {
  const mins = Math.floor((Date.now() - joinedAt) / 60000)
  if (mins < 1) return '剛剛'
  if (mins < 60) return `${mins} 分鐘`
  return `${Math.floor(mins / 60)} 小時 ${mins % 60} 分鐘`
}
</script>

<template>
  <!-- Active Courts -->
  <section class="mb-6">
    <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
      進行中 ({{ store.activeMatches.length }}/{{ store.settings.courts }} 場地)
    </h2>

    <div v-if="store.activeMatches.length === 0"
      class="text-gray-400 text-sm py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">
      目前無進行中球局
    </div>

    <!-- Court card -->
    <div v-for="match in store.activeMatches" :key="match.id"
      class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-3">

      <!-- Court header -->
      <div class="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
        <span class="text-xs font-semibold text-blue-600">場地 {{ match.courtNumber }}</span>
        <span class="text-xs text-gray-400">{{ formatWait(match.startedAt) }} 前開始</span>
      </div>

      <!-- Court layout -->
      <div class="relative">
        <!-- Team 1 - top half -->
        <div class="bg-blue-50 px-4 pt-4 pb-6 text-center">
          <div class="text-xs text-blue-400 font-medium mb-2 uppercase tracking-wider">A 隊</div>
          <div class="flex justify-center gap-4">
            <div v-for="id in match.team1" :key="id"
              class="bg-white rounded-xl px-4 py-2 shadow-sm border border-blue-100">
              <span class="font-semibold text-gray-800 text-sm">{{ playerName(id) }}</span>
            </div>
          </div>
        </div>

        <!-- Net line -->
        <div class="relative h-0 flex items-center z-10">
          <div class="absolute inset-x-0 flex items-center px-3">
            <div class="flex-1 h-px bg-gray-300"></div>
            <div class="mx-2 text-xs text-gray-400 font-medium bg-white px-2">球網</div>
            <div class="flex-1 h-px bg-gray-300"></div>
          </div>
        </div>

        <!-- Team 2 - bottom half -->
        <div class="bg-orange-50 px-4 pt-6 pb-4 text-center">
          <div class="flex justify-center gap-4">
            <div v-for="id in match.team2" :key="id"
              class="bg-white rounded-xl px-4 py-2 shadow-sm border border-orange-100">
              <span class="font-semibold text-gray-800 text-sm">{{ playerName(id) }}</span>
            </div>
          </div>
          <div class="text-xs text-orange-400 font-medium mt-2 uppercase tracking-wider">B 隊</div>
        </div>
      </div>

      <div class="px-4 pb-3">
        <button
          @click="store.endMatch(match.id)"
          class="w-full py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition">
          結束球局
        </button>
      </div>
    </div>
  </section>

  <!-- Match Button -->
  <div class="mb-4">
    <button
      @click="handleGenerateMatch"
      :disabled="!store.canMatch"
      class="w-full py-3.5 font-bold text-base rounded-xl transition"
      :class="store.canMatch
        ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-md'
        : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
      {{ store.canMatch ? '開始配對' : store.availableCourts <= 0 ? '目前無空場地' : `需要至少 4 人排隊（目前 ${store.queue.length} 人）` }}
    </button>
    <p v-if="previewError" class="text-red-500 text-sm text-center mt-2">{{ previewError }}</p>
  </div>

  <!-- Match Preview with inline adjustment -->
  <div v-if="preview" class="mb-6 border-2 border-yellow-300 rounded-2xl overflow-hidden">
    <div class="bg-yellow-50 px-4 py-2 flex items-center justify-between border-b border-yellow-200">
      <span class="font-semibold text-yellow-800 text-sm">配對預覽 — 場地 {{ preview.courtNumber }}</span>
      <span class="text-xs text-yellow-600">點選球員可換人</span>
    </div>

    <!-- Preview court layout -->
    <div class="relative">
      <!-- Team 1 -->
      <div class="bg-blue-50 px-4 pt-4 pb-6 text-center">
        <div class="text-xs text-blue-400 font-medium mb-2 uppercase tracking-wider">A 隊</div>
        <div class="flex justify-center gap-4">
          <div
            v-for="(id, idx) in preview.team1" :key="id"
            @click="isSwappingSlot(1, idx) ? (swapping = null) : startSwap(1, idx)"
            class="bg-white rounded-xl px-4 py-2 shadow-sm border cursor-pointer transition select-none"
            :class="isSwappingSlot(1, idx)
              ? 'border-yellow-400 ring-2 ring-yellow-300 bg-yellow-50'
              : 'border-blue-100 hover:border-blue-300'">
            <span class="font-semibold text-gray-800 text-sm">{{ playerName(id) }}</span>
            <div class="text-xs text-yellow-500 mt-0.5" v-if="isSwappingSlot(1, idx)">點隊員換位 ↕</div>
          </div>
        </div>
      </div>

      <!-- Net -->
      <div class="relative h-0 flex items-center z-10">
        <div class="absolute inset-x-0 flex items-center px-3">
          <div class="flex-1 h-px bg-gray-300"></div>
          <div class="mx-2 text-xs text-gray-400 font-medium bg-yellow-50 px-2">球網</div>
          <div class="flex-1 h-px bg-gray-300"></div>
        </div>
      </div>

      <!-- Team 2 -->
      <div class="bg-orange-50 px-4 pt-6 pb-4 text-center">
        <div class="flex justify-center gap-4">
          <div
            v-for="(id, idx) in preview.team2" :key="id"
            @click="isSwappingSlot(2, idx) ? (swapping = null) : startSwap(2, idx)"
            class="bg-white rounded-xl px-4 py-2 shadow-sm border cursor-pointer transition select-none"
            :class="isSwappingSlot(2, idx)
              ? 'border-yellow-400 ring-2 ring-yellow-300 bg-yellow-50'
              : 'border-orange-100 hover:border-orange-300'">
            <span class="font-semibold text-gray-800 text-sm">{{ playerName(id) }}</span>
            <div class="text-xs text-yellow-500 mt-0.5" v-if="isSwappingSlot(2, idx)">點隊員換位 ↕</div>
          </div>
        </div>
        <div class="text-xs text-orange-400 font-medium mt-2 uppercase tracking-wider">B 隊</div>
      </div>
    </div>

    <!-- Swap candidates from queue (shown when a slot is selected) -->
    <div v-if="swapping" class="border-t border-yellow-200 bg-white px-4 py-3">
      <div class="text-xs text-gray-500 mb-2">
        選擇要換入的球員（也可點上方隊員互換位置）
      </div>

      <!-- Other preview players for cross-team swap -->
      <div class="flex flex-wrap gap-2 mb-2">
        <template v-for="(id, idx) in preview.team1" :key="'t1-'+idx">
          <button
            v-if="!(swapping.team === 1 && swapping.index === idx)"
            @click="swapSlots(1, idx)"
            class="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition">
            {{ playerName(id) }} (A隊)
          </button>
        </template>
        <template v-for="(id, idx) in preview.team2" :key="'t2-'+idx">
          <button
            v-if="!(swapping.team === 2 && swapping.index === idx)"
            @click="swapSlots(2, idx)"
            class="px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 transition">
            {{ playerName(id) }} (B隊)
          </button>
        </template>
      </div>

      <!-- Queue candidates -->
      <div v-if="swapCandidates.length > 0">
        <div class="text-xs text-gray-400 mb-1">從排隊池換入：</div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="entry in swapCandidates" :key="entry.id"
            @click="swapFromQueue(entry.playerId)"
            class="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 transition">
            {{ playerName(entry.playerId) }}
          </button>
        </div>
      </div>
      <div v-else-if="swapCandidates.length === 0 && store.queue.filter(e => ![...preview.team1,...preview.team2].includes(e.playerId)).length === 0"
        class="text-xs text-gray-400">
        排隊池無其他球員可換入
      </div>
    </div>

    <!-- Confirm / Cancel -->
    <div class="flex gap-2 px-4 py-3 border-t border-yellow-200 bg-yellow-50">
      <button
        @click="confirmMatch"
        class="flex-1 py-2.5 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-semibold rounded-xl transition">
        確認上場
      </button>
      <button
        @click="cancelPreview"
        class="flex-1 py-2.5 bg-white border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition">
        取消
      </button>
    </div>
  </div>

  <!-- Queue -->
  <section>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        排隊中 ({{ store.queue.length }} 人)
      </h2>
      <span v-if="manualSelected.length > 0" class="text-xs text-blue-600 font-medium">
        已選 {{ manualSelected.length }}/4 人
      </span>
    </div>

    <div v-if="store.queue.length === 0"
      class="text-gray-400 text-sm py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">
      目前無人排隊
    </div>

    <div
      v-for="(entry, index) in store.queue" :key="entry.id"
      @click="toggleManual(entry.playerId)"
      class="flex items-center rounded-xl shadow-sm border px-4 py-3 mb-2 cursor-pointer transition select-none"
      :class="manualSelected.includes(entry.playerId)
        ? 'bg-blue-50 border-blue-300'
        : 'bg-white border-gray-100 hover:border-gray-300'">

      <!-- Selection badge -->
      <span
        class="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 transition"
        :class="manualSelected.includes(entry.playerId)
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-400'">
        {{ manualSelected.includes(entry.playerId) ? manualSelected.indexOf(entry.playerId) + 1 : index + 1 }}
      </span>

      <span class="flex-1 font-semibold text-gray-800 ml-2">{{ playerName(entry.playerId) }}</span>
      <span class="text-xs text-gray-400 mr-3">{{ entry.sessionGamesPlayed }} 場</span>
      <span class="text-xs text-gray-400 mr-2">{{ formatWait(entry.joinedAt) }}</span>
      <button
        @click.stop="store.dequeue(entry.playerId)"
        class="text-gray-300 hover:text-red-400 transition text-lg leading-none ml-1"
        title="移除排隊">
        ×
      </button>
    </div>

    <!-- Manual start button -->
    <div v-if="manualSelected.length > 0" class="mt-3">
      <div v-if="manualSelected.length === 4" class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 text-sm text-blue-700">
        A 隊：{{ playerName(manualSelected[0]) }} & {{ playerName(manualSelected[1]) }}<br>
        B 隊：{{ playerName(manualSelected[2]) }} & {{ playerName(manualSelected[3]) }}
      </div>
      <div class="flex gap-2">
        <button
          @click="startManual"
          :disabled="manualSelected.length !== 4"
          class="flex-1 py-3 font-bold rounded-xl transition"
          :class="manualSelected.length === 4
            ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'">
          {{ manualSelected.length === 4 ? '上場' : `再選 ${4 - manualSelected.length} 人` }}
        </button>
        <button
          @click="manualSelected = []"
          class="px-4 py-3 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition text-sm">
          清除
        </button>
      </div>
    </div>
  </section>
</template>
