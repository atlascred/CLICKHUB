export function clearSentDraft<T>(current: { message: string; file: T | null }, sent: { message: string; file: T | null }, keepText = false) {
  return { message: !keepText && current.message === sent.message ? "" : current.message,
    file: current.file === sent.file ? null : current.file };
}
export function mergeRecentMessages<T extends { id: string; createdAt: string }>(current: T[], recent: T[]) {
  return [...new Map([...current, ...recent].map(message => [message.id, message])).values()]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
