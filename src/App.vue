<script setup>
import { ref, onMounted } from 'vue'

const API_BASE_URL = 'https://zooming-liberation-production.up.railway.app'

const allTables = ref([])
const ploTables = ref([])
const ploDataByTable = ref({})
const playerData = ref({})
const showPlayerModal = ref(false)
const selectedPlayerName = ref('')
const loading = ref(false)
const error = ref('')

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`)
  }
  return response.json()
}

async function fetchTables() {
  loading.value = true
  error.value = ''
  try {
    const tables = await fetchJSON(`${API_BASE_URL}/tables`)
    allTables.value = Array.isArray(tables) ? tables : []
    ploTables.value = allTables.value.filter((name) => typeof name === 'string' && name === 'PLO___050100')
    await fetchPloTablesData()
  } catch (e) {
    error.value = e?.message || 'Failed to fetch tables'
  } finally {
    loading.value = false
  }
}

async function fetchPloTablesData() {
  const results = await Promise.all(
    ploTables.value.map(async (name) => {
      try {
        const payload = await fetchJSON(`${API_BASE_URL}/tables/${encodeURIComponent(name)}/data`)
        const normalized = normalizeTablePayload(payload)
        return [name, normalized]
      } catch (e) {
        return [name, { columns: [], rows: [] }]
      }
    })
  )
  const map = {}
  for (const [name, table] of results) {
    map[name] = table
  }
  ploDataByTable.value = map
}

function normalizeTablePayload(payload) {
  // Case 1: { columns: [...], rows: [...] }
  if (payload && Array.isArray(payload.columns) && Array.isArray(payload.rows)) {
    const columns = payload.columns
    const rows = payload.rows
    // If rows are objects, convert to arrays aligned with columns
    if (rows.length > 0 && !Array.isArray(rows[0]) && typeof rows[0] === 'object') {
      const normalizedRows = rows.map((row) => columns.map((col) => row?.[col]))
      return { columns, rows: normalizedRows }
    }
    // If rows are arrays, ensure we have column names; generate if missing
    const ensuredColumns = columns.length > 0 ? columns : generateColumnNamesFromRows(rows)
    return { columns: ensuredColumns, rows: rows }
  }

  // Case 2: payload is an array of objects
  if (Array.isArray(payload) && (payload.length === 0 || (typeof payload[0] === 'object' && !Array.isArray(payload[0])))) {
    const columns = deriveColumnsFromObjectRows(payload)
    const rows = payload.map((row) => columns.map((col) => row?.[col]))
    return { columns, rows }
  }

  // Case 3: payload with rows field only
  if (payload && Array.isArray(payload.rows)) {
    const rows = payload.rows
    if (rows.length > 0 && Array.isArray(rows[0])) {
      const columns = Array.isArray(payload.columns) && payload.columns.length > 0
        ? payload.columns
        : generateColumnNamesFromRows(rows)
      return { columns, rows }
    }
    if (rows.length > 0 && typeof rows[0] === 'object') {
      const columns = deriveColumnsFromObjectRows(rows)
      const normalizedRows = rows.map((row) => columns.map((col) => row?.[col]))
      return { columns, rows: normalizedRows }
    }
  }

  // Fallback: unknown shape
  return { columns: [], rows: [] }
}

function deriveColumnsFromObjectRows(rows) {
  const set = new Set()
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((k) => set.add(k))
  })
  return Array.from(set)
}

function generateColumnNamesFromRows(rows) {
  const maxLen = rows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0)
  return Array.from({ length: maxLen }, (_, i) => `col_${i}`)
}

function formatCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  const asString = String(value)
  const prettyTs = tryFormatCustomTimestamp(asString)
  if (prettyTs) return prettyTs
  return asString
}

function tryFormatCustomTimestamp(str) {
  // Matches: ts_YYYY_MM_DD_HHhMM (e.g., ts_2025_08_20_12h42)
  const match = /^ts_(\d{4})_(\d{2})_(\d{2})_(\d{2})h(\d{2})$/i.exec(str)
  if (match) {
     
    const hours = match[4]
    const minutes = match[5]
    return `${hours}:${minutes}`
  }
  return ''
}

function formatTimestampForModal(str) {
  // Matches: ts_YYYY_MM_DD_HHhMM (e.g., ts_2025_08_20_12h42)
  const match = /^ts_(\d{4})_(\d{2})_(\d{2})_(\d{2})h(\d{2})$/i.exec(str)
  if (match) {
    const year = match[1]
    const month = match[2]
    const day = match[3]
    const hours = match[4]
    const minutes = match[5]
    return `${year} ${month} ${day} ${hours}:${minutes}`
  }
  return str
}

function parseCustomTimestamp(str) {
  const match = /^ts_(\d{4})_(\d{2})_(\d{2})_(\d{2})h(\d{2})$/i.exec(str)
  if (!match) return null
  return { year: match[1], month: match[2], day: match[3], hours: match[4], minutes: match[5] }
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim()
    const num = parseFloat(cleaned)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function computeDailyDeltas(pd) {
  if (!pd || !Array.isArray(pd.columns) || !Array.isArray(pd.rows)) return []
  let lastNumeric = null
  const dailyMap = new Map()
  for (let i = 0; i < pd.columns.length; i++) {
    const col = pd.columns[i]
    const ts = parseCustomTimestamp(col)
    
    if (!ts) continue
    const val = normalizeNumber(pd.rows[i])
    if (val === null) continue

    const minutesFromMidnight = parseInt(ts.hours, 10) * 60 + parseInt(ts.minutes, 10)
    const dateKey = `${ts.year}-${ts.month}-${ts.day}`
    const dateLabel = `${ts.year} ${ts.month} ${ts.day}`
    let dayEntry = dailyMap.get(dateKey)
    if (!dayEntry) {
      dayEntry = { dateKey, dateLabel, points: [], maxDelta: 0, lastMinutes: null }
      dailyMap.set(dateKey, dayEntry)
    }

    if (lastNumeric !== null) {
      const delta = val - lastNumeric
      const timeDeltaMinutes = dayEntry.lastMinutes === null ? minutesFromMidnight : Math.max(0, minutesFromMidnight - dayEntry.lastMinutes)
      const timeLabel = `${ts.hours}:${ts.minutes}`
      dayEntry.points.push({ timeLabel, delta, timeDeltaMinutes })
      if (delta > dayEntry.maxDelta) dayEntry.maxDelta = delta
    }

    dayEntry.lastMinutes = minutesFromMidnight
    lastNumeric = val
  }
  console.log(Array.from(dailyMap.values()))
  return Array.from(dailyMap.values())
}

function transposePlayerData(data) {
 
  if (!data || !data.columns || !data.rows || data.rows.length < 2) return []
  
  const [playerRow, pointsRow] = data.rows
  const timestamps = data.columns.filter(key => key !== 'name' && key !== 'created_at')
  const values = timestamps.map(ts => pointsRow[ts])
  
  return timestamps.map((ts, index) => ({
    timestamp: formatTimestampForModal(ts),
    value: values[index]
  }))
}

async function handleNameClick(name, tableName) {
  try {
    const response = await fetchJSON(`${API_BASE_URL}/tables/${encodeURIComponent(tableName)}/player?name=${encodeURIComponent(name)}`)
    if (response && Array.isArray(response.rows) && response.rows.length === 1 && Array.isArray(response.rows[0])) {
      response.rows = response.rows[0]
    }
    console.log(response)
    if (response && Array.isArray(response.rows)) {
      response.rows = response.rows.map(row => row === null ? "0" : row)
    }
    playerData.value = response
    selectedPlayerName.value = name
    showPlayerModal.value = true
    // console.log('Player data received:', response)
  } catch (e) {
    console.error('Failed to fetch player data:', e)
    error.value = `Failed to fetch player data: ${e.message}`
  }
}

onMounted(fetchTables)
</script>

<template>
  <main class="container">
    <header class="header">
      <!-- <h1>GG Tables</h1> -->
      <div class="controls">
        <button @click="fetchTables" :disabled="loading">{{ loading ? 'Loading…' : 'Reload' }}</button>
      </div>
    </header>

    <section class="status" v-if="error">
      <div class="error">{{ error }}</div>
    </section>

    <!-- <section class="all-tables">
      <h2>All Tables ({{ allTables.length }})</h2>
      <div v-if="allTables.length === 0" class="muted">No tables found.</div>
      <ul v-else class="table-list">
        <li v-for="name in allTables" :key="name">{{ name }}</li>
      </ul>
    </section> -->

    <section class="plo-tables">
      <!-- <h2>PLO___050100 Table</h2> -->
      <div v-if="ploTables.length === 0" class="muted">No PLO tables.</div>

      <div v-for="tableName in ploTables" :key="tableName" class="table-block">
        <h3>{{ tableName }}</h3>
        <div v-if="!(ploDataByTable[tableName] && (ploDataByTable[tableName].rows || []).length > 0)" class="muted">No rows.</div>
        <div v-else class="scroll-x">
          <table>
            <thead>
              <tr>
                <th v-for="(col, cIdx) in (ploDataByTable[tableName]?.columns || [])" :key="cIdx">{{ formatCell(col) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rIdx) in (ploDataByTable[tableName]?.rows || [])" :key="rIdx">
                <td v-for="(col, cIdx) in (ploDataByTable[tableName]?.columns || [])" :key="cIdx">
                  <span v-if="cIdx === 0" 
                        @click="handleNameClick(Array.isArray(row) ? row[cIdx] : row[col], tableName)" 
                        class="clickable-name">
                    {{ formatCell(Array.isArray(row) ? row[cIdx] : row[col]) }}
                  </span>
                  <span v-else>{{ formatCell(Array.isArray(row) ? row[cIdx] : row[col]) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </main>

  <!-- Player Data Modal -->
  <div v-if="showPlayerModal" class="modal-overlay" @click="showPlayerModal = false">
    <!-- <div>aaaa   {{ playerData.rows }}aaaaa</div> -->
    <!-- <div v-for="player in playerData" :key="player.name">{{ player }}</div> -->
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h3>Player Data: {{ selectedPlayerName }}</h3>
        <button class="close-btn" @click="showPlayerModal = false">&times;</button>
      </div>
      <div class="modal-body">
        <div v-if="playerData && playerData.columns && playerData.rows && playerData.rows.length > 0" class="charts">
          <div v-for="day in computeDailyDeltas(playerData)" :key="day.dateKey" class="day-chart">
            <div class="day-header">{{ day.dateLabel }}</div>
            <div class="bar-chart">
              <div v-for="(pt, i) in day.points" :key="i" class="bar-column" :title="pt.timeLabel + ' Δ ' + pt.delta" :style="{ width: ((pt.timeDeltaMinutes || 0) / 1440 * 100) + '%' }">
                <div class="bar" :style="{ height: (day.maxDelta ? Math.max(0, pt.delta) / day.maxDelta * 120 : 0) + 'px' }"></div>
                <!-- <div v-if="i % 30 === 0" class="bar-label">{{ pt.timeLabel }}</div> -->
              </div>
            </div>
          <div class="hours-labels">
            <span v-for="h in 24" :key="h-1" class="hour-cell">
              {{ h - 1 }}
            </span>
          </div>
          </div>
        </div>
        <div v-else class="muted">No player data available.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.controls button {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  background: #193880;
  border-radius: 6px;
  cursor: pointer;
}

.controls button[disabled] {
  opacity: 0.6;
  cursor: default;
}

.status .error {
  color: #b00020;
  background: #fde7ea;
  border: 1px solid #f5c2c7;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.all-tables, .plo-tables {
  margin-top: 1rem;
}

.table-list {
  list-style: none;
  padding-left: 1rem;
}

.table-block {
  margin: 1rem 0 2rem;
}

.scroll-x {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  border: 1px solid #e5e5e5;
  padding: 0.5rem;
  white-space: nowrap;
}

.muted {
  color: #666;
}

.clickable-name {
  cursor: pointer;
  color: #4888c9;
  text-decoration: underline;
}

.clickable-name:hover {
  color: #2b5e9c;
  text-decoration: none;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: rgb(30, 30, 56);
  border-radius: 8px;
  min-width: 90vw;
  max-height: 120vh;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid #e5e5e5;
  background: #2d5074;
}

.modal-header h3 {
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #e5e5e5;
}

.modal-body {
  padding: 1rem;
  max-height: 70vh;
  overflow-y: auto;
}

.player-data-table {
  width: 100%;
  border-collapse: collapse;
}

.player-data-table th,
.player-data-table td {
  text-align: left;
  border: 1px solid #e5e5e5;
  padding: 0.5rem;
  white-space: nowrap;
}

.player-data-table th {
  background: #1e364e;
  font-weight: 600;
}

.bar-label {
  /* position: absolute; */
  /* top: calc(100%); */
  /* left: 50%; */
  /* transform: translateX(-50%); */
  font-size: 10px;
  color: #ccc;
  pointer-events: none;
}

/* Charts */
.charts {
  display: flex;
  flex-direction: column;
  /* gap: 1.5rem; */
}

.day-header {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 0px;
  height: 140px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.bar-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* width: 8px; */
  position: relative;
}

.bar {
  width: 100%;
  background: #4ea1d3;
  border-radius: 2px 2px 0 0;
}

/* Hours strip below each day chart */
.hours-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: #c9d6e9;
  background: #25466b;
  border: 1px solid #3a5a82;
  border-radius: 4px;
  padding: 4px 6px;
}

.hour-cell {
  flex: 1 1 0;
  text-align: center;
  border-right: 1px solid #3a5a82;
}

.hour-cell:last-child {
  border-right: none;
}
</style>
