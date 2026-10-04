export const viewerMatches =
  import.meta.env.MODE === 'e2e'
    ? ['http://127.0.0.1/*']
    : ['https://novelpia.com/viewer/*', 'https://www.novelpia.com/viewer/*'];
