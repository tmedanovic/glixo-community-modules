# Google Calendar service extraction

## Source

`integrations/calendar/googleCalendarAdapter.ts`

## Target (`glixo.calendar.google`)

| Implemented | Pending |
|-------------|---------|
| `/v1/events/today`, `/v1/summary` (7-day count) | Multi-calendar sync worker |
| SQLite event cache | Recurring event edge cases |

Uses `@glixo/google-native-auth` (same refresh token as Gmail when scopes combined).

Port **6123**.
