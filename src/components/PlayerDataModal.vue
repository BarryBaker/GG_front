<script setup>
  import * as ct from 'countries-and-timezones'

  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

  import AppDialog from './AppDialog.vue'

  const props = defineProps({
    playerData: { type: Object, default: () => ({}) },
    playerName: { type: String, default: '' },
    country: { type: String, default: '' },
  })

  const emit = defineEmits(['close'])
  const barTooltip = ref(null)
  const dayStartHour = 8
  const minutesPerDay = 24 * 60
  const millisecondsPerMinute = 60_000
  const millisecondsPerDay = minutesPerDay * millisecondsPerMinute
  const dayStartOffset = dayStartHour * 60 * millisecondsPerMinute
  const hourTicks = Array.from({ length: 13 }, (_, index) => (dayStartHour + index * 2) % 24)
  const dayFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const maxContinuousInterval = 0.01
  const gapEndBarWidth = 0.0035
  const currentTime = ref(Date.now())
  let clockTimeout

  const activityByDay = computed(() => {
    const activity = new Map()
    for (const [date, points] of Object.entries(props.playerData ?? {})) {
      if (!Array.isArray(points) || !points.length) continue
      const timestamp = Date.parse(`${date}T00:00:00Z`)
      if (!Number.isFinite(timestamp)) continue

      const intervals = points
        .filter((point) =>
          ['interval_start', 'interval_end', 'point_diff'].every((key) =>
            Number.isFinite(Number(point?.[key]))
          )
        )
        .map((point) => ({
          ...getIntervalStyles(point),
          tooltipText: formatPointTooltip(point),
        }))
      if (intervals.length) {
        activity.set(timestamp, {
          points: intervals,
          totalPoints: points[points.length - 1]?.points ?? null,
        })
      }
    }
    return activity
  })

  const currentDay = computed(
    () => Math.floor((currentTime.value - dayStartOffset) / millisecondsPerDay) * millisecondsPerDay
  )

  const days = computed(() => {
    const activity = activityByDay.value
    if (!activity.size) return []

    const firstDay = Math.min(...activity.keys())
    const timelineDays = []
    for (let date = firstDay; date <= currentDay.value; date += millisecondsPerDay) {
      const dayActivity = activity.get(date)
      timelineDays.push({
        date,
        label: dayFormatter.format(date),
        points: dayActivity?.points ?? [],
        totalPoints: dayActivity?.totalPoints ?? null,
      })
    }
    return timelineDays
  })

  const currentTimePosition = computed(() => {
    const elapsed = currentTime.value - (currentDay.value + dayStartOffset)
    return `${(elapsed / millisecondsPerDay) * 100}%`
  })

  function updateCurrentTime() {
    currentTime.value = Date.now()
    clockTimeout = window.setTimeout(
      updateCurrentTime,
      millisecondsPerMinute - (currentTime.value % millisecondsPerMinute)
    )
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
        intervalStart !== 0 && barStart > start
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

  const countryLabel = computed(() => {
    if (!props.country) return ''
    const offset = getCountryUtcOffsetLabel(props.country)
    return offset ? `${props.country} (${offset})` : props.country
  })

  onMounted(updateCurrentTime)
  onBeforeUnmount(() => window.clearTimeout(clockTimeout))
</script>

<template>
  <AppDialog
    :title="playerName"
    wide
    compact
    start-at-end
    @close="emit('close')"
    @scroll="hideBarTooltip"
  >
    <template #title>
      <span class="player-title" :title="playerName">{{ playerName }}</span>
      <span v-if="countryLabel" class="player-country" :title="countryLabel">{{
        countryLabel
      }}</span>
    </template>
    <div v-if="days.length" class="charts">
      <section v-for="day in days" :key="day.date" class="day-chart">
        <h3 class="day-header">
          {{ day.label }}
          <span v-if="day.totalPoints !== null"> · {{ day.totalPoints }} total points</span>
        </h3>
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
            v-if="day.date === currentDay"
            class="current-time-marker"
            :style="{ left: currentTimePosition }"
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
      </section>
    </div>
    <p v-else class="empty-state">No player data available.</p>
    <template #overlay>
      <div v-if="barTooltip" class="bar-tooltip" :style="barTooltip.style" aria-hidden="true">
        {{ barTooltip.text }}
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
  .player-title,
  .player-country {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-country {
    flex: 0 0 auto;
    max-width: 60%;
    padding-inline-start: 0.45rem;
    color: var(--color-muted);
    border-inline-start: 1px solid var(--color-border-strong);
    font-size: 0.75rem;
    font-weight: 550;
    letter-spacing: 0;
  }

  .charts {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .day-chart {
    min-width: 0;
    padding: 0.55rem 0.6rem 0.4rem;
    background: var(--color-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-control);
  }

  .day-header {
    margin: 0 0 0.4rem;
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .timeline {
    position: relative;
    height: 99px;
    overflow: clip;
    background-color: var(--color-canvas);
    background-image: repeating-linear-gradient(
      to right,
      var(--color-clear) 0,
      var(--color-clear) calc(8.333333% - 1px),
      var(--color-border) calc(8.333333% - 1px),
      var(--color-border) 8.333333%
    );
    border-bottom: 1px solid var(--color-border-strong);
  }

  .data-gap {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: var(--color-danger);
    pointer-events: none;
  }

  .bar {
    position: absolute;
    bottom: 0;
    min-width: 1px;
    background: var(--color-chart-bar);
    border-top: 1px solid var(--color-accent);
  }

  .bar:hover {
    z-index: 1;
    background: var(--color-accent);
    border-top-color: var(--color-accent-hover);
  }

  .current-time-marker {
    position: absolute;
    inset-block: 0;
    z-index: 1;
    width: 2px;
    background: var(--color-chart-marker);
    pointer-events: none;
  }

  .bar-tooltip {
    position: fixed;
    z-index: 2;
    width: max-content;
    padding: 0.35rem 0.55rem;
    color: var(--color-text);
    background: var(--color-raised);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-control);
    box-shadow: 0 2px 8px var(--color-shadow);
    font-size: 0.8rem;
    pointer-events: none;
  }

  .time-axis {
    position: relative;
    height: 0.9rem;
    margin-top: 0.2rem;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    line-height: 1.2;
  }

  .time-axis span {
    position: absolute;
    transform: translateX(-50%);
  }

  .time-axis span:first-child {
    transform: none;
  }

  .time-axis .axis-end {
    transform: translateX(-100%);
  }

  .empty-state {
    margin: 0;
    color: var(--color-muted);
  }
</style>
