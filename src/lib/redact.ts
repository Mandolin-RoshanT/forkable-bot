// Pure helpers for masking PII / secrets in log output.

export function redactCookie(value: string): string {
  return `<${value.length} chars, prefix: ${value.slice(0, 4)}>`;
}

export function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) {
    return '<invalid email>';
  }
  return `${user[0]}***@${domain}`;
}
