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

  // Local (browser timezone) date string, e.g. "2026-06-12"
  function localDateString(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
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

  const addingNames = new Set()

  // --- Player actions ---
  async function addPlayer(name) {
    const trimmed = name.trim()
    if (!trimmed) return null
    if (addingNames.has(trimmed)) return null
    addingNames.add(trimmed)
    try {
      const { data, error } = await supabase.from('players').insert({ name: trimmed }).select().single()
      if (error) { console.error(error); return null }
      return data
    } finally {
      addingNames.delete(trimmed)
    }
  }

  async function removePlayer(playerId) {
    const inActiveMatch = activeMatches.value.some(m =>
      m.team1.includes(playerId) || m.team2.includes(playerId)
    )
    if (inActiveMatch) {
      console.error('removePlayer: cannot remove a player who is in an active match')
      return false
    }
    // Leave the queue first so no dangling queue row remains for this player
    if (isInQueue(playerId)) await dequeue(playerId)
    const { error } = await supabase.from('players').delete().eq('id', playerId)
    if (error) { console.error(error); return false }
    return true
  }

  // In-flight enqueue locks: prevents double-insert when the button is
  // pressed faster than the realtime update arrives.
  const enqueuingSet = new Set()

  // --- Queue actions ---
  async function enqueue(playerId) {
    if (queue.value.some(e => e.player_id === playerId)) return false
    if (enqueuingSet.has(playerId)) return false
    enqueuingSet.add(playerId)
    try {
      const today = localDateString(new Date())
      const gamesPlayed = matches.value.filter(m =>
        m.ended_at !== null &&
        localDateString(new Date(m.started_at)) === today &&
        (m.team1.includes(playerId) || m.team2.includes(playerId))
      ).length
      const { error } = await supabase.from('queue').insert({ player_id: playerId, session_games_played: gamesPlayed })
      if (error) { console.error(error); return false }
      return true
    } finally {
      enqueuingSet.delete(playerId)
    }
  }

  async function dequeue(playerId) {
    const { error } = await supabase.from('queue').delete().eq('player_id', playerId)
    if (error) { console.error(error); return false }
    return true
  }

  function isInQueue(playerId) {
    return queue.value.some(e => e.player_id === playerId)
  }

  // Admin override for a queued player's recorded game count (e.g. fixing a mis-click)
  async function updateQueueGamesPlayed(playerId, sessionGamesPlayed) {
    const value = Math.max(0, Math.trunc(sessionGamesPlayed))
    const { error } = await supabase.from('queue').update({ session_games_played: value }).eq('player_id', playerId)
    if (error) { console.error(error); return false }
    return true
  }

  // --- Match actions ---
  async function startMatch(team1, team2, courtNumber) {
    // Guard against double-booking: players already in an active match cannot start another
    const busy = new Set(activeMatches.value.flatMap(m => [...m.team1, ...m.team2]))
    if ([...team1, ...team2].some(id => busy.has(id))) {
      console.error('startMatch: player already in an active match')
      return null
    }

    // Optimistic update: remove players from local queue immediately so UI
    // feels instant; realtime will reconcile if anything fails.
    const optimisticMatch = { id: `optimistic-${Date.now()}`, team1, team2, court_number: courtNumber, started_at: new Date().toISOString(), ended_at: null }
    matches.value = [...matches.value, optimisticMatch]
    queue.value = queue.value.filter(e => ![...team1, ...team2].includes(e.player_id))

    const { data: match, error } = await supabase.from('matches').insert({
      team1,
      team2,
      court_number: courtNumber,
      ended_at: null,
    }).select().single()
    if (error) {
      console.error(error)
      // Rollback optimistic update
      matches.value = matches.value.filter(m => m.id !== optimisticMatch.id)
      return null
    }

    // Replace optimistic entry with real one from DB
    matches.value = matches.value.map(m => m.id === optimisticMatch.id ? match : m)

    // Remove players from queue in DB (fire and forget — UI already updated)
    Promise.all([...team1, ...team2].map(id =>
      supabase.from('queue').delete().eq('player_id', id)
    )).then(results => results.forEach(({ error }) => { if (error) console.error(error) }))

    return match
  }

  async function endMatch(matchId) {
    const match = matches.value.find(m => m.id === matchId)
    if (!match) return

    const today = localDateString(new Date())
    // Calculate games BEFORE marking ended
    const gamesMap = {}
    ;[...match.team1, ...match.team2].forEach(playerId => {
      gamesMap[playerId] = matches.value.filter(m =>
        m.ended_at !== null &&
        localDateString(new Date(m.started_at)) === today &&
        (m.team1.includes(playerId) || m.team2.includes(playerId))
      ).length + 1
    })

    const endedAt = new Date().toISOString()

    // Optimistic update: mark match ended and re-add players to queue immediately
    matches.value = matches.value.map(m => m.id === matchId ? { ...m, ended_at: endedAt } : m)
    const newQueueEntries = [...match.team1, ...match.team2].map(playerId => ({
      id: `optimistic-${playerId}-${Date.now()}`,
      player_id: playerId,
      session_games_played: gamesMap[playerId],
      joined_at: new Date().toISOString(),
    }))
    queue.value = [...queue.value, ...newQueueEntries]

    // Persist to DB in background
    supabase.from('matches').update({ ended_at: endedAt }).eq('id', matchId)
      .then(({ error }) => { if (error) console.error(error) })

    Promise.all([...match.team1, ...match.team2].map(playerId =>
      supabase.from('queue').insert({
        player_id: playerId,
        session_games_played: gamesMap[playerId],
      })
    )).then(results => results.forEach(({ error }) => { if (error) console.error(error) }))
  }

  // Cancel an active match entirely (e.g. started by mistake), returning all
  // 4 players back to the queue as if it never happened.
  async function cancelMatch(matchId) {
    const match = matches.value.find(m => m.id === matchId && m.ended_at === null)
    if (!match) return false

    const { error: deleteError } = await supabase.from('matches').delete().eq('id', matchId)
    if (deleteError) { console.error(deleteError); return false }

    const results = await Promise.all([...match.team1, ...match.team2].map(playerId => enqueue(playerId)))
    if (results.some(ok => !ok)) return false
    return true
  }

  // Swap one player in an active match for another player currently in the queue.
  async function swapActiveMatchPlayer(matchId, outPlayerId, inPlayerId) {
    const match = matches.value.find(m => m.id === matchId && m.ended_at === null)
    if (!match) return false
    if (!isInQueue(inPlayerId)) return false

    let team1 = match.team1
    let team2 = match.team2
    if (team1.includes(outPlayerId)) {
      team1 = team1.map(id => id === outPlayerId ? inPlayerId : id)
    } else if (team2.includes(outPlayerId)) {
      team2 = team2.map(id => id === outPlayerId ? inPlayerId : id)
    } else {
      return false
    }

    const { error: updateError } = await supabase.from('matches').update({ team1, team2 }).eq('id', matchId)
    if (updateError) { console.error(updateError); return false }

    const { error: deleteError } = await supabase.from('queue').delete().eq('player_id', inPlayerId)
    if (deleteError) console.error(deleteError)

    await enqueue(outPlayerId)
    return true
  }

  async function startManualMatch(team1, team2) {
    const usedCourts = new Set(activeMatches.value.map(m => m.court_number))
    let courtNumber = 1
    while (usedCourts.has(courtNumber)) courtNumber++
    return startMatch(team1, team2, courtNumber)
  }

  // --- Settings ---
  async function updateSettings(newSettings) {
    const previous = settings.value
    settings.value = { ...settings.value, ...newSettings }
    const { error } = await supabase.from('settings').update(newSettings).eq('id', 1)
    if (error) {
      console.error(error)
      settings.value = previous
      return false
    }
    return true
  }

  // --- Matching algorithm ---
  function generateMatch() {
    if (availableCourts.value <= 0) return { error: '目前無空場地' }
    if (queue.value.length < 4) return { error: '排隊人數不足（需要至少 4 人）' }
    if (candidatePool.value.length < 4) return { error: '候選人數不足' }

    const selected = shuffle(candidatePool.value.map(e => e.player_id)).slice(0, 4)
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

  return {
    players, queue, matches, settings, loading,
    activeMatches, finishedMatches, activeCourts, availableCourts, candidatePool, canMatch,
    getPlayer, loadAll, subscribeRealtime,
    addPlayer, removePlayer,
    enqueue, dequeue, isInQueue, updateQueueGamesPlayed,
    startMatch, endMatch, cancelMatch, swapActiveMatchPlayer, startManualMatch,
    generateMatch, updateSettings,
  }
})
