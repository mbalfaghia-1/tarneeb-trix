import { SUIT_IS_RED, SUIT_SYMBOL, teamOf, type TarneebState } from '@tarneeb/engine';
import { HUMAN_SEAT } from '../game/useTarneebGame';
import type { T } from '../i18n';

export function Scoreboard({ state, t }: { state: TarneebState; t: T }) {
  const usTeam = teamOf(HUMAN_SEAT); // 0
  const themTeam = (1 - usTeam) as 0 | 1;

  return (
    <div className="scoreboard">
      <div className="score-target">{31}</div>
      <div className="score-row head">
        <span>{t('us')}</span>
        <span>{t('them')}</span>
      </div>
      <div className="score-row big">
        <span>{state.scores[usTeam]}</span>
        <span>{state.scores[themTeam]}</span>
      </div>
      <div className="score-row small">
        <span>{state.tricksWon[usTeam]}</span>
        <span>{state.tricksWon[themTeam]}</span>
      </div>
      {state.phase === 'playing' && state.trump && state.contract !== null && (
        <div className="contract-row">
          <span>{t('contract')}: {state.contract}</span>
          <span className={`trump ${SUIT_IS_RED[state.trump] ? 'red' : 'black'}`}>
            {SUIT_SYMBOL[state.trump]}
          </span>
        </div>
      )}
    </div>
  );
}
