/** Estimate server minus browser wall-clock time from a round trip. */
export function clockSample(sentAt: number, receivedAt: number, serverAt: number) {
  return { rtt: receivedAt - sentAt, offset: serverAt - (sentAt + receivedAt) / 2 };
}

/** Accepted playhead in seconds; its timestamp is always in server clock time. */
export function playbackPosition(command: { action: string; time: number; atMs: number }, offset: number, now = Date.now()): number {
  return command.time + (command.action === 'play' ? Math.max(0, now + offset - command.atMs) / 1000 : 0);
}
