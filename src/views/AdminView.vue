<script setup>
import { ref } from 'vue'
import { useBadmintonStore } from '../stores/badminton.js'

const store = useBadmintonStore()

// --- Admin auth ---
const isAuthed = ref(sessionStorage.getItem('bm_admin') === '1')
const passwordInput = ref('')
const passwordError = ref('')
function submitPassword() {
  if (passwordInput.value === store.settings.admin_password) {
    sessionStorage.setItem('bm_admin', '1')
    isAuthed.value = true
    passwordError.value = ''
  } else {
    passwordError.value = '密碼錯誤'
  }
}
function logout() {
  sessionStorage.removeItem('bm_admin')
  isAuthed.value = false
}

// Add player
const newPlayerName = ref('')
async function addPlayer() {
  const name = newPlayerName.value.trim()
  if (!name) return
  await store.addPlayer(name)
  newPlayerName.value = ''
}

// Batch import
const batchText = ref('')
const batchResult = ref('')
const batchLoading = ref(false)
async function batchImport() {
  batchLoading.value = true
  const lines = batchText.value.split('\n')
  const toAdd = []
  let skipped = 0
  for (const line of lines) {
    const name = line.replace(/^\d+\.?\s*/, '').trim()
    if (!name) continue
    if (store.players.some(p => p.name === name)) { skipped++; continue }
    toAdd.push(name)
  }
  await Promise.all(toAdd.map(name => store.addPlayer(name)))
  batchResult.value = `新增 ${toAdd.length} 人${skipped ? `，${skipped} 人已存在略過` : ''}`
  batchText.value = ''
  batchLoading.value = false
}
const showBatch = ref(false)

// Enqueue all players at once
function enqueueAll() {
  store.players.forEach(p => store.enqueue(p.id))
}

// Clear all players
const confirmClear = ref(false)
function clearAllPlayers() {
  store.players.slice().forEach(p => store.removePlayer(p.id))
  confirmClear.value = false
}

// Settings
const courtsInput = ref(store.settings.courts)
function saveCourts() {
  const n = parseInt(courtsInput.value)
  if (n >= 1 && n <= 10) store.updateSettings({ courts: n })
}

function playerName(id) {
  return store.getPlayer(id)?.name ?? id
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}

// Tab
const tab = ref('players')
</script>

<template>
  <!-- Password gate -->
  <div v-if="!isAuthed" class="flex flex-col items-center justify-center min-h-[60vh] gap-4">
    <div class="text-2xl">🔒</div>
    <h2 class="text-lg font-semibold text-gray-700">管理員登入</h2>
    <div class="w-full max-w-xs">
      <input
        v-model="passwordInput"
        type="password"
        placeholder="輸入密碼"
        @keyup.enter="submitPassword"
        class="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400 mb-2"
      />
      <p v-if="passwordError" class="text-red-500 text-xs mb-2">{{ passwordError }}</p>
      <button @click="submitPassword"
        class="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition">
        進入
      </button>
    </div>
  </div>

  <template v-else>
  <!-- Tabs -->
  <div class="flex bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
    <button
      v-for="t in [{ id: 'players', label: '球員' }, { id: 'history', label: '歷史' }, { id: 'settings', label: '設定' }]"
      :key="t.id"
      @click="tab = t.id"
      class="flex-1 py-2.5 text-sm font-medium transition"
      :class="tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- Players Tab -->
  <section v-if="tab === 'players'">
    <!-- Add player -->
    <div class="flex gap-2 mb-3">
      <input
        v-model="newPlayerName"
        @keyup.enter="addPlayer"
        placeholder="輸入球員姓名"
        class="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
      />
      <button
        @click="addPlayer"
        class="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl text-sm hover:bg-blue-700 active:bg-blue-800 transition"
      >
        新增
      </button>
    </div>

    <!-- Batch import -->
    <div class="mb-4">
      <button
        @click="showBatch = !showBatch"
        class="text-sm text-blue-600 hover:underline"
      >
        {{ showBatch ? '▲ 收起' : '▼ 批次匯入名單' }}
      </button>

      <div v-if="showBatch" class="mt-2">
        <p class="text-xs text-gray-400 mb-2">
          貼上名單，格式：每行一人，可附編號（如 <code class="bg-gray-100 px-1 rounded">1 N</code>、<code class="bg-gray-100 px-1 rounded">11 邱（準時到）</code>）
        </p>
        <textarea
          v-model="batchText"
          placeholder="1 N&#10;2 烜&#10;3 文&#10;..."
          rows="8"
          class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 font-mono"
        />
        <div class="flex gap-2 mt-2 items-center">
          <button
            @click="batchImport"
            :disabled="!batchText.trim() || batchLoading"
            class="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition disabled:bg-gray-200 disabled:text-gray-400"
          >
            {{ batchLoading ? '匯入中…' : '匯入' }}
          </button>
          <span v-if="batchResult" class="text-sm text-green-600">{{ batchResult }}</span>
        </div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-3">
      <span class="text-sm text-gray-500">共 {{ store.players.length }} 位球員</span>
      <div class="flex gap-2">
        <button
          @click="enqueueAll"
          class="text-xs px-3 py-1.5 bg-green-50 text-green-700 font-medium rounded-lg border border-green-200 hover:bg-green-100 transition"
        >
          全部報到
        </button>
        <button
          v-if="!confirmClear"
          @click="confirmClear = true"
          class="text-xs px-3 py-1.5 bg-red-50 text-red-500 font-medium rounded-lg border border-red-200 hover:bg-red-100 transition"
        >
          清空名單
        </button>
        <template v-else>
          <button
            @click="clearAllPlayers"
            class="text-xs px-3 py-1.5 bg-red-500 text-white font-semibold rounded-lg transition hover:bg-red-600"
          >
            確認清空
          </button>
          <button
            @click="confirmClear = false"
            class="text-xs px-3 py-1.5 bg-gray-100 text-gray-500 font-medium rounded-lg border border-gray-200 hover:bg-gray-200 transition"
          >
            取消
          </button>
        </template>
      </div>
    </div>

    <div v-if="store.players.length === 0" class="text-gray-400 text-sm py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">
      尚無球員，請先新增
    </div>

    <div
      v-for="player in store.players"
      :key="player.id"
      class="flex items-center bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 mb-2"
    >
      <span class="flex-1 font-semibold text-gray-800">{{ player.name }}</span>
      <span
        v-if="store.isInActiveMatch(player.id)"
        class="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mr-3"
      >
        比賽中
      </span>
      <span
        v-else-if="store.isInQueue(player.id)"
        class="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full mr-3"
      >
        排隊中
      </span>
      <button
        v-if="store.isInActiveMatch(player.id)"
        disabled
        class="text-xs px-3 py-1.5 bg-gray-50 text-gray-300 font-medium rounded-lg border border-gray-100 mr-2 cursor-not-allowed"
      >
        比賽中
      </button>
      <button
        v-else-if="!store.isInQueue(player.id)"
        @click="store.enqueue(player.id)"
        class="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 font-medium rounded-lg border border-blue-200 hover:bg-blue-100 transition mr-2"
      >
        報到
      </button>
      <button
        v-else
        @click="store.dequeue(player.id)"
        class="text-xs px-3 py-1.5 bg-gray-50 text-gray-500 font-medium rounded-lg border border-gray-200 hover:bg-gray-100 transition mr-2"
      >
        離場
      </button>
      <button
        @click="store.removePlayer(player.id)"
        class="text-gray-300 hover:text-red-400 transition text-lg leading-none"
        title="刪除球員"
      >
        ×
      </button>
    </div>
  </section>

  <!-- History Tab -->
  <section v-if="tab === 'history'">
    <div v-if="store.finishedMatches.length === 0" class="text-gray-400 text-sm py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">
      尚無歷史球局
    </div>

    <div
      v-for="match in [...store.finishedMatches].reverse()"
      :key="match.id"
      class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3"
    >
      <div class="flex justify-between text-xs text-gray-400 mb-2">
        <span>場地 {{ match.court_number }}</span>
        <span>{{ formatTime(match.started_at) }} – {{ formatTime(match.ended_at) }}</span>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex-1 text-center">
          <div v-for="id in match.team1" :key="id" class="text-sm font-medium text-gray-700">
            {{ playerName(id) }}
          </div>
        </div>
        <div class="text-gray-300 text-sm font-bold">VS</div>
        <div class="flex-1 text-center">
          <div v-for="id in match.team2" :key="id" class="text-sm font-medium text-gray-700">
            {{ playerName(id) }}
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Settings Tab -->
  <section v-if="tab === 'settings'">
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-2">場地數量</label>
      <div class="flex gap-2 items-center">
        <input
          v-model.number="courtsInput"
          type="number"
          min="1"
          max="10"
          class="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        <button
          @click="saveCourts"
          class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          儲存
        </button>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">管理員密碼</label>
      <div class="flex gap-2 items-center mt-2">
        <input
          v-model="store.settings.admin_password"
          type="text"
          class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
        />
        <button
          @click="store.updateSettings({ admin_password: store.settings.admin_password })"
          class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          儲存
        </button>
      </div>
    </div>

    <button @click="logout"
      class="mt-4 w-full py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition">
      登出管理員
    </button>
  </section>

  </template>
</template>
