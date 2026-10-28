import React, { useState, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import { ThemedText } from '@/components/ThemedText'
import { Colors, brand, type ThemeColors } from '@/constants/Colors'
import { useColorScheme } from '@/hooks/useColorScheme'
import { useT } from '@/contexts/LocaleContext'
import { useHasMounted } from '@/hooks/useHasMounted'

function getUtcOffsetString(): string {
  const offsetMinutes = new Date().getTimezoneOffset()
  const totalMinutes = -offsetMinutes
  const sign = totalMinutes >= 0 ? '+' : '-'
  const absHours = Math.floor(Math.abs(totalMinutes) / 60)
  const absMins = Math.abs(totalMinutes) % 60
  if (absMins === 0) {
    return `UTC${sign}${absHours}`
  }
  const paddedMins = absMins.toString().padStart(2, '0')
  return `UTC${sign}${absHours}:${paddedMins}`
}

function getTimezoneName(): string {
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (name && name.length > 0) {
      return name
    }
    return getUtcOffsetString()
  } catch {
    return getUtcOffsetString()
  }
}

function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDate(date: Date): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' })
  const day = date.getDate()
  const month = date.toLocaleDateString(undefined, { month: 'short' })
  return `${weekday} ${day} ${month}`
}

export function TimezoneBar(): React.JSX.Element {
  const { t } = useT()
  const colorScheme = useColorScheme()
  const scheme = colorScheme ?? 'light'
  const colors: ThemeColors = Colors[scheme]

  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 60_000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  // The zone, date and time come from the viewer's device. The static web HTML
  // is rendered at build time on another machine, so they are only shown after
  // mount; rendering them earlier breaks hydration (QA U3, React error #418).
  const hasMounted = useHasMounted()
  const tzName = hasMounted ? getTimezoneName() : ''
  const utcOffset = hasMounted ? getUtcOffsetString() : ''
  const timeStr = hasMounted ? formatTime(now) : ''
  const dateStr = hasMounted ? formatDate(now) : ''
  const tzDisplay = hasMounted ? `${tzName} (${utcOffset})` : ''

  const accessibilityLabel = hasMounted
    ? `${t('timezone.schedulingIn')} ${tzName}, ${timeStr}`
    : t('timezone.schedulingIn')

  const styles = StyleSheet.create({
    container: {
      height: 44,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderLeftWidth: 3,
      borderLeftColor: brand.primary,
      paddingHorizontal: 10,
    },
    icon: {
      fontSize: 16,
      marginRight: 6,
    },
    labelText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginRight: 4,
    },
    tzText: {
      fontSize: 13,
      color: colors.text,
    },
    spacer: {
      flex: 1,
    },
    dateText: {
      fontSize: 13,
      color: colors.text,
      marginRight: 4,
    },
    separator: {
      fontSize: 12,
      color: colors.textSecondary,
      marginRight: 4,
    },
    timeText: {
      fontSize: 13,
      color: colors.text,
    },
  })

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <ThemedText style={styles.icon}>⏰</ThemedText>
      <ThemedText style={styles.labelText}>
        {t('timezone.schedulingIn')}
      </ThemedText>
      <ThemedText style={styles.tzText}>{tzDisplay}</ThemedText>
      <View style={styles.spacer} />
      {hasMounted ? (
        <>
          <ThemedText style={styles.dateText}>{dateStr}</ThemedText>
          <ThemedText style={styles.separator}>·</ThemedText>
          <ThemedText style={styles.timeText}>{timeStr}</ThemedText>
        </>
      ) : null}
    </View>
  )
}