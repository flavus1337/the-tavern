import { useState } from 'react';
import { parseDiceExpression, randomId } from '@vtt/shared';
import type { DieSides, RollVisibility } from '@vtt/shared';
import { useStore } from '../store';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const QUICK_DICE: DieSides[] = [4, 6, 8, 10, 12, 20, 100];

export function DiceRoller() {
  const connection = useStore((s) => s.connection);
  const self = useStore((s) => s.self);

  const [expression, setExpression] = useState('');
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<RollVisibility>('public');
  const [expressionError, setExpressionError] = useState<string | null>(null);

  const isDm = self?.role === 'dm';

  function getConn() {
    return (window as unknown as { __vttConn?: { send: (msg: unknown) => void } }).__vttConn;
  }

  function sendRoll(expr: string, lbl?: string) {
    const conn = getConn();
    if (!conn || connection !== 'open') return;
    conn.send({
      type: 'roll',
      requestId: randomId('req'),
      expression: expr,
      label: lbl || undefined,
      visibility,
    });
  }

  function handleQuickRoll(sides: DieSides) {
    sendRoll(`d${sides}`);
  }

  function handleExpressionChange(val: string) {
    setExpression(val);
    if (val.trim()) {
      const result = parseDiceExpression(val);
      setExpressionError(result.ok ? null : result.error);
    } else {
      setExpressionError(null);
    }
  }

  function handleRoll() {
    if (!expression.trim()) return;
    const result = parseDiceExpression(expression);
    if (!result.ok) {
      setExpressionError(result.error);
      return;
    }
    sendRoll(result.roll.normalized, label || undefined);
  }

  const disabled = connection !== 'open';

  return (
    <div className="p-3 space-y-4">
      {/* Quick roll buttons */}
      <div>
        <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wider">Quick Roll</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DICE.map((sides) => (
            <button
              key={sides}
              type="button"
              disabled={disabled}
              onClick={() => handleQuickRoll(sides)}
              className={`
                px-2.5 py-1.5 text-xs font-medium rounded border transition-colors
                font-mono
                ${disabled
                  ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'border-zinc-700 text-zinc-300 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white active:scale-95'
                }
              `}
              aria-label={`Roll d${sides}`}
            >
              d{sides}
            </button>
          ))}
        </div>
      </div>

      {/* Expression roller */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Expression</p>

        <div className="space-y-1.5">
          <Label htmlFor="dice-expr" className="text-xs">Expression</Label>
          <Input
            id="dice-expr"
            type="text"
            value={expression}
            onChange={(e) => handleExpressionChange(e.target.value)}
            placeholder="2d6+3"
            disabled={disabled}
            error={!!expressionError}
            className="font-mono text-sm"
          />
          {expressionError && (
            <p className="text-xs text-red-400" role="alert">{expressionError}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dice-label" className="text-xs">Label <span className="text-zinc-600 font-normal">(optional)</span></Label>
          <Input
            id="dice-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Attack roll"
            disabled={disabled}
            className="text-sm"
          />
        </div>

        {isDm && (
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visibility === 'dm'}
              onChange={(e) => setVisibility(e.target.checked ? 'dm' : 'public')}
              disabled={disabled}
              className="rounded"
            />
            Private (DM only)
          </label>
        )}

        <Button
          onClick={handleRoll}
          disabled={disabled || !expression.trim() || !!expressionError}
          className="w-full"
          size="sm"
        >
          Roll
        </Button>
      </div>
    </div>
  );
}
