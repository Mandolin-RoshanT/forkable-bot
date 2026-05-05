// Spike logging: prefix every line with `[capture-ops]`, redact PII before
// it hits stdout. Three levels — info goes to stdout, error to stderr, debug
// is suppressed unless DEBUG=1 is set in the environment.

export function log(msg: string): void {
  console.log(`[capture-ops] ${msg}`);
}

export function logError(msg: string): void {
  console.error(`[capture-ops] ${msg}`);
}

export function logDebug(msg: string): void {
  if (process.env.DEBUG === '1') {
    console.log(`[capture-ops] ${msg}`);
  }
}

export function redactCookie(value: string): string {
  return `<${value.length} chars, prefix: ${value.slice(0, 4)}>`;
}

export function redactEmail(email: string): string {
  const parts = email.split('@');
  const user = parts[0];
  const domain = parts[1];
  if (!user || !domain) {
    return '<invalid email>';
  }
  return `${user[0]}***@${domain}`;
}
