<script setup>
import { ref, onMounted } from 'vue'
import * as ct from 'countries-and-timezones'

// const API_BASE_URL = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
//   ? 'http://localhost:8000'
//   : 'https://zooming-liberation-production.up.railway.app'

  const API_BASE_URL ='https://zooming-liberation-production.up.railway.app'

const allTables = ref([])
const ploTables = ref([])
const ploDataByTable = ref({})
const playerData = ref({})
const showPlayerModal = ref(false)
const selectedPlayerName = ref('')
const selectedTable = ref('PLO___050100')
const currentUtcDateKey = ref('')
const currentUtcMinutesOfDay = ref(0)
const topPlayers = ref([])
const topPlayersLoading = ref(false)
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
    ploTables.value = allTables.value.filter((name) => typeof name === 'string' && name.toLowerCase().startsWith('plo'))
    // Set default/selected table
    if (!selectedTable.value || !ploTables.value.includes(selectedTable.value)) {
      selectedTable.value = ploTables.value.includes('PLO___050100') ? 'PLO___050100' : (ploTables.value[0] || '')
    }
    await fetchPloTablesData()
    if (selectedTable.value) {
      fetchTopPlayers(selectedTable.value)
    }
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
        console.log(payload, 'payload')
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

async function fetchTopPlayers(tableName) {
  topPlayersLoading.value = true
  try {
    const res = await fetchJSON(`${API_BASE_URL}/tables/${encodeURIComponent(tableName)}/top-players?limit=24`)
    if (Array.isArray(res)) {
      topPlayers.value = res
    } else if (Array.isArray(res?.rows)) {
      topPlayers.value = res.rows
    } else {
      topPlayers.value = []
    }
  } catch (e) {
    // don't block main UI on this error; surface quietly
    console.error('Failed to fetch top players:', e)
  } finally {
    topPlayersLoading.value = false
  }
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
  const ts = parseCustomTimestamp(str)
  if (ts) {
    return `${ts.hours}:${ts.minutes}`
  }
  return ''
}

function formatTimestampForModal(str) {
  const ts = parseCustomTimestamp(str)
  if (ts) {
    return `${ts.year} ${ts.month} ${ts.day} ${ts.hours}:${ts.minutes}`
  }
  return str
}

function parseNumberLoose(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim()
    const num = parseFloat(cleaned)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function isRowLive(columns, row) {
  try {
    const tsCols = []
    for (let i = 0; i < columns.length; i++) {
      const name = columns[i]
      const ts = parseCustomTimestamp(name)
      if (ts) tsCols.push({ name, idx: i })
    }
    if (tsCols.length < 2) return false
    const last = tsCols[tsCols.length - 1]
    const prev = tsCols[tsCols.length - 2]
    const getVal = (r, colName, idx) => Array.isArray(r) ? r[idx] : r[colName]
    const vLast = parseNumberLoose(getVal(row, last.name, last.idx))
    const vPrev = parseNumberLoose(getVal(row, prev.name, prev.idx))
    if (vLast === null || vPrev === null) return false
    return vLast > vPrev
  } catch {
    return false
  }
}

function getCountryCodeFromNameOrCode(countryStr) {
  if (!countryStr) return ''
  const input = String(countryStr).trim()
  const countries = (ct.getCountries && ct.getCountries()) || (ct.getAllCountries && ct.getAllCountries()) || {}
  if (!countries || Object.keys(countries).length === 0) return ''
  // If already ISO2 code
  const maybeCode = input.toUpperCase()
  if (maybeCode.length === 2 && countries[maybeCode]) return maybeCode
  // Find by name (case-insensitive exact match)
  const entries = Object.entries(countries)
  const direct = entries.find(([, c]) => String(c.name).toLowerCase() === input.toLowerCase())
  if (direct) return direct[0]
  // Fallback: startsWith match
  const fuzzy = entries.find(([, c]) => String(c.name).toLowerCase().startsWith(input.toLowerCase()))
  return fuzzy ? fuzzy[0] : ''
}

function formatUtcOffsetLabel(offsetMinutes) {
  if (offsetMinutes === null || offsetMinutes === undefined) return ''
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hh = zeroPad(Math.floor(abs / 60))
  const mm = zeroPad(abs % 60)
  return `UTC${sign}${hh}:${mm}`
}

function getCountryUtcOffsetLabel(countryStr) {
  try {
    const code = getCountryCodeFromNameOrCode(countryStr)
   
    if (!code) return ''
    const timezones = ct.getTimezonesForCountry ? ct.getTimezonesForCountry(code) : []
    if (!timezones || timezones.length === 0) return ''
    // Average standard offsets (minutes) across country's timezones
    const avg = Math.round(timezones.reduce((sum, tz) => sum + (tz.utcOffset || 0), 0) / timezones.length)
    return formatUtcOffsetLabel(avg)
  } catch (e) {
    return ''
  }
}

function parseCustomTimestamp(str) {
  // New format: YYYY-MM-DD HH:MM(:SS)?
  let match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(str)
  if (match) {
    return { year: match[1], month: match[2], day: match[3], hours: match[4], minutes: match[5] }
  }
  // Backwards compat: ts_YYYY_MM_DD_HHhMM
  match = /^ts_(\d{4})_(\d{2})_(\d{2})_(\d{2})h(\d{2})$/i.exec(str)
  if (match) {
    return { year: match[1], month: match[2], day: match[3], hours: match[4], minutes: match[5] }
  }
  // RFC 1123 / HTTP-date, e.g. "Sun, 24 Aug 2025 21:03:24 GMT"
  const d = new Date(str)
  if (!isNaN(d.getTime())) {
    const year = String(d.getUTCFullYear())
    const month = zeroPad(d.getUTCMonth() + 1)
    const day = zeroPad(d.getUTCDate())
    const hours = zeroPad(d.getUTCHours())
    const minutes = zeroPad(d.getUTCMinutes())
    return { year, month, day, hours, minutes }
  }
  return null
}

function zeroPad(n) {
  const num = typeof n === 'number' ? n : parseInt(String(n), 10)
  return num < 10 ? `0${num}` : String(num)
}

function setNowUtc() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = zeroPad(now.getUTCMonth() + 1)
  const d = zeroPad(now.getUTCDate())
  const hh = now.getUTCHours()
  const mm = now.getUTCMinutes()
  currentUtcDateKey.value = `${y}-${m}-${d}`
  currentUtcMinutesOfDay.value = hh * 60 + mm
}

// function normalizeNumber(value) {
//   if (value === null || value === undefined) return null
//   if (typeof value === 'number') return value
//   if (typeof value === 'string') {
//     const cleaned = value.replace(/,/g, '').trim()
//     const num = parseFloat(cleaned)
//     return Number.isFinite(num) ? num : null
//   }
//   return null
// }

function computeDailyDeltas(pd) {
  if (!pd || !Array.isArray(pd.columns) || !Array.isArray(pd.rows)) return []
  let lastNumeric = 0
  const dailyMap = new Map()
  
  for (let i = 0; i < pd.columns.length; i++) {
    const col = pd.columns[i]
    const ts = parseCustomTimestamp(col)
    if (!ts) continue
    const val = pd.rows[i]
    
    const minutesFromMidnight = parseInt(ts.hours, 10) * 60 + parseInt(ts.minutes, 10)
    const dateKey = `${ts.year}-${ts.month}-${ts.day}`
    const dateLabel = `${ts.year} ${ts.month} ${ts.day}`
    let dayEntry = dailyMap.get(dateKey)
    if (!dayEntry) {
      dayEntry = { dateKey, dateLabel, points: [], maxDelta: 0, lastMinutes: null }
      dailyMap.set(dateKey, dayEntry)
    }

   
    const delta = val - lastNumeric
    
    const timeDeltaMinutes = dayEntry.lastMinutes === null ? minutesFromMidnight : Math.max(0, minutesFromMidnight - dayEntry.lastMinutes)
    const timeLabel = `${ts.hours}:${ts.minutes}`
    const clampedDelta = Math.min(20, Math.max(0, delta))
    const truncates = clampedDelta !== delta
    
    dayEntry.points.push({ timeLabel, delta, clampedDelta, timeDeltaMinutes, truncates, value: val })
    if (clampedDelta > dayEntry.maxDelta) dayEntry.maxDelta = clampedDelta
    

    dayEntry.lastMinutes = minutesFromMidnight
   
    lastNumeric = val
  }
  // console.log(Array.from(dailyMap.values()))
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
    setNowUtc()
    showPlayerModal.value = true
    // console.log('Player data received:', response)
  } catch (e) {
    console.error('Failed to fetch player data:', e)
    error.value = `Failed to fetch player data: ${e.message}`
  }
}

onMounted(() => {
  fetchTables()
})
</script>

<template>
  <main class="container">
    <header class="header">
      <!-- <h1>GG Tables</h1> -->
    
    </header>

    <section class="status" v-if="error">
      <div class="error">{{ error }}</div>
    </section>

    <div class="layout">
      <aside class="sidebar">
        <h3>Top players</h3>
        <div v-if="topPlayersLoading" class="muted">Loading…</div>
        <div v-else-if="topPlayers.length === 0" class="muted">No players.</div>
        <ul v-else class="players-list">
          <li v-for="name in topPlayers" :key="name">
            <span class="clickable-name" @click="handleNameClick(name, selectedTable)">{{ name }}</span>
          </li>
        </ul>
      </aside>

      <section class="content">
        <nav class="tables-menu" v-if="ploTables.length">
          <button
            v-for="t in ploTables"
            :key="t"
            class="table-tab"
            :class="{ active: t === selectedTable }"
            @click="selectedTable = t; fetchTopPlayers(t)"
          >
            {{ t }}
          </button>
        </nav>
        <!-- <section class="all-tables">
      <h2>All Tables ({{ allTables.length }})</h2>
      <div v-if="allTables.length === 0" class="muted">No tables found.</div>
      <ul v-else class="table-list">
        <li v-for="name in allTables" :key="name">{{ name }}</li>
      </ul>
    </section> -->

        <section class="plo-tables">
          <div class="controls">
        <button @click="fetchTables" :disabled="loading || topPlayersLoading">{{ loading ? 'Loading…' : 'Reload' }}</button>
      </div>
          <!-- <h2>PLO___050100 Table</h2> -->
          <div v-if="ploTables.length === 0" class="muted">No PLO tables.</div>

          <div v-for="tableName in ploTables" :key="tableName" v-show="tableName === selectedTable" class="table-block">
            <!-- <h3>{{ tableName }}</h3> -->
            <div v-if="!(ploDataByTable[tableName] && (ploDataByTable[tableName].rows || []).length > 0)" class="muted">No rows.</div>
            <div v-else class="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Live</th>
                    <th v-for="(col, cIdx) in (ploDataByTable[tableName]?.columns || [])" :key="cIdx">{{ formatCell(col) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rIdx) in (ploDataByTable[tableName]?.rows || [])" :key="rIdx">
                    <td>
                      <span :class="isRowLive(ploDataByTable[tableName]?.columns || [], row) ? 'live-ind live-yes' : 'live-ind live-no'" aria-label="Live status"></span>
                    </td>
                    <td v-for="(col, cIdx) in (ploDataByTable[tableName]?.columns || [])" :key="cIdx">
                      <span v-if="cIdx === 0" 
                            @click="handleNameClick(Array.isArray(row) ? row[cIdx] : row[col], tableName)" 
                            class="clickable-name">
                        {{ formatCell(Array.isArray(row) ? row[cIdx] : row[col]) }}
                      </span>
                      <span v-else>{{ Array.isArray(row) ? row[cIdx] : row[col] }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </div>

    <!-- Player Data Modal -->
    <div v-if="showPlayerModal" class="modal-overlay" @click="showPlayerModal = false">
      <!-- <div>aaaa   {{ playerData.rows }}aaaaa</div> -->
      <!-- <div v-for="player in playerData" :key="player.name">{{ player }}</div> -->
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Player Data: {{ selectedPlayerName }} 
            <span v-if="playerData && playerData.country" class="country-pill">
              {{ playerData.country }}
              <span class="country-offset" v-if="getCountryUtcOffsetLabel(playerData.country)">
                ({{ getCountryUtcOffsetLabel(playerData.country) }})
              </span>
            </span>
          </h3>
          <button class="close-btn" @click="showPlayerModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="playerData && playerData.columns && playerData.rows && playerData.rows.length > 0" class="charts">
            <div v-for="day in computeDailyDeltas(playerData)" :key="day.dateKey" class="day-chart">
              <div class="day-header">{{ day.dateLabel }}</div>
              <div class="bar-chart">
                <div class="bar-chart-content">
                  <div class="eight-line" :style="{ left: ((8 * 60) / 1440 * 100) + '%' }"></div>
                  <div v-for="(pt, i) in day.points" :key="i" class="bar-column" :title="pt.timeLabel + ' Δ ' + pt.delta + ' total ' + pt.value" :style="{ width: ((pt.timeDeltaMinutes || 0) / 1440 * 100) + '%' }">
                    <div
                      class="bar"
                      :style="{
                        height: (day.maxDelta ? (pt.clampedDelta || 0) / day.maxDelta * 120 : 0) + 'px',
                        background: pt.truncates ? '#3576a6' : '#4ea1d3'
                      }"
                    ></div>
                    <!-- <div v-if="i % 30 === 0" class="bar-label">{{ pt.timeLabel }}</div> -->
                  </div>
                  <div v-if="day.dateKey === currentUtcDateKey" class="now-line" :style="{ left: (currentUtcMinutesOfDay / 1440 * 100) + '%' }"></div>
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
  </main>
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

.layout {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.sidebar {
  width: 240px;
  min-width: 100px;
  background: #13202f41;
  /* opacity: 60.8; */
  border: 1px solid #355575;
  border-radius: 8px;
  padding: 0.75rem;
}

.sidebar h3 {
  margin: 0 0 0.5rem 0;
}

.players-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.players-list li {
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.players-list li:last-child {
  border-bottom: none;
}

.content {
  flex: 1 1 auto;
}

.tables-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.table-tab {
  padding: 4px 8px;
  border: 1px solid #355575;
  background: #1b2e45;
  color: #d4e7ff;
  border-radius: 6px;
  cursor: pointer;
}

.table-tab.active {
  background: #2d5074;
  border-color: #4b759a;
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

/* Live indicator */
.live-ind {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.live-yes {
  background: radial-gradient(circle at center, #f691919e 30%, #c36c6ca1 70%);
  box-shadow: 0 0 6px rgba(255, 97, 97, 0.562);
}

.live-no {
  background: linear-gradient(135deg, #3a556d, #2a3e53);
  opacity: 0.5;
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

.country-pill {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 0.8em;
  color: #cfe7ff;
  background: #355575;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
}

.country-offset {
  margin-left: 6px;
  opacity: 0.85;
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
  display: block;
  overflow-x: auto;
  padding-bottom: 8px;
}

.bar-chart-content {
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  gap: 0px;
  height: 140px;
  min-width: 100%;
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

.now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #ffcc66;
  box-shadow: 0 0 2px rgba(255, 204, 102, 0.8);
  z-index: 2;
}

.eight-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(60, 100, 150, 0.5);
  z-index: 1;
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
