import { useEffect, useMemo, useState } from 'react';
import { GAME_TARGET, MAX_BID, MIN_BID } from '@tarneeb/engine';
import { scoreTarneebRound } from '../game/calcScore';
import type { T } from '../i18n';

interface Round {
  team: 0 | 1;
  bid: number;
  tricks: number;
  delta: [number, number];
}
interface SavedState {
  names: [string, string];
  target: number;
  rounds: Round[];
}

const KEY = 'tarneeb.calc.v1';

function load(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SavedState;
  } catch {
    /* ignore */
  }
  return { names: ['', ''], target: GAME_TARGET, rounds: [] };
}

const range = (lo: number, hi: number): number[] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

export function TarneebCalculator({ t }: { t: T }) {
  const [state, setState] = useState<SavedState>(load);
  const [team, setTeam] = useState<0 | 1>(0);
  const [bid, setBid] = useState<number>(MIN_BID);
  const [tricks, setTricks] = useState<number>(MIN_BID);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const names: [string, string] = [state.names[0] || t('team1'), state.names[1] || t('team2')];

  const totals = useMemo(
    () =>
      state.rounds.reduce<[number, number]>((acc, r) => [acc[0] + r.delta[0], acc[1] + r.delta[1]], [
        0, 0,
      ]),
    [state.rounds],
  );

  const winner =
    totals[0] >= state.target || totals[1] >= state.target
      ? totals[0] === totals[1]
        ? null
        : totals[0] > totals[1]
          ? 0
          : 1
      : null;

  const preview = scoreTarneebRound(bid, team, tricks);

  const addRound = () =>
    setState((s) => ({
      ...s,
      rounds: [...s.rounds, { team, bid, tricks, delta: scoreTarneebRound(bid, team, tricks) }],
    }));
  const undo = () => setState((s) => ({ ...s, rounds: s.rounds.slice(0, -1) }));
  const reset = () => setState((s) => ({ ...s, rounds: [] }));
  const setName = (i: 0 | 1, v: string) =>
    setState((s) => {
      const n: [string, string] = [s.names[0], s.names[1]];
      n[i] = v;
      return { ...s, names: n };
    });

  return (
    <main className="calc">
      <div className="calc-totals">
        {([0, 1] as const).map((i) => (
          <div key={i} className={`calc-team ${winner === i ? 'winner' : ''}`}>
            <input
              className="calc-name"
              value={state.names[i]}
              placeholder={names[i]}
              onChange={(e) => setName(i, e.target.value)}
              aria-label={`team ${i + 1} name`}
            />
            <div className="calc-score">{totals[i]}</div>
          </div>
        ))}
      </div>

      <div className="calc-target">
        {t('target')}:{' '}
        <input
          className="calc-target-in"
          type="number"
          value={state.target}
          min={1}
          onChange={(e) => setState((s) => ({ ...s, target: Number(e.target.value) || 0 }))}
        />
        {winner !== null && <span className="calc-win">🏆 {t('winsGame', { name: names[winner] })}</span>}
      </div>

      <div className="calc-form">
        <div className="calc-field">
          <label>{t('whoBid')}</label>
          <div className="seg">
            {([0, 1] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={team === i ? 'on' : ''}
                onClick={() => setTeam(i)}
              >
                {names[i]}
              </button>
            ))}
          </div>
        </div>

        <div className="calc-field">
          <label>{t('bidLabel')}</label>
          <select value={bid} onChange={(e) => setBid(Number(e.target.value))}>
            {range(MIN_BID, MAX_BID).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="calc-field">
          <label>{t('tricksWon', { name: names[team] })}</label>
          <select value={tricks} onChange={(e) => setTricks(Number(e.target.value))}>
            {range(0, 13).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="calc-preview">
          {names[0]} {preview[0] >= 0 ? `+${preview[0]}` : preview[0]} &nbsp;·&nbsp; {names[1]}{' '}
          {preview[1] >= 0 ? `+${preview[1]}` : preview[1]}
        </div>

        <button type="button" className="primary-btn" onClick={addRound}>
          {t('addRound')}
        </button>
      </div>

      <div className="calc-history">
        <div className="calc-history-head">
          <span>{t('roundsHistory')}</span>
          <span className="calc-history-btns">
            <button type="button" onClick={undo} disabled={state.rounds.length === 0}>
              {t('undo')}
            </button>
            <button type="button" onClick={reset} disabled={state.rounds.length === 0}>
              {t('reset')}
            </button>
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('whoBid')}</th>
              <th>{t('bidLabel')}</th>
              <th>{t('tricks')}</th>
              <th>{names[0]}</th>
              <th>{names[1]}</th>
            </tr>
          </thead>
          <tbody>
            {state.rounds.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{names[r.team]}</td>
                <td>{r.bid}</td>
                <td>{r.tricks}</td>
                <td className={r.delta[0] < 0 ? 'neg' : ''}>{r.delta[0]}</td>
                <td className={r.delta[1] < 0 ? 'neg' : ''}>{r.delta[1]}</td>
              </tr>
            ))}
            {state.rounds.length === 0 && (
              <tr>
                <td colSpan={6} className="calc-empty">
                  {t('noRounds')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
