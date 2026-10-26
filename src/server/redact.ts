export function redactSecrets(text: string, knownValues: (string|undefined)[] = []): string {
  let redacted=text;
  for(const value of knownValues)if(value && value!=='***')redacted=redacted.split(value).join('***');
  return redacted
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/g, '$1***')
    .replace(/(sk-[A-Za-z0-9_-])[A-Za-z0-9_\-]{16,}/g, '$1***')
    .replace(/("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*"?)[A-Za-z0-9._\-+/=]{8,}/gi, '$1***');
}

export function redactOauth(token: string): string {
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}
