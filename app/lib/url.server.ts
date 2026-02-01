export function getPublicBaseUrl(request: Request): string {
  const publicUrl = process.env.PUBLIC_URL;
  if (publicUrl) {
    return publicUrl.replace(/\/$/, "");
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
