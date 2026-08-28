export function providerFormKey(
  saved: { readonly id: string; readonly settingsRevision: number } | null
): string {
  return saved ? `${saved.id}:${saved.settingsRevision}` : 'new';
}
