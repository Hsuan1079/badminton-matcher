import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase.js'

export const useBadmintonStore = defineStore('badminton', () => {
  // --- State ---
  const players = ref([])
  const queue = ref([])
  const matches = ref([])
  const settings = ref({ courts: 2, similarity_threshold: 1, admin_password: 'admin123' })
  const loading = ref(true)

  // --- Computed ---
  const activeMatches = computed(() => matches.value.filter(m => m.ended_at === null))
  const finishedMatches = computed(() => matches.value.filter(m => m.ended_at !== null))
  const activeCourts = computed(() => activeMatches.value.length)
  const availableCourts = computed(() => settings.value.courts - activeCourts.value)

  const candidatePool = computed(() => {
    if (queue.value.length === 0) return []
    const threshold = settings.value.similarity_threshold ?? 1
    const minGames = Math.min(...queue.value.map(e => e.session_games_played))
    const pool = queue.value.filter(e => e.session_games_played <= minGames + threshold)
    return pool.length >= 4 ? pool : queue.value
  })
  const canMatch = computed(() => queue.value.length >= 4 && availableCourts.value > 0)

  function getPlayer(id) {
    return players.value.find(p => p.id === id)
  }

  // --- Load initial data ---
  async function loadAll() {
    loading.value = true
    const [{ data: p }, { data: q }, { data: m }, { data: s }] = await Promise.all([
      supabase.from('players').select('*').order('created_at'),
      supabase.from('queue').select('*').order('joined_at'),
      supabase.from('matches').select('*').order('started_at'),
      supabase.from('settings').select('*').eq('id', 1).single(),
    ])
    players.value = p ?? []
    queue.value = q ?? []
    matches.value = m ?? []
    if (s) settings.value = s
    loading.value = false
  }

  // --- Realtime subscriptions ---
  function subscribeRealtime() {
    supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        supabase.from('players').select('*').order('created_at').then(({ data }) => { if (data) players.value = data })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, () => {
        supabase.from('queue').select('*').order('joined_at').then(({ data }) => { if (data) queue.value = data })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        supabase.from('matches').select('*').order('started_at').then(({ data }) => { if (data) matches.value = data })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        supabase.from('settings').select('*').eq('id', 1).single().then(({ data }) => { if (data) settings.value = data })
      })
      .subscribe()
  }

  // --- Player actions ---
  async function addPlayer(name) {
    const trimmed = name.trim()
    if (!trimmed) return null
    const { data, error } = await supabase.from('players').insert({ name: trimmed }).select().single()
    if (error) { console.error(error); return null }
    return data
  }

  async function removePlayer(playerId) {
    await supabase.from('players').delete().eq('id', playerId)
  }

  // --- Queue actions ---
  async function enqueue(playerId) {
    if (queue.value.some(e => e.player_id === playerId)) return false
    const today = new Date().toISOString().slice(0, 10)
    // Count today's finished games for this player
    const gamesPlayed = matches.value.filter(m =>
      m.ended_at !== null &&
      new Date(m.started_at).toISOString().slice(0, 10) === today &&
      (m.team1.includes(playerId) || m.team2.includes(playerId))
    ).length
    await supabase.from('queue').insert({ player_id: playerId, session_games_played: gamesPlayed })
    return true
  }

  async function dequeue(playerId) {
    await supabase.from('queue').delete().eq('player_id', playerId)
  }

  function isInQueue(playerId) {
    return queue.value.some(e => e.player_id === playerId)
  }

  // --- Match actions ---
  async function startMatch(team1, team2, courtNumber) {
    const { data: match } = await supabase.from('matches').insert({
      team1,
      team2,
      court_number: courtNumber,
      ended_at: null,
    }).select().single()

    // Remove players from queue
    await Promise.all([...team1, ...team2].map(id =>
      supabase.from('queue').delete().eq('player_id', id)
    ))
    return match
  }

  async function endMatch(matchId) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) return

    const today = new Date().toISOString().slice(0, 10)
    // Calculate games BEFORE marking ended
    const gamesMap = {}
    ;[...match.team1, ...match.team2].forEach(playerId => {
      gamesMap[playerId] = matches.value.filter(m =>
        m.ended_at !== null &&
        new Date(m.started_at).toISOString().slice(0, 10) === today &&
        (m.team1.includes(playerId) || m.team2.includes(playerId))
      ).length + 1
    })

    await supabase.from('matches').update({ ended_at: new Date().toISOString() }).eq('id', matchId)

    // Re-enqueue players
    await Promise.all([...match.team1, ...match.team2].map(playerId =>
      supabase.from('queue').insert({
        player_id: playerId,
        session_games_played: gamesMap[playerId],
      })
    ))
  }

  async function startManualMatch(team1, team2) {
    const usedCourts = new Set(activeMatches.value.map(m => m.court_number))
    let courtNumber = 1
    while (usedCourts.has(courtNumber)) courtNumber++
    return startMatch(team1, team2, courtNumber)
  }

  // --- Settings ---
  async function updateSettings(newSettings) {
    settings.value = { ...settings.value, ...newSettings }
    await supabase.from('settings').update(newSettings).eq('id', 1)
  }

  // --- Matching algorithm ---
  function generateMatch() {
    if (availableCourts.value <= 0) return { error: '目前無空場地' }
    if (queue.value.length < 4) return { error: '排隊人數不足（需要至少 4 人）' }

    const candidates = [...candidatePool.value].sort((a, b) => {
      if (a.session_games_played !== b.session_games_played)
        return a.session_games_played - b.session_games_played
      return new Date(a.joined_at) - new Date(b.joined_at)
    })

    const selected = selectFour(candidates)
    if (!selected) return { error: '候選人數不足' }

    const { team1, team2 } = splitTeams(selected)

    const usedCourts = new Set(activeMatches.value.map(m => m.court_number))
    let courtNumber = 1
    while (usedCourts.has(courtNumber)) courtNumber++

    return { team1, team2, courtNumber }
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
    if (candidates.length === 4) return shuffle(candidates.map(e => e.player_id))

    const combos = combinations(candidates, 4)
    let bestScore = -1
    const tied = []

    for (const combo of combos) {
      const ids = combo.map(e => e.player_id)
      const score = freshnessScore(ids)
      if (score > bestScore) {
        bestScore = score
        tied.length = 0
        tied.push({ ids, combo })
      } else if (Math.abs(score - bestScore) < 0.001) {
        tied.push({ ids, combo })
      }
    }

    const picked = tied.length === 1
      ? tied[0]
      : tied[Math.floor(Math.random() * tied.length)]
    return shuffle(picked.ids)
  }

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

  function freshnessScore(playerIds) {
    let score = 0
    for (let i = 0; i < playerIds.length; i++) {
      const history = getCourtHistory(playerIds[i])
      for (let j = i + 1; j < playerIds.length; j++) {
        score += 1 / (1 + (history.get(playerIds[j]) ?? 0))
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
      if (current.length === k) { result.push([...current]); return }
      for (let i = start; i < arr.length; i++) {
        current.push(arr[i])
        helper(i + 1, current)
        current.pop()
      }
    }
    helper(0, [])
    return result
  }

  return {
    players, queue, matches, settings, loading,
    activeMatches, finishedMatches, activeCourts, availableCourts, candidatePool, canMatch,
    getPlayer, loadAll, subscribeRealtime,
    addPlayer, removePlayer,
    enqueue, dequeue, isInQueue,
    startMatch, endMatch, startManualMatch,
    generateMatch, updateSettings,
  }
})
