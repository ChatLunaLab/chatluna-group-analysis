const DAY_MS = 24 * 60 * 60 * 1000

export function getStartTimeByDays(days: number, useCalendarDayWindow = true) {
    const now = new Date()
    if (!useCalendarDayWindow) return new Date(now.getTime() - days * DAY_MS)

    const start = new Date(now.getTime() - (days - 1) * DAY_MS)
    start.setHours(0, 0, 0, 0)
    return start
}

export function isCacheExpired(date: Date | undefined, ttl: number) {
    return ttl <= 0 || !date || Date.now() - date.getTime() > ttl
}
