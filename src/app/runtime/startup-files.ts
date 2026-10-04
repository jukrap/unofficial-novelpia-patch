/** Failed static imports remain linked to their failed dependencies in Chromium.
 * Check the packaged startup graph before evaluating it, so a cold-start resource
 * failure is still retryable. This never fetches settings UI or remote code.
 */
export async function prepareStartupFiles(base: string, signal: AbortSignal) {
  const response = await fetch(`${base}startup.json`, { signal });
  if (!response.ok) throw new Error('뷰어 시작 파일을 확인하지 못했습니다.');
  const files: unknown = await response.json();
  if (
    !Array.isArray(files) ||
    !files.includes('viewer.js') ||
    files.length > 20 ||
    !files.every((file) => typeof file === 'string' && /^[a-zA-Z0-9_-]+\.js$/.test(file))
  )
    throw new Error('뷰어 시작 파일 목록이 올바르지 않습니다.');
  await Promise.all(
    files.map(async (file: string) => {
      const resource = await fetch(`${base}${file}`, { signal });
      if (!resource.ok) throw new Error('뷰어 시작 파일을 불러오지 못했습니다.');
      await resource.arrayBuffer();
    })
  );
}
