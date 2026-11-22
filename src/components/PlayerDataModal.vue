<script setup>
  import * as ct from 'countries-and-timezones'

  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

  const props = defineProps({
    playerData: { type: Object, default: () => ({}) },
    playerName: { type: String, default: '' },
    country: { type: String, default: '' },
  })

  const emit = defineEmits(['close'])
  const modalBody = ref(null)
  const barTooltip = ref(null)
  const dayStartHour = 8
  const minutesPerDay = 24 * 60
  const millisecondsPerMinute = 60_000
  const millisecondsPerDay = minutesPerDay * millisecondsPerMinute
  const hourTicks = Array.from({ length: 13 }, (_, index) => (dayStartHour + index * 2) % 24)
  const maxContinuousInterval = 0.01
  const gapEndBarWidth = 0.0035
  const currentTime = ref(Date.now())
  let clockTimeout

  const days = computed(() =>
    Object.entries(props.playerData || {})
      .filter(([, points]) => Array.isArray(points))
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, points]) => ({
        date,
        label: formatDate(date),
        points: points
          .filter((point) =>
            ['interval_start', 'interval_end', 'point_diff'].every((key) =>
              Number.isFinite(Number(point?.[key]))
            )
          )
          .map((point) => ({
            ...getIntervalStyles(point),
            tooltipText: formatPointTooltip(point),
          })),
      }))
      .filter((day) => day.points.length > 0)
  )

  const currentTimeMarker = computed(() => {
    const shiftedTime = currentTime.value - dayStartHour * 60 * millisecondsPerMinute
    const date = new Date(shiftedTime).toISOString().slice(0, 10)
    if (days.value[days.value.length - 1]?.date !== date) return null

    const elapsed = (shiftedTime % millisecondsPerDay) / millisecondsPerDay
    return { date, left: `${elapsed * 100}%` }
  })

  function updateCurrentTime() {
    currentTime.value = Date.now()
    clockTimeout = window.setTimeout(
      updateCurrentTime,
      millisecondsPerMinute - (currentTime.value % millisecondsPerMinute)
    )
  }

  function formatDate(date) {
    const parsedDate = new Date(`${date}T00:00:00Z`)
    return Number.isNaN(parsedDate.getTime())
      ? date
      : new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(parsedDate)
  }

  function formatIntervalTime(fraction) {
    const totalMinutes = Math.round(Number(fraction) * minutesPerDay) + dayStartHour * 60
    const dayOffset = Math.floor(totalMinutes / minutesPerDay)
    const minutesInDay = ((totalMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay
    const hours = String(Math.floor(minutesInDay / 60)).padStart(2, '0')
    const minutes = String(minutesInDay % 60).padStart(2, '0')
    return `${dayOffset ? `+${dayOffset}d ` : ''}${hours}:${minutes}`
  }

  function formatPointTooltip(point) {
    const start = formatIntervalTime(point.interval_start)
    const end = formatIntervalTime(point.interval_end)
    return `${start}–${end} · +${point.point_diff} points · ${point.points} total`
  }

  function showBarTooltip(event, text) {
    const { clientX, clientY } = event
    const { clientWidth, clientHeight } = document.documentElement
    const offset = 10
    const placeRight = clientX < clientWidth / 2
    const placeBelow = clientY < clientHeight / 2
    const horizontalOffset = (placeRight ? clientX : clientWidth - clientX) + offset
    const verticalOffset = (placeBelow ? clientY : clientHeight - clientY) + offset

    barTooltip.value = {
      text,
      style: {
        [placeRight ? 'left' : 'right']: `${horizontalOffset}px`,
        [placeBelow ? 'top' : 'bottom']: `${verticalOffset}px`,
        maxWidth: `${clientWidth - horizontalOffset - offset}px`,
      },
    }
  }

  function hideBarTooltip() {
    barTooltip.value = null
  }

  function getIntervalStyles(point) {
    const intervalStart = Number(point.interval_start)
    const intervalEnd = Number(point.interval_end)
    const pointDiff = Number(point.point_diff)
    const start = Math.min(1, Math.max(0, intervalStart))
    const end = Math.min(1, Math.max(start, intervalEnd))
    const hasGap = intervalEnd - intervalStart > maxContinuousInterval + Number.EPSILON
    const barStart = hasGap ? Math.max(start, end - gapEndBarWidth) : start
    const height = (Math.min(30, Math.max(0, pointDiff)) / 30) * 100

    return {
      barStyle:
        pointDiff === 0
          ? null
          : {
              left: `${barStart * 100}%`,
              width: `${(end - barStart) * 100}%`,
              height: `${height}%`,
            },
      gapStyle:
        barStart > start
          ? { left: `${start * 100}%`, width: `${(barStart - start) * 100}%` }
          : null,
    }
  }

  function getCountryUtcOffsetLabel(country) {
    try {
      const countries = ct.getAllCountries ? ct.getAllCountries() : {}
      const input = String(country || '').trim()
      const code =
        input.length === 2 && countries[input.toUpperCase()]
          ? input.toUpperCase()
          : Object.entries(countries).find(
              ([, value]) => value.name.toLowerCase() === input.toLowerCase()
            )?.[0]
      if (!code) return ''

      const timezones = ct.getTimezonesForCountry(code)
      if (!timezones?.length) return ''
      const offset = Math.round(
        timezones.reduce((sum, timezone) => sum + (timezone.utcOffset || 0), 0) / timezones.length
      )
      const sign = offset >= 0 ? '+' : '-'
      const absoluteOffset = Math.abs(offset)
      const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0')
      const minutes = String(absoluteOffset % 60).padStart(2, '0')
      return `UTC${sign}${hours}:${minutes}`
    } catch {
      return ''
    }
  }

  function lockBodyScroll() {
    const scrollY = window.scrollY || window.pageYOffset || 0
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.dataset.scrollY = String(scrollY)
  }

  function unlockBodyScroll() {
    const scrollY = Number.parseInt(document.body.dataset.scrollY || '0', 10) || 0
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.left = ''
    document.body.style.right = ''
    document.body.style.width = ''
    delete document.body.dataset.scrollY
    window.scrollTo(0, scrollY)
  }

  function handleOverlayTouchMove(event) {
    if (event.target === event.currentTarget) event.preventDefault()
  }

  onMounted(() => {
    lockBodyScroll()
    updateCurrentTime()
    modalBody.value?.scrollTo({ top: modalBody.value.scrollHeight })
  })

  onBeforeUnmount(() => {
    window.clearTimeout(clockTimeout)
    unlockBodyScroll()
  })
</script>

<template>
  <div class="modal-overlay" @click="emit('close')" @touchmove="handleOverlayTouchMove">
    <section class="modal-content" @click.stop @touchmove.stop>
      <header class="modal-header">
        <h3>
          Player Data: {{ playerName }}
          <span v-if="country" class="country-pill">
            {{ country }}
            <span v-if="getCountryUtcOffsetLabel(country)" class="country-offset">
              ({{ getCountryUtcOffsetLabel(country) }})
            </span>
          </span>
        </h3>
        <button class="close-btn" aria-label="Close player data" @click="emit('close')">
          &times;
        </button>
      </header>

      <div ref="modalBody" class="modal-body" @scroll="hideBarTooltip">
        <div v-if="days.length" class="charts">
          <section v-for="day in days" :key="day.date" class="day-chart">
            <h4 class="day-header">{{ day.label }}</h4>
            <div class="timeline-scroll" @scroll="hideBarTooltip">
              <div class="timeline">
                <template v-for="(point, index) in day.points" :key="index">
                  <div v-if="point.gapStyle" class="data-gap" :style="point.gapStyle"></div>
                  <div
                    v-if="point.barStyle"
                    class="bar"
                    role="img"
                    :style="point.barStyle"
                    :aria-label="point.tooltipText"
                    @mouseenter="showBarTooltip($event, point.tooltipText)"
                    @mouseleave="hideBarTooltip"
                  ></div>
                </template>
                <div
                  v-if="currentTimeMarker?.date === day.date"
                  class="current-time-marker"
                  :style="{ left: currentTimeMarker.left }"
                  role="img"
                  aria-label="Current time (UTC)"
                ></div>
              </div>
              <div class="time-axis">
                <span
                  v-for="(hour, index) in hourTicks"
                  :key="index"
                  :class="{ 'axis-end': index === hourTicks.length - 1 }"
                  :style="{ left: `${(index / (hourTicks.length - 1)) * 100}%` }"
                >
                  {{ hour }}
                </span>
              </div>
            </div>
          </section>
        </div>
        <p v-else class="empty-state">No player data available.</p>
      </div>
    </section>
    <div v-if="barTooltip" class="bar-tooltip" :style="barTooltip.style" aria-hidden="true">
      {{ barTooltip.text }}
    </div>
  </div>
</template>

<style scoped>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.62);
  }

  .modal-content {
    width: min(1100px, 96vw);
    max-height: 90vh;
    overflow: hidden;
    background: rgb(30, 30, 56);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
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
    color: #cfe7ff;
    font-size: 0.8em;
    background: #355575;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
  }

  .country-offset {
    margin-left: 6px;
    opacity: 0.85;
  }

  .close-btn {
    display: flex;
    flex: 0 0 30px;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    font-size: 1.5rem;
    background: none;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
  }

  .close-btn:hover {
    background: #e5e5e5;
  }

  .modal-body {
    max-height: calc(90vh - 72px);
    padding: 1rem;
    overflow-y: auto;
  }

  .charts {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .day-header {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }

  .timeline-scroll {
    overflow-x: auto;
    padding-bottom: 1.25rem;
  }

  .timeline {
    position: relative;
    height: 132px;
    min-width: 680px;
    background-color: #1a2c40;
    background-image: repeating-linear-gradient(
      to right,
      transparent 0,
      transparent calc(8.333333% - 1px),
      rgba(183, 207, 228, 0.2) calc(8.333333% - 1px),
      rgba(183, 207, 228, 0.2) 8.333333%
    );
    border-bottom: 1px solid #8da6ba;
  }

  .data-gap {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: #ef6666;
    pointer-events: none;
  }

  .bar {
    position: absolute;
    bottom: 0;
    min-width: 1px;
    background: #4ea1d3;
    border-top: 1px solid #a9ddf5;
  }

  .bar:hover {
    z-index: 1;
    background: #a9ddf5;
    border-top-color: #e3f6ff;
  }

  .current-time-marker {
    position: absolute;
    inset-block: 0;
    z-index: 1;
    width: 2px;
    background: #ffd166;
    pointer-events: none;
  }

  .bar-tooltip {
    position: fixed;
    z-index: 2;
    box-sizing: border-box;
    width: max-content;
    padding: 0.35rem 0.55rem;
    color: #e3f6ff;
    font-size: 0.8rem;
    background: #1a2c40;
    border: 1px solid #8da6ba;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .time-axis {
    position: relative;
    min-width: 680px;
    height: 1rem;
    margin-top: 0.35rem;
    color: #c9d6e9;
    font-size: 0.75rem;
  }

  .time-axis span {
    position: absolute;
    transform: translateX(-50%);
  }

  .time-axis .axis-end {
    transform: translateX(-100%);
  }

  .empty-state {
    margin: 0;
    color: #aaa;
  }

  @media (max-width: 560px) {
    .modal-overlay {
      padding: 0;
    }

    .modal-content {
      width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }

    .modal-body {
      max-height: calc(100vh - 72px);
      padding: 0.75rem;
    }

    .modal-header {
      padding: 0.75rem;
    }

    .modal-header h3 {
      font-size: 1rem;
    }
  }
</style>
