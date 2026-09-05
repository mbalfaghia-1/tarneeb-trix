import { useEffect, useMemo, useState } from 'react';
import type { Seat } from '@tarneeb/engine';
import {
  scoreTrixCalcDeal,
  type CalcContract,
  type DoubledQueen,
  type TrixDealInputs,
} from '../game/calcScore';
import type { T } from '../i18n';

const SEATS4 = [0, 1, 2, 3] as const;
type TrixMode = 'regular' | 'complex';

// A Trix game is 4 kingdoms; within each kingdom every contract is played once.
const TOTAL_KINGDOMS = 4;
const CONTRACTS_REGULAR: CalcContract[] = ['kingOfHearts', 'diamonds', 'queens', 'collection', 'trix'];
const CONTRACTS_COMPLEX: CalcContract[] = ['complex', 'trix'];
const contractsFor = (mode: TrixMode): CalcContract[] =>
  mode === 'complex' ? CONTRACTS_COMPLEX : CONTRACTS_REGULAR;

interface Deal {
  contract: CalcContract;
  delta: number[];
}
interface SavedState {
  names: string[];
  mode: TrixMode;
  deals: Deal[];
}

const KEY = 'trix.calc.v2';

function load(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SavedState;
  } catch {
    /* ignore */
  }
  return { names: ['', '', '', ''], mode: 'regular', deals: [] };
}

const zeros = (): number[] => [0, 0, 0, 0];
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

export function TrixCalculator({ t }: { t: T }) {
  const [state, setState] = useState<SavedState>(load);
  const [contract, setContract] = useState<CalcContract>('kingOfHearts');
  const [koh, setKoh] = useState<Seat | null>(null);
  const [dia, setDia] = useState<number[]>(zeros);
  const [queens, setQueens] = useState<number[]>(zeros);
  const [tricks, setTricks] = useState<number[]>(zeros);
  const [pos, setPos] = useState<number[]>(zeros); // finishing position 1..4 per seat (0 = unset)
  const [kohDoubledBy, setKohDoubledBy] = useState<Seat | null>(null);
  const [kohForcedBy, setKohForcedBy] = useState<Seat | null>(null);
  const [dq, setDq] = useState<DoubledQueen[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const names = state.names.map((n, i) => n || t(`calcP${i + 1}` as never));

  const totals = useMemo(() => {
    const acc = zeros();
    for (const d of state.deals) d.delta.forEach((v, s) => (acc[s]! += v));
    return acc;
  }, [state.deals]);
  const best = Math.max(...totals);

  // Game structure: 4 kingdoms, each contract played once per kingdom.
  const perKingdom = contractsFor(state.mode).length;
  const kingdomIndex = Math.floor(state.deals.length / perKingdom); // 0-based; === TOTAL_KINGDOMS when done
  const gameComplete = state.deals.length >= perKingdom * TOTAL_KINGDOMS;
  const playedThisKingdom = gameComplete
    ? []
    : state.deals.slice(kingdomIndex * perKingdom).map((d) => d.contract);
  const available = contractsFor(state.mode).filter((c) => !playedThisKingdom.includes(c));

  const needs = { koh: false, dia: false, q: false, tr: false, order: false };
  if (contract === 'kingOfHearts') needs.koh = true;
  else if (contract === 'diamonds') needs.dia = true;
  else if (contract === 'queens') needs.q = true;
  else if (contract === 'collection') needs.tr = true;
  else if (contract === 'trix') needs.order = true;
  else if (contract === 'complex') {
    needs.koh = needs.dia = needs.q = needs.tr = true;
  }

  const orderValid =
    !needs.order || (pos.every((p) => p >= 1 && p <= 4) && new Set(pos).size === 4);
  const valid =
    (!needs.koh || koh !== null) &&
    (!needs.dia || sum(dia) === 13) &&
    (!needs.q || sum(queens) === 4) &&
    (!needs.tr || sum(tricks) === 13) &&
    orderValid;

  const buildInputs = (): TrixDealInputs => {
    const inputs: TrixDealInputs = {};
    if (needs.koh) inputs.kohTaker = koh;
    if (needs.dia) inputs.diamonds = dia;
    if (needs.q) inputs.queens = queens;
    if (needs.tr) inputs.tricks = tricks;
    if (needs.order) {
      const order: Seat[] = [];
      for (let p = 1; p <= 4; p++) {
        const seat = pos.findIndex((x) => x === p);
        if (seat >= 0) order.push(seat as Seat);
      }
      inputs.finishOrder = order;
    }
    if (needs.koh && kohDoubledBy !== null) {
      inputs.kohDoubledBy = kohDoubledBy;
      inputs.kohForcedBy = kohDoubledBy === koh ? kohForcedBy : null;
    }
    if (needs.q) inputs.doubledQueens = dq;
    return inputs;
  };

  const preview = valid ? scoreTrixCalcDeal(contract, buildInputs()) : null;

  const resetEntry = () => {
    setKoh(null);
    setDia(zeros());
    setQueens(zeros());
    setTricks(zeros());
    setPos(zeros());
    setKohDoubledBy(null);
    setKohForcedBy(null);
    setDq([]);
  };

  // Keep the selected contract to one still available in the current kingdom. When a
  // kingdom finishes the set refills, so the picker naturally offers the next kingdom's
  // contracts; when the whole game is done nothing is offered.
  useEffect(() => {
    if (!gameComplete && !available.includes(contract)) {
      setContract(available[0]!);
      resetEntry();
    }
  }, [available.join(','), gameComplete]);

  const addDeal = () => {
    if (!valid || gameComplete || !available.includes(contract)) return;
    const delta = scoreTrixCalcDeal(contract, buildInputs());
    setState((s) => ({ ...s, deals: [...s.deals, { contract, delta }] }));
    resetEntry();
  };
  const undo = () => setState((s) => ({ ...s, deals: s.deals.slice(0, -1) }));
  const reset = () => setState((s) => ({ ...s, deals: [] }));
  const setMode = (mode: TrixMode) => setState((s) => (s.deals.length === 0 ? { ...s, mode } : s));
  const setName = (i: number, v: string) =>
    setState((s) => {
      const n = s.names.slice();
      n[i] = v;
      return { ...s, names: n };
    });

  // Each cell is capped to the total budget minus what the others already hold, so
  // the counts can never exceed the fixed total (4 queens / 13 diamonds / 13 tricks).
  const countRow = (label: string, vals: number[], setVals: (v: number[]) => void, need: number) => (
    <div className="calc-field">
      <label>
        {label}{' '}
        <span className={sum(vals) === need ? 'ok' : 'bad'}>
          ({sum(vals)}/{need})
        </span>
      </label>
      <div className="count-grid">
        {SEATS4.map((s) => {
          const others = sum(vals) - vals[s]!;
          const cellMax = need - others;
          return (
            <div key={s} className="count-cell">
              <span className="count-name">{names[s]}</span>
              <input
                type="number"
                min={0}
                max={cellMax}
                value={vals[s]}
                onChange={(e) => {
                  const next = vals.slice();
                  next[s] = Math.max(0, Math.min(cellMax, Number(e.target.value) || 0));
                  setVals(next);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <main className="calc">
      <div className="calc-totals trix">
        {SEATS4.map((s) => (
          <div key={s} className={`calc-team ${totals[s] === best && state.deals.length ? 'winner' : ''}`}>
            <input
              className="calc-name"
              value={state.names[s]}
              placeholder={names[s]}
              onChange={(e) => setName(s, e.target.value)}
              aria-label={`player ${s + 1} name`}
            />
            <div className="calc-score">{totals[s]}</div>
          </div>
        ))}
      </div>

      <div className="calc-form">
        <div className="calc-field">
          <label>{t('gameType')}</label>
          <div className="seg">
            {(['regular', 'complex'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={state.mode === m ? 'on' : ''}
                disabled={state.deals.length > 0}
                onClick={() => setMode(m)}
              >
                {m === 'regular' ? t('modeRegular') : t('modeComplex')}
              </button>
            ))}
          </div>
        </div>

        <div className="calc-kingdom">
          {gameComplete ? (
            <span className="calc-win">🏆 {t('gameComplete')}</span>
          ) : (
            <>
              <span className="kingdom-badge">{t('kingdom', { n: kingdomIndex + 1 })}</span>
              <span className="kingdom-remaining">
                {available.map((c) => t(`c_${c}` as never)).join('  ·  ')}
              </span>
            </>
          )}
        </div>

        {!gameComplete && (
          <>
            <div className="calc-field">
              <label>{t('contract')}</label>
              <select
                value={contract}
                onChange={(e) => {
                  setContract(e.target.value as CalcContract);
                  resetEntry();
                }}
              >
                {available.map((c) => (
                  <option key={c} value={c}>
                    {t(`c_${c}` as never)}
                  </option>
                ))}
              </select>
            </div>

            {needs.koh && (
          <div className="calc-field">
            <label>{t('whoTookKoH')}</label>
            <div className="seg seg4">
              {SEATS4.map((s) => (
                <button key={s} type="button" className={koh === s ? 'on' : ''} onClick={() => setKoh(s)}>
                  {names[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {needs.koh && (
          <div className="calc-field">
            <label>{t('kohDoubledBy')}</label>
            <div className="seg seg4 wrap">
              <button
                type="button"
                className={kohDoubledBy === null ? 'on' : ''}
                onClick={() => {
                  setKohDoubledBy(null);
                  setKohForcedBy(null);
                }}
              >
                {t('notDoubled')}
              </button>
              {SEATS4.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={kohDoubledBy === s ? 'on' : ''}
                  onClick={() => {
                    setKohDoubledBy(s);
                    setKohForcedBy(null);
                  }}
                >
                  {names[s]}
                </button>
              ))}
            </div>
            {kohDoubledBy !== null && koh !== null && kohDoubledBy === koh && (
              <select
                className="dbl-self"
                value={kohForcedBy === null ? '' : String(kohForcedBy)}
                onChange={(e) => setKohForcedBy(e.target.value === '' ? null : (Number(e.target.value) as Seat))}
              >
                <option value="">{t('naturalSweep')}</option>
                {SEATS4.filter((s) => s !== koh).map((s) => (
                  <option key={s} value={s}>
                    {t('forcedBy', { name: names[s]! })}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {needs.dia && countRow(t('diamondsPer'), dia, setDia, 13)}
        {needs.q && countRow(t('queensPer'), queens, setQueens, 4)}

        {needs.q && (
          <div className="calc-field">
            <label>{t('doubledQueens')}</label>
            {dq.map((q, i) => (
              <div key={i} className="dq-row">
                <span className="dq-lbl">{t('doubledBy')}</span>
                <select
                  value={q.by}
                  onChange={(e) => setDq(dq.map((x, j) => (j === i ? { ...x, by: Number(e.target.value) as Seat } : x)))}
                >
                  {SEATS4.map((s) => (
                    <option key={s} value={s}>
                      {names[s]}
                    </option>
                  ))}
                </select>
                <span className="dq-lbl">{t('takenBy')}</span>
                <select
                  value={q.taker}
                  onChange={(e) => setDq(dq.map((x, j) => (j === i ? { ...x, taker: Number(e.target.value) as Seat } : x)))}
                >
                  {SEATS4.map((s) => (
                    <option key={s} value={s}>
                      {names[s]}
                    </option>
                  ))}
                </select>
                {q.by === q.taker && (
                  <select
                    value={q.forcedBy === null ? '' : String(q.forcedBy)}
                    onChange={(e) =>
                      setDq(
                        dq.map((x, j) =>
                          j === i
                            ? { ...x, forcedBy: e.target.value === '' ? null : (Number(e.target.value) as Seat) }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">{t('naturalSweep')}</option>
                    {SEATS4.filter((s) => s !== q.by).map((s) => (
                      <option key={s} value={s}>
                        {t('forcedBy', { name: names[s]! })}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="dq-del" onClick={() => setDq(dq.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="add-dq"
              onClick={() => setDq([...dq, { by: 0, taker: 0, forcedBy: null }])}
            >
              + {t('addDouble')}
            </button>
          </div>
        )}

        {needs.tr && countRow(t('tricksPer'), tricks, setTricks, 13)}

        {needs.order && (
          <div className="calc-field">
            <label>
              {t('finishOrderLabel')}{' '}
              <span className={orderValid ? 'ok' : 'bad'}>{orderValid ? '✓' : ''}</span>
            </label>
            <div className="count-grid">
              {SEATS4.map((s) => (
                <div key={s} className="count-cell">
                  <span className="count-name">{names[s]}</span>
                  <select
                    value={pos[s] || ''}
                    onChange={(e) => {
                      const next = pos.slice();
                      next[s] = Number(e.target.value) || 0;
                      setPos(next);
                    }}
                  >
                    <option value="">–</option>
                    {[1, 2, 3, 4].map((p) => (
                      <option key={p} value={p}>
                        {t(`ord${p}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {preview && (
          <div className="calc-preview">
            {SEATS4.map((s) => (
              <span key={s}>
                {names[s]} {preview[s]! >= 0 ? `+${preview[s]}` : preview[s]}
                {s < 3 ? ' · ' : ''}
              </span>
            ))}
          </div>
        )}

            <button type="button" className="primary-btn" onClick={addDeal} disabled={!valid}>
              {t('addDeal')}
            </button>
          </>
        )}
      </div>

      <div className="calc-history">
        <div className="calc-history-head">
          <span>{t('dealsHistory')}</span>
          <span className="calc-history-btns">
            <button type="button" onClick={undo} disabled={state.deals.length === 0}>
              {t('undo')}
            </button>
            <button type="button" onClick={reset} disabled={state.deals.length === 0}>
              {t('reset')}
            </button>
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('contract')}</th>
              {SEATS4.map((s) => (
                <th key={s}>{names[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.deals.map((d, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{t(`c_${d.contract}` as never)}</td>
                {d.delta.map((v, s) => (
                  <td key={s} className={v < 0 ? 'neg' : v > 0 ? 'pos' : ''}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {state.deals.length === 0 && (
              <tr>
                <td colSpan={6} className="calc-empty">
                  {t('noDeals')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
