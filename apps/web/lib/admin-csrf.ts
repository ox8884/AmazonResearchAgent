export function adminCsrfHeaders(cookieString: string = document.cookie): Headers {
  const headers = new Headers();
  for (const entry of cookieString.split(';')) {
    const [name, ...valueParts] = entry.trim().split('=');
    if (name === 'ara_csrf') {
      headers.set('x-csrf-token', decodeURIComponent(valueParts.join('=')));
      break;
    }
  }
  return headers;
}
