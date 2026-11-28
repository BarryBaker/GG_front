<script setup>
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

  import AppDialog from './components/AppDialog.vue'
  import PlayerDataModal from './components/PlayerDataModal.vue'

  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const API_BASE_URL = import.meta.env.DEV
    ? '/api'
    : isLocalHost
      ? 'http://127.0.0.1:18000'
      : 'https://85-190-101-59.sslip.io'

  const gameLabels = {
    Holdem: 'Hold’em',
    '9Max_Ante_Games': 'Hold’em 9-Max',
    PLO: 'PLO',
    PLO_5: 'PLO-5',
    PLO_6: 'PLO-6',
    Omaha_RUSH: 'Omaha Rush',
    Holdem_RUSH: 'Hold’em Rush',
    Holdem_AOF: 'Hold’em AOF',
    Omaha_AOF: 'Omaha AOF',
    '3MAX_and_6MAX_will_share_a_single_leaderboard_SPIN_GOLD': 'Spin & Gold',
  }
  const unlistedGames = new Set([
    // 'Holdem_AOF',
    // 'Omaha_AOF',
    // '3MAX_and_6MAX_will_share_a_single_leaderboard_SPIN_GOLD',
  ])

  const stakeLabels = {
    '025': '$0.25',
    1: '1',
    3: '3',
    5: '5',
    10: '10',
    20: '20',
    50: '50',
    100: '100',
    200: '200',
    '001002': '$0.01 / $0.02',
    '002005': '$0.02 / $0.05',
    '005010': '$0.05 / $0.10',
    '010020': '$0.10 / $0.20',
    '010025': '$0.10 / $0.25',
    '020040': '$0.20 / $0.40',
    '025050': '$0.25 / $0.50',
    '050100': '$0.50 / $1.00',
    '0501': '$0.50 / $1.00',
    12: '$1.00 / $2.00',
    24: '$2.00 / $4.00',
    25: '$2.00 / $5.00',
    510: '$5.00 / $10.00',
    1020: '$10.00 / $20.00',
  }

  const stakeOrder = [
    '025',
    '1',
    '3',
    '5',
    '10',
    '20',
    '50',
    '100',
    '200',
    '001002',
    '002005',
    '005010',
    '010020',
    '010025',
    '020040',
    '025050',
    '050100',
    '0501',
    '12',
    '24',
    '25',
    '510',
    '1020',
  ]
  const stakeOrderIndex = new Map(stakeOrder.map((key, index) => [key, index]))
  const defaultTable = 'PLO___050100'
  const topPlayersLimit = 15
  const topPlayersDateFormat = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const pointsFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 20 })
  const helpPages = [
    { id: 'about', title: 'About the tracker' },
    { id: 'tutorial', title: 'Tutorial' },
  ]

  const mainGroup = ref('PLO')
  const selectedTable = ref(defaultTable)
  const tableGroups = ref(new Map())
  const tableData = ref({ columns: [], rows: [] })
  const topPlayers = ref([])
  const topPlayersDateRange = ref('')
  const playerDetails = ref(null)
  const showHelp = ref(false)
  const utcTime = ref(new Date().toISOString())
  const millisecondsPerMinute = 60_000
  const maxSnapshotGap = 180 * millisecondsPerMinute
  const leaderboardResetTime = '08:00'
  let clockTimeout
  const showTopPlayers = ref(false)
  const gamesLoading = ref(false)
  const tableLoading = ref(false)
  const topPlayersLoading = ref(false)
  const pendingPlayer = ref('')
  const gamesError = ref('')
  const tableError = ref('')
  const topPlayersError = ref('')
  const playerError = ref('')
  let tableRequest
  let topPlayersRequest
  let playerRequest

  const games = computed(() => {
    const available = [...tableGroups.value.keys()].filter(
      (game) => !unlistedGames.has(game) || game === mainGroup.value
    )
    const known = Object.keys(gameLabels).filter((game) => available.includes(game))
    const added = available.filter((game) => !Object.hasOwn(gameLabels, game))
    return [...known, ...added.sort((a, b) => a.localeCompare(b))]
  })
  const groupTables = computed(() => tableGroups.value.get(mainGroup.value) ?? [])

  const snapshots = computed(() => {
    const columns = tableData.value.columns.slice(1).map((name, index) => {
      const timestamp = parseSnapshotTimestamp(name)
      return {
        name,
        index: index + 1,
        timestamp,
        time: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(11, 16) : '',
      }
    })
    const timestamps = columns.filter(({ time }) => time)
    const recent = (timestamps.length ? timestamps : columns).slice(-2)
    const [previous, latest] = recent
    if (!latest || !previous.time || !latest.time) return recent

    const gap = latest.timestamp - previous.timestamp
    const crossedReset = previous.time < leaderboardResetTime && latest.time > leaderboardResetTime
    return gap > maxSnapshotGap || crossedReset ? [latest] : recent
  })

  const snapshotAge = computed(() => {
    const timestamp = snapshots.value.at(-1)?.timestamp
    if (
      gamesLoading.value ||
      tableLoading.value ||
      tableError.value ||
      !Number.isFinite(timestamp)
    ) {
      return null
    }

    const elapsed = Math.max(0, Date.parse(utcTime.value) - timestamp)
    const minutes = Math.floor(elapsed / millisecondsPerMinute)
    return {
      datetime: new Date(timestamp).toISOString(),
      label: minutes === 0 ? 'Just now' : `${minutes} min ago`,
    }
  })

  const canCompare = computed(
    () => snapshots.value.length === 2 && snapshots.value.every(({ time }) => time)
  )

  const rows = computed(() =>
    tableData.value.rows.map((row) => {
      const scores = snapshots.value.map(({ index }) => row[index])
      const [previous, latest] = scores.map(parsePoints)
      return {
        name: row[0],
        scores,
        live: canCompare.value && previous !== null && latest !== null && latest > previous,
      }
    })
  )
  const liveCount = computed(() => rows.value.filter(({ live }) => live).length)

  async function fetchJSON(path, signal) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    return response.json()
  }

  function tablePath(tableName, endpoint) {
    return `/tables/${encodeURIComponent(tableName)}/${endpoint}`
  }

  function gameLabel(game) {
    return Object.hasOwn(gameLabels, game) ? gameLabels[game] : game.replaceAll('_', ' ')
  }

  function stakeKey(tableName) {
    return tableName.slice(tableName.indexOf('___') + 3).split('_')[0]
  }

  function stakeLabel(tableName) {
    const key = stakeKey(tableName)
    return Object.hasOwn(stakeLabels, key) ? stakeLabels[key] : key
  }

  function groupTablesByGame(tables) {
    const groups = new Map()
    for (const table of tables) {
      if (typeof table !== 'string') continue
      const separator = table.indexOf('___')
      if (separator < 1 || !table.slice(separator + 3)) continue
      const game = table.slice(0, separator)
      if (!groups.has(game)) groups.set(game, [])
      groups.get(game).push(table)
    }
    for (const group of groups.values()) {
      group.sort(
        (a, b) =>
          (stakeOrderIndex.get(stakeKey(a)) ?? Infinity) -
            (stakeOrderIndex.get(stakeKey(b)) ?? Infinity) || a.localeCompare(b)
      )
    }
    return groups
  }

  async function fetchTables() {
    gamesLoading.value = true
    gamesError.value = ''
    try {
      const tables = await fetchJSON('/tables')
      tableGroups.value = groupTablesByGame(Array.isArray(tables) ? tables : [])
      if (!games.value.includes(mainGroup.value)) {
        mainGroup.value = games.value.includes('PLO') ? 'PLO' : (games.value[0] ?? '')
      }
      if (!groupTables.value.includes(selectedTable.value)) {
        selectedTable.value = groupTables.value.includes(defaultTable)
          ? defaultTable
          : (groupTables.value[0] ?? '')
      }
      await fetchSelectedTableData()
    } catch (error) {
      gamesError.value = `Couldn’t load games and stakes. ${error.message}.`
    } finally {
      gamesLoading.value = false
    }
  }

  async function fetchSelectedTableData() {
    tableRequest?.abort()
    tableError.value = ''
    tableLoading.value = Boolean(selectedTable.value)
    if (!selectedTable.value) {
      tableData.value = { columns: [], rows: [] }
      return
    }

    const request = new AbortController()
    tableRequest = request
    const query = new URLSearchParams({ limit: String(100) })
    try {
      const payload = await fetchJSON(
        tablePath(selectedTable.value, 'data') + `?${query.toString()}`,
        request.signal
      )
      // console.log('Fetched table data:', payload)
      if (!request.signal.aborted) {
        tableData.value = normalizeTablePayload(payload)
        utcTime.value = new Date().toISOString()
      }
    } catch (error) {
      if (!request.signal.aborted) {
        tableError.value = `Couldn’t load leaderboard data. ${error.message}.`
      }
    } finally {
      if (!request.signal.aborted) tableLoading.value = false
    }
  }

  function selectGame(game) {
    if (mainGroup.value === game) return
    mainGroup.value = game
    selectTable(groupTables.value[0] ?? '')
  }

  function selectTable(table) {
    if (selectedTable.value === table) return
    selectedTable.value = table
    fetchSelectedTableData()
  }

  async function fetchTopPlayers() {
    topPlayersRequest?.abort()
    const request = new AbortController()
    topPlayersRequest = request
    topPlayersLoading.value = true
    topPlayersError.value = ''
    topPlayers.value = []
    topPlayersDateRange.value = ''
    try {
      const result = await fetchJSON(
        tablePath(selectedTable.value, `top-players?limit=${topPlayersLimit}`),
        request.signal
      )
      // console.log('Fetched top players:', result)
      if (!request.signal.aborted) {
        const names = Array.isArray(result) ? result : (result?.players ?? result?.rows)
        topPlayers.value = Array.isArray(names) ? names : []
        topPlayersDateRange.value = formatTopPlayersDateRange(result?.date_range)
      }
    } catch (error) {
      if (!request.signal.aborted) {
        topPlayersError.value = `Couldn’t load top players. ${error.message}.`
      }
    } finally {
      if (!request.signal.aborted) topPlayersLoading.value = false
    }
  }

  function openTopPlayers() {
    clearPlayerRequest()
    showTopPlayers.value = true
    fetchTopPlayers()
  }

  function closeTopPlayers() {
    topPlayersRequest?.abort()
    clearPlayerRequest()
    showTopPlayers.value = false
  }

  function clearPlayerRequest() {
    playerRequest?.abort()
    pendingPlayer.value = ''
    playerError.value = ''
  }

  async function handleNameClick(name) {
    clearPlayerRequest()
    const request = new AbortController()
    playerRequest = request
    pendingPlayer.value = name
    try {
      const response = await fetchJSON(
        tablePath(selectedTable.value, `player?name=${encodeURIComponent(name)}`),
        request.signal
      )
      if (!request.signal.aborted) {
        playerDetails.value = {
          name: response.player || name,
          data: response.datapoints,
          country: response.country || '',
        }
      }
    } catch (error) {
      if (!request.signal.aborted) {
        playerError.value = `Couldn’t load player activity. ${error.message}.`
      }
    } finally {
      if (!request.signal.aborted) pendingPlayer.value = ''
    }
  }

  function normalizeTablePayload(payload) {
    const rows = Array.isArray(payload) ? payload : (payload?.rows ?? [])
    let columns = Array.isArray(payload?.columns) ? payload.columns : []
    if (!Array.isArray(rows) || rows.length === 0) return { columns, rows: [] }

    if (Array.isArray(rows[0])) {
      if (columns.length === 0) {
        const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0)
        columns = Array.from({ length: width }, (_, index) => `col_${index}`)
      }
      return { columns, rows }
    }

    if (columns.length === 0) {
      columns = [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))]
    }
    return { columns, rows: rows.map((row) => columns.map((column) => row?.[column])) }
  }

  function parseSnapshotTimestamp(value) {
    if (typeof value !== 'string') return NaN
    const storedFormat =
      /^(?:ts_)?(\d{4})[-_](\d{2})[-_](\d{2})[ T_](\d{2})[:h](\d{2})(:\d{2}(?:\.\d+)?)?$/i
    const match = storedFormat.exec(value)
    if (match) {
      const [, year, month, day, hour, minute, seconds = ':00'] = match
      return Date.parse(`${year}-${month}-${day}T${hour}:${minute}${seconds}Z`)
    }
    return /\d{1,2}:\d{2}/.test(value) ? Date.parse(value) : NaN
  }

  function formatTopPlayersDateRange(dateRange) {
    if (!Array.isArray(dateRange) || dateRange.length !== 2) return ''

    const [start, end] = dateRange.map(parseSnapshotTimestamp)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return ''

    return `${topPlayersDateFormat.format(start)} - ${topPlayersDateFormat.format(end)}`
  }

  function parsePoints(value) {
    if (value === null || value === undefined) return null
    const points = Number.parseFloat(String(value).replaceAll(',', ''))
    return Number.isFinite(points) ? points : null
  }

  function formatPoints(value) {
    if (value === null || value === undefined || value === '') return '—'
    return typeof value === 'number' ? pointsFormat.format(value) : value
  }

  function applyUrlDefaults() {
    try {
      const url = new URL(window.location.href)
      const params = new Map()
      url.searchParams.forEach((value, key) => params.set(key.toLowerCase(), value))
      const hashParts = url.hash.slice(1).split(/[&;]/)
      const pathParts = url.pathname.split('/').filter(Boolean)
      for (const part of [...hashParts, ...pathParts]) {
        const [key, value] = part.split('=')
        if (key && value) params.set(key.toLowerCase(), decodeURIComponent(value))
      }
      const table = params.get('selectedtable')
      if (table) selectedTable.value = table
      mainGroup.value = params.get('maingroup') || table?.split('___')[0] || mainGroup.value
    } catch {
      // Malformed URL parameters do not prevent the default leaderboard from loading.
    }
  }

  function syncUrl() {
    const url = new URL(window.location.href)
    if (mainGroup.value) url.searchParams.set('maingroup', mainGroup.value)
    else url.searchParams.delete('maingroup')
    if (selectedTable.value) url.searchParams.set('selectedtable', selectedTable.value)
    else url.searchParams.delete('selectedtable')
    history.replaceState(null, '', url)
  }

  function updateUtcClock() {
    const now = new Date()
    utcTime.value = now.toISOString()
    clockTimeout = window.setTimeout(
      updateUtcClock,
      millisecondsPerMinute - (now.getTime() % millisecondsPerMinute)
    )
  }

  onMounted(() => {
    updateUtcClock()
    applyUrlDefaults()
    fetchTables()
  })
  onBeforeUnmount(() => window.clearTimeout(clockTimeout))

  watch([mainGroup, selectedTable], syncUrl)
  watch(selectedTable, clearPlayerRequest)
</script>

<template>
  <header class="masthead">
    <div class="masthead-inner">
      <h1 class="brand">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span
          >GG Poker<br />
          Leaderboard Tracker</span
        >
      </h1>
      <div class="masthead-actions">
        <button
          class="action-button help-button"
          type="button"
          aria-label="What’s this?"
          @click="showHelp = true"
        >
          <span class="help-icon" aria-hidden="true">?</span>
          <span class="action-label">What’s this?</span>
        </button>
        <time class="utc-clock" :datetime="utcTime">{{ utcTime.slice(11, 16) }} UTC</time>
      </div>
    </div>
  </header>

  <main class="workspace">
    <div v-if="gamesError" class="notice page-notice" role="alert">{{ gamesError }}</div>

    <div class="dashboard">
      <section class="filter-panel" aria-labelledby="games-title">
        <h2 id="games-title" class="panel-label">Games</h2>
        <nav v-if="games.length" class="filter-list" aria-labelledby="games-title">
          <button
            v-for="game in games"
            :key="game"
            class="group-tab filter-button"
            type="button"
            :aria-pressed="game === mainGroup"
            :title="gameLabel(game)"
            @click="selectGame(game)"
          >
            <span>{{ gameLabel(game) }}</span>
            <span class="filter-arrow" aria-hidden="true"></span>
          </button>
        </nav>
        <p v-else class="filter-empty">{{ gamesLoading ? 'Loading…' : 'No games available' }}</p>
      </section>

      <section class="filter-panel" aria-labelledby="stakes-title">
        <h2 id="stakes-title" class="panel-label">Stakes</h2>
        <nav
          v-if="groupTables.length"
          class="filter-list stakes-list"
          aria-labelledby="stakes-title"
        >
          <button
            v-for="table in groupTables"
            :key="table"
            class="table-tab filter-button"
            type="button"
            :aria-pressed="table === selectedTable"
            :title="stakeLabel(table)"
            @click="selectTable(table)"
          >
            <span>{{ stakeLabel(table) }}</span>
            <span class="filter-arrow" aria-hidden="true"></span>
          </button>
        </nav>
        <p v-else class="filter-empty">{{ gamesLoading ? 'Loading…' : 'No stakes available' }}</p>
      </section>

      <section class="leaderboard" aria-labelledby="table-title">
        <header class="table-toolbar">
          <div class="table-heading">
            <h2 id="table-title">
              {{ mainGroup && games.length ? gameLabel(mainGroup) : 'Standings' }}
              <template v-if="selectedTable && groupTables.includes(selectedTable)">
                <span class="title-divider" aria-hidden="true"></span>
                <span class="stake-details">
                  <span class="selected-stake">{{ stakeLabel(selectedTable) }}</span>
                  <time v-if="snapshotAge" class="snapshot-age" :datetime="snapshotAge.datetime">{{
                    snapshotAge.label
                  }}</time>
                </span>
              </template>
            </h2>
            <p v-if="rows.length && !tableLoading && !tableError" class="table-summary">
              {{ rows.length }} {{ rows.length === 1 ? 'player' : 'players' }}
              <span v-if="canCompare" class="live-summary">
                <span
                  class="live-dot"
                  :class="{ 'is-live': liveCount > 0 }"
                  aria-hidden="true"
                ></span>
                {{ liveCount }} live
              </span>
            </p>
          </div>
          <div class="table-actions">
            <button
              class="action-button action-primary"
              type="button"
              aria-label="Reload"
              title="Reload"
              :disabled="gamesLoading || tableLoading"
              @click="fetchTables"
            >
              <span class="reload-icon" aria-hidden="true">↻</span>
              <span class="action-label">Reload</span>
            </button>
            <button
              class="action-button"
              type="button"
              aria-label="Top players"
              title="Top players"
              :disabled="!groupTables.includes(selectedTable)"
              @click="openTopPlayers"
            >
              <span class="ranking-icon" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="action-label">Top players</span>
            </button>
          </div>
        </header>

        <div v-if="playerError && !showTopPlayers" class="notice table-notice" role="alert">
          {{ playerError }}
        </div>

        <div class="table-viewport" :aria-busy="gamesLoading || tableLoading">
          <table class="standings">
            <thead>
              <tr>
                <th scope="col" class="live-column">Live</th>
                <th scope="col" class="player-column">Player</th>
                <th
                  v-for="(snapshot, index) in snapshots"
                  :key="snapshot.index"
                  scope="col"
                  class="points-column"
                  :class="{ 'latest-column': index === snapshots.length - 1 }"
                  :title="snapshot.name"
                >
                  <span class="snapshot-label">
                    {{ index === snapshots.length - 1 ? 'Latest' : 'Previous' }}
                  </span>
                  <span class="snapshot-time">{{ snapshot.time || snapshot.name }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="gamesLoading || tableLoading || tableError || !rows.length">
                <td :colspan="2 + snapshots.length" class="table-state">
                  <p v-if="tableError" role="alert">{{ tableError }}</p>
                  <p v-else-if="gamesLoading || tableLoading" role="status">Loading leaderboard…</p>
                  <p v-else-if="gamesError && !games.length">Use Reload to try again.</p>
                  <p v-else>No leaderboard data available.</p>
                </td>
              </tr>
              <tr
                v-for="(row, index) in !gamesLoading && !tableLoading && !tableError ? rows : []"
                :key="index"
              >
                <td class="live-column">
                  <span
                    class="live-dot"
                    :class="{ 'is-live': row.live }"
                    role="img"
                    :aria-label="
                      canCompare ? (row.live ? 'Live' : 'No points gained') : 'Status unavailable'
                    "
                  ></span>
                </td>
                <th class="player-column" scope="row">
                  <button
                    v-if="row.name"
                    class="player-link"
                    type="button"
                    :aria-busy="pendingPlayer === row.name"
                    :title="row.name"
                    @click="handleNameClick(row.name)"
                  >
                    {{ row.name }}
                  </button>
                  <span v-else>—</span>
                </th>
                <td
                  v-for="(score, scoreIndex) in row.scores"
                  :key="scoreIndex"
                  class="points-column"
                  :class="{ 'latest-column': scoreIndex === row.scores.length - 1 }"
                >
                  {{ formatPoints(score) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <AppDialog v-if="showHelp" :pages="helpPages" @close="showHelp = false">
      <template #about>
        <div class="help-content">
          <p>
            See how points change between snapshots on supported GGPoker leaderboards. Choose a game
            and stake to get started.”
          </p>
          <ul>
            <li>
              <strong>Live tracking.</strong> Snapshots every few minutes show who’s gaining points.
            </li>
            <li>
              <strong>Player analysis.</strong> See how quickly players earn points and how much
              they’ve played over time.
            </li>
            <li>
              <strong>Evaluate your position.</strong>
              <ul>
                <li>
                  Could someone overtake you before the day ends? Check when they usually play.
                </li>
                <li>
                  Trying to catch someone ahead? Use their usual schedule and scoring pace to gauge
                  whether they’ll return and how many points they might add.
                </li>
                <li>Estimate a player’s end-of-day total from their scoring pace.</li>
              </ul>
            </li>
            <li>
              <strong>Spot possible foul play.</strong> Look for unusually high playing volume or
              activity patterns that could indicate bot use.
            </li>
          </ul>
        </div>
      </template>
      <template #tutorial>
        <div class="help-content">
          <p>
            Choose a game under <strong>Games</strong> and a blind level under
            <strong>Stakes</strong>. The table ranks players by their latest points and shows the
            previous snapshot when it’s available for comparison.
          </p>
          <ul>
            <li>
              <strong>Check update times.</strong> The gap between the Previous and Latest
              timestamps gives you a rough idea of when the next snapshot may arrive.
            </li>
            <li>
              Select <strong>Reload</strong> <span class="reload-icon" aria-hidden="true">↻</span>
              to fetch the latest available data.
            </li>
            <li>Select a <strong>player’s name</strong> to open their activity history.</li>
            <li>In <strong>player’s history</strong> click to any data point for detailed data</li>
            <li>
              Open <strong>Top players</strong> to see who earned the most points at the selected
              stake for the dates shown. Select any name in the list to see that player’s history.
            </li>
            <li>
              Check the <strong>Live</strong> column. A green dot means the player gained points
              between the two snapshots.
            </li>
          </ul>
        </div>
      </template>
    </AppDialog>

    <AppDialog v-if="showTopPlayers" title="Top players" @close="closeTopPlayers">
      <template #subtitle>
        {{ gameLabel(mainGroup) }} · {{ stakeLabel(selectedTable) }}
        <template v-if="topPlayers.length || topPlayersDateRange">
          <br />
          {{
            topPlayersDateRange
              ? `Players with most points between ${topPlayersDateRange}`
              : 'Players with most points'
          }}
        </template>
      </template>
      <p v-if="topPlayersLoading" class="dialog-state" role="status">Loading top players…</p>
      <div v-else-if="topPlayersError" class="dialog-state">
        <p class="notice" role="alert">{{ topPlayersError }}</p>
        <button class="action-button" type="button" @click="fetchTopPlayers">Try again</button>
      </div>
      <p v-else-if="!topPlayers.length" class="dialog-state">No top players available.</p>
      <ol v-else class="players-list">
        <li v-for="name in topPlayers" :key="name">
          <button
            class="player-link"
            type="button"
            :aria-busy="pendingPlayer === name"
            @click="handleNameClick(name)"
          >
            {{ name }}
          </button>
        </li>
      </ol>
      <p v-if="playerError" class="notice" role="alert">{{ playerError }}</p>
    </AppDialog>

    <PlayerDataModal
      v-if="playerDetails"
      :player-data="playerDetails.data"
      :player-name="playerDetails.name"
      :country="playerDetails.country"
      @close="playerDetails = null"
    />
  </main>
</template>
