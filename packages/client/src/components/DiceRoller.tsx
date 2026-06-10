import { useState } from 'react';
import { parseDiceExpression, randomId } from '@vtt/shared';
import type { DieSides, RollVisibility } from '@vtt/shared';
import { useStore } from '../store';
import { Input } from './ui/input';

const QUICK_DICE: DieSides[] = [4, 6, 8, 10, 12, 20, 100];

export function DiceRoller() {
  const connection = useStore((s) => s.connection);
  const self = useStore((s) => s.self);

  const [expression, setExpression] = useState('');
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<RollVisibility>('public');
  const [advantage, setAdvantage] = useState(false);
  const [disadvantage, setDisadvantage] = useState(false);
  const [expressionError, setExpressionError] = useState<string | null>(null);

  const isDm = self?.role === 'dm';
  const disabled = connection !== 'open';

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

  function handleQuickRoll(die: DieSides) {
    sendRoll(advantage ? `2d${die}kh` : disadvantage ? `2d${die}kl` : `d${die}`);
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

  return (
    <div style={{ padding: 14 }} className="space-y-4">

      {/* Quick Roll */}
      <div>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 12, fontWeight: 500 }}>
          Quick Roll
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {QUICK_DICE.map((die) => {
            // Mode tint: gold for advantage, garnet for disadvantage.
            const modeColor = advantage ? 'var(--gold)' : disadvantage ? '#e08a8a' : null;
            const modeBorder = advantage ? '#e8b76566' : disadvantage ? '#b6485a66' : null;
            const modeHoverBg = advantage ? '#e8b76510' : disadvantage ? '#b6485a12' : '#e08a4b0d';
            return (
              <button
                key={die}
                type="button"
                disabled={disabled}
                onClick={() => handleQuickRoll(die)}
                style={{
                  aspectRatio: '1',
                  border: `1px solid ${modeBorder && !disabled ? modeBorder : 'var(--border)'}`,
                  borderRadius: 10,
                  background: '#ffffff04',
                  color: disabled ? 'var(--faint)' : modeColor ?? 'var(--mid)',
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.12s',
                  outline: 'none',
                }}
                onMouseEnter={(e) => {
                  if (disabled) return;
                  const el = e.currentTarget;
                  el.style.borderColor = modeColor ?? 'var(--ember)';
                  el.style.color = modeColor ?? 'var(--ember)';
                  el.style.background = modeHoverBg;
                  el.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  if (disabled) return;
                  const el = e.currentTarget;
                  el.style.borderColor = modeBorder ?? 'var(--border)';
                  el.style.color = modeColor ?? 'var(--mid)';
                  el.style.background = '#ffffff04';
                  el.style.transform = '';
                }}
                onMouseDown={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)'; }}
                onMouseUp={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.transform = ''; }}
                aria-label={
                  advantage
                    ? `Roll d${die} with advantage (roll twice, keep highest)`
                    : disadvantage
                    ? `Roll d${die} with disadvantage (roll twice, keep lowest)`
                    : `Roll d${die}`
                }
              >
                {`d${die}`}
              </button>
            );
          })}
        </div>

        {/* Advantage / Disadvantage toggles — mutually exclusive, apply to quick rolls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 10 }}>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, cursor: 'pointer', userSelect: 'none',
              color: advantage ? 'var(--gold)' : 'var(--mid)',
              transition: 'color 0.15s',
            }}
          >
            <input
              type="checkbox"
              checked={advantage}
              onChange={(e) => {
                setAdvantage(e.target.checked);
                if (e.target.checked) setDisadvantage(false);
              }}
              disabled={disabled}
              style={{ accentColor: 'var(--gold)', width: 14, height: 14, cursor: 'pointer' }}
            />
            Advantage
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
              keep highest
            </span>
          </label>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, cursor: 'pointer', userSelect: 'none',
              color: disadvantage ? '#e08a8a' : 'var(--mid)',
              transition: 'color 0.15s',
            }}
          >
            <input
              type="checkbox"
              checked={disadvantage}
              onChange={(e) => {
                setDisadvantage(e.target.checked);
                if (e.target.checked) setAdvantage(false);
              }}
              disabled={disabled}
              style={{ accentColor: 'var(--garnet)', width: 14, height: 14, cursor: 'pointer' }}
            />
            Disadvantage
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
              keep lowest
            </span>
          </label>
        </div>
      </div>

      {/* Expression roller */}
      <div className="space-y-3">
        <p style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 500 }}>
          Expression
        </p>

        <div>
          <Input
            id="dice-expr"
            type="text"
            value={expression}
            onChange={(e) => handleExpressionChange(e.target.value)}
            placeholder="1d20+5"
            disabled={disabled}
            error={!!expressionError}
            className="font-mono text-sm"
          />
          {expressionError && (
            <p style={{ marginTop: 5, fontSize: 12, color: 'var(--garnet)' }} role="alert">{expressionError}</p>
          )}
        </div>

        <div>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--mid)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={visibility === 'dm'}
              onChange={(e) => setVisibility(e.target.checked ? 'dm' : 'public')}
              disabled={disabled}
              style={{ accentColor: 'var(--ember)', width: 14, height: 14, cursor: 'pointer' }}
            />
            Private roll
          </label>
        )}

        <button
          type="button"
          onClick={handleRoll}
          disabled={disabled || !expression.trim() || !!expressionError}
          style={{
            width: '100%',
            padding: 13,
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 9,
            border: 'none',
            cursor: disabled || !expression.trim() || !!expressionError ? 'not-allowed' : 'pointer',
            background: disabled || !expression.trim() || !!expressionError ? 'var(--raised)' : 'var(--ember)',
            color: disabled || !expression.trim() || !!expressionError ? 'var(--faint)' : 'var(--ink)',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            if (!el.disabled) {
              el.style.background = 'var(--ember-h)';
              el.style.boxShadow = '0 0 22px -6px rgba(224,138,75,0.67)';
            }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.background = 'var(--ember)';
            el.style.boxShadow = '';
          }}
          aria-label="Roll dice"
        >
          ⚄ Roll
        </button>
      </div>
    </div>
  );
}
