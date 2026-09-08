import type { WsErrorCode } from '@vtt/shared';

export class CommandRejection extends Error {
  constructor(readonly code: WsErrorCode, message: string, readonly fatal = false) { super(message); }
}
