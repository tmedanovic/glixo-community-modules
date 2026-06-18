export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GOOGLE_SCOPES = {
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  calendarReadonly: 'https://www.googleapis.com/auth/calendar.readonly',
  contactsReadonly: 'https://www.googleapis.com/auth/contacts.readonly',
} as const;
