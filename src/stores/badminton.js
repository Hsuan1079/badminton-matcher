import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEYS = {
  players: 'bm_players',
  queue: 'bm_queue',
  matches: 'bm_matches',
  settings: 'bm_settings',
  sessionDate: 'bm_session_date',
}

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function saveToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function uuid() {
  return crypto.randomUUID()
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export const useBadmintonStore = defineStore('badminton', () => {
  // --- State ---
  const players = ref(loadFromStorage(STORAGE_KEYS.players, []))
  const queue = ref(loadFromStorage(STORAGE_KEYS.queue, []))
  const matches = ref(loadFromStorage(STORAGE_KEYS.matches, []))
  const settings = ref(loadFromStorage(STORAGE_KEYS.settings, {
    courts: 2,
    similarityThreshold: 1,
  }))

  // Reset sessionGamesPlayed daily
  const sessionDate = ref(loadFromStorage(STORAGE_KEYS.sessionDate, todayStr()))
  if (sessionDate.value !== todayStr()) {
    queue.value = queue.value.map(e => ({ ...e, sessionGamesPlayed: 0 }))
    sessionDate.value = todayStr()
    saveToStorage(STORAGE_KEYS.sessionDate, sessionDate.value)
    saveToStorage(STORAGE_KEYS.queue, queue.value)
  }

  // --- Persist helpers ---
  function persist() {
    saveToStorage(STORAGE_KEYS.players, players.value)
    saveToStorage(STORAGE_KEYS.queue, queue.value)
    saveToStorage(STORAGE_KEYS.matches, matches.value)
    saveToStorage(STORAGE_KEYS.settings, settings.value)
  }

  // --- Computed ---
  const activeMatches = computed(() => matches.value.filter(m => m.endedAt === null))
  const finishedMatches = computed(() => matches.value.filter(m => m.endedAt !== null))
  const activeCourts = computed(() => activeMatches.value.length)
  const availableCourts = computed(() => settings.value.courts - activeCourts.value)
  const candidatePool = computed(() => {
    if (queue.value.length === 0) return []
    const threshold = settings.value.similarityThreshold ?? 1
    const minGames = Math.min(...queue.value.map(e => e.sessionGamesPlayed))
    const pool = queue.value.filter(e => e.sessionGamesPlayed <= minGames + threshold)
    // If not enough similar-games players, fall back to all queued players
    return pool.length >= 4 ? pool : queue.value
  })
  const canMatch = computed(() => queue.value.length >= 4 && availableCourts.value > 0)

  function getPlayer(id) {
    return players.value.find(p => p.id === id)
  }

  // --- Player actions ---
  function addPlayer(name) {
    const trimmed = name.trim()
    if (!trimmed) return null
    const player = { id: uuid(), name: trimmed, createdAt: Date.now() }
    players.value.push(player)
    persist()
    return player
  }

  function removePlayer(playerId) {
    players.value = players.value.filter(p => p.id !== playerId)
    // Also remove from queue if present
    queue.value = queue.value.filter(e => e.playerId !== playerId)
    persist()
  }

  // --- Queue actions ---
  function enqueue(playerId) {
    if (queue.value.some(e => e.playerId === playerId)) return false
    // Carry over sessionGamesPlayed from any previous entry today
    const existing = queue.value.find(e => e.playerId === playerId)
    queue.value.push({
      id: uuid(),
      playerId,
      joinedAt: Date.now(),
      sessionGamesPlayed: existing?.sessionGamesPlayed ?? 0,
    })
    persist()
    return true
  }

  function dequeue(playerId) {
    queue.value = queue.value.filter(e => e.playerId !== playerId)
    persist()
  }

  function isInQueue(playerId) {
    return queue.value.some(e => e.playerId === playerId)
  }

  // --- Match history helpers ---
  // Returns Map<otherPlayerId, timesOnCourtTogether> — counts both partner and opponent appearances
  function getCourtHistory(playerId) {
    const counts = new Map()
    for (const m of matches.value) {
      const allFour = [...m.team1, ...m.team2]
      if (!allFour.includes(playerId)) continue
      allFour.forEach(id => {
        if (id === playerId) return
        counts.set(id, (counts.get(id) ?? 0) + 1)
      })
    }
    return counts
  }

  // --- Match actions ---
  function startMatch(team1, team2, courtNumber) {
    const match = {
      id: uuid(),
      team1,
      team2,
      courtNumber,
      startedAt: Date.now(),
      endedAt: null,
    }
    matches.value.push(match)
    // Remove players from queue while playing
    ;[...team1, ...team2].forEach(id => {
      queue.value = queue.value.filter(e => e.playerId !== id)
    })
    persist()
    return match
  }

  function endMatch(matchId) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) return

    // Calculate before marking endedAt, so this match isn't counted yet
    const gamesAfter = {}
    ;[...match.team1, ...match.team2].forEach(playerId => {
      gamesAfter[playerId] = getPrevSessionGames(playerId) + 1
    })

    match.endedAt = Date.now()

    ;[...match.team1, ...match.team2].forEach(playerId => {
      queue.value.push({
        id: uuid(),
        playerId,
        joinedAt: Date.now(),
        sessionGamesPlayed: gamesAfter[playerId],
      })
    })
    persist()
  }

  function getPrevSessionGames(playerId) {
    // Count how many matches today this player has played
    const today = todayStr()
    return matches.value.filter(m =>
      m.endedAt !== null &&
      new Date(m.startedAt).toISOString().slice(0, 10) === today &&
      (m.team1.includes(playerId) || m.team2.includes(playerId))
    ).length
  }

  // Manual match override: directly set teams and start
  function startManualMatch(team1, team2) {
    const usedCourts = new Set(activeMatches.value.map(m => m.courtNumber))
    let courtNumber = 1
    while (usedCourts.has(courtNumber)) courtNumber++
    return startMatch(team1, team2, courtNumber)
  }

  // --- Matching algorithm ---
  function generateMatch() {
    if (availableCourts.value <= 0) return { error: '目前無空場地' }
    if (queue.value.length < 4) return { error: '排隊人數不足（需要至少 4 人）' }

    // Step 1: candidates sorted by games asc, then wait time asc
    const candidates = [...candidatePool.value].sort((a, b) => {
      if (a.sessionGamesPlayed !== b.sessionGamesPlayed)
        return a.sessionGamesPlayed - b.sessionGamesPlayed
      return a.joinedAt - b.joinedAt
    })

    // Step 2 & 3: Find best 4-person group by freshness score
    const selected = selectFour(candidates)
    if (!selected) return { error: '候選人數不足，請增加排隊人數' }

    // Step 4: Find best team split
    const { team1, team2 } = splitTeams(selected)

    // Assign court
    const usedCourts = new Set(activeMatches.value.map(m => m.courtNumber))
    let courtNumber = 1
    while (usedCourts.has(courtNumber)) courtNumber++

    return { team1, team2, courtNumber, preview: true }
  }

  function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  function selectFour(candidates) {
    if (candidates.length < 4) return null
    // Shuffle first so tied groups are chosen randomly
    if (candidates.length === 4) return shuffle(candidates.map(e => e.playerId))

    const combos = combinations(candidates, 4)
    let bestScore = -1
    const tied = []

    for (const combo of combos) {
      const ids = combo.map(e => e.playerId)
      const score = freshnessScore(ids)
      if (score > bestScore) {
        bestScore = score
        tied.length = 0
        tied.push({ ids, combo })
      } else if (Math.abs(score - bestScore) < 0.001) {
        tied.push({ ids, combo })
      }
    }

    // If only one best group, use it; if tied, pick randomly among them
    const picked = tied.length === 1
      ? tied[0]
      : tied[Math.floor(Math.random() * tied.length)]
    return shuffle(picked.ids)
  }

  // Higher = fresher group. Each pair scores 1/(1+timesOnCourtTogether),
  // so pairs who've never shared a court score 1, and repeated pairings score progressively less.
  function freshnessScore(playerIds) {
    let score = 0
    for (let i = 0; i < playerIds.length; i++) {
      const history = getCourtHistory(playerIds[i])
      for (let j = i + 1; j < playerIds.length; j++) {
        const times = history.get(playerIds[j]) ?? 0
        score += 1 / (1 + times)
      }
    }
    return score
  }

  function splitTeams(playerIds) {
    const splits = [
      { team1: [playerIds[0], playerIds[1]], team2: [playerIds[2], playerIds[3]] },
      { team1: [playerIds[0], playerIds[2]], team2: [playerIds[1], playerIds[3]] },
      { team1: [playerIds[0], playerIds[3]], team2: [playerIds[1], playerIds[2]] },
    ]

    let best = null
    let bestScore = -Infinity

    for (const split of splits) {
      // Score each pairing by freshness (same formula: 1/(1+times))
      const h0 = getCourtHistory(split.team1[0])
      const h2 = getCourtHistory(split.team2[0])
      const score =
        1 / (1 + (h0.get(split.team1[1]) ?? 0)) +
        1 / (1 + (h2.get(split.team2[1]) ?? 0))
      if (score > bestScore) {
        best = split
        bestScore = score
      }
    }

    // If all tied (e.g. all brand new), pick randomly
    const allTied = splits.every(s => {
      const h0 = getCourtHistory(s.team1[0])
      const h2 = getCourtHistory(s.team2[0])
      const sc = 1 / (1 + (h0.get(s.team1[1]) ?? 0)) + 1 / (1 + (h2.get(s.team2[1]) ?? 0))
      return Math.abs(sc - bestScore) < 0.001
    })
    if (allTied) return splits[Math.floor(Math.random() * splits.length)]
    return best
  }

  function combinations(arr, k) {
    const result = []
    function helper(start, current) {
      if (current.length === k) {
        result.push([...current])
        return
      }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i])
        helper(i + 1, current)
        current.pop()
      }
    }
    helper(0, [])
    return result
  }

  // --- Settings ---
  function updateSettings(newSettings) {
    settings.value = { ...settings.value, ...newSettings }
    persist()
  }

  return {
    players,
    queue,
    matches,
    settings,
    activeMatches,
    finishedMatches,
    activeCourts,
    availableCourts,
    candidatePool,
    canMatch,
    getPlayer,
    addPlayer,
    removePlayer,
    enqueue,
    dequeue,
    isInQueue,
    startMatch,
    endMatch,
    startManualMatch,
    generateMatch,
    updateSettings,
  }
})
