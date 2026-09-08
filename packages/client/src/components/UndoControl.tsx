import { useEffect } from 'react';
import { useStore } from '../store';
import { Button } from './ui/button';
import { useSaveCommand } from './SaveFeedback';

/** A server receipt is offered only after its originating commit is acknowledged. */
export function UndoControl() {
  const receipt = useStore((state) => state.undoReceipt);
  const connected = useStore((state) => state.connection === 'open');
  const pending = useStore((state) => state.pendingCommands);
  const save = useSaveCommand();
  useEffect(() => { if (receipt) save.clearError(); }, [receipt?.receiptId]);
  if (!receipt && !save.saving && !save.error) return null;
  return <div className="absolute left-3 top-16 z-[6] rounded-lg border shadow-lg overflow-hidden"
    style={{ maxWidth: 'calc(100% - 24px)', background: 'var(--surface)', borderColor: 'var(--border)' }}>
    {receipt && <Button variant="secondary" size="sm" className="whitespace-normal text-left"
      disabled={!connected || pending > 0 || save.saving || save.blocked}
      onClick={() => void save.run({ type: 'undo', receiptId: receipt.receiptId })}>
      Undo {receipt.label}
    </Button>}
    {(save.saving || save.error) && <div className="p-3 text-sm" role={save.error ? 'alert' : 'status'}>
      {save.saving ? 'Undoing…' : save.error?.uncertain
        ? 'Undo is unconfirmed. Check the board after reconnecting; this Undo action has been cleared.'
        : `Undo failed: ${save.error?.message}`}
    </div>}
    {!receipt && save.error && <button type="button" className="m-3 mt-0 text-xs underline" onClick={save.clearError}>Dismiss undo message</button>}
  </div>;
}
