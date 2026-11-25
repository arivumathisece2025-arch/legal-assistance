export async function sessionHeaders(baseUrl: string, existingCookie?: string): Promise<{ cookie: string; csrfToken: string }> {
  const response = await fetch(`${baseUrl}/api/session`, {
    headers: existingCookie ? { cookie: existingCookie } : undefined,
  });
  const body = (await response.json()) as { csrfToken: string };
  const cookie = existingCookie?.split(";")[0] ?? response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { cookie, csrfToken: body.csrfToken };
}