import { SEATS, trixTeamScores, type TrixState } from '@tarneeb/engine';
import { turnName } from '../../game/labels';
import { contractName } from '../../game/trixLabels';
import type { T } from '../../i18n';

export function TrixScoreboard({ state, t }: { state: TrixState; t: T }) {
  const best = Math.max(...state.scores);
  const [teamUs, teamThem] = trixTeamScores(state.scores);
  return (
    <div className="scoreboard trix-scoreboard">
      <div className="score-target">{t('kingdom', { n: state.kingdomIndex + 1 })}</div>
      {SEATS.map((seat) => (
        <div className={`trix-score-row ${state.scores[seat] === best ? 'leader' : ''}`} key={seat}>
          <span className="who">
            {state.king === seat ? '👑 ' : ''}
            {turnName(seat, t)}
          </span>
          <span className="pts">{state.scores[seat]}</span>
        </div>
      ))}
      {state.partnership && (
        <div className="trix-teams">
          <div className="trix-score-row team">
            <span className="who">{t('us')}</span>
            <span className="pts">{teamUs}</span>
          </div>
          <div className="trix-score-row team">
            <span className="who">{t('them')}</span>
            <span className="pts">{teamThem}</span>
          </div>
        </div>
      )}
      {state.contract && (
        <div className="contract-row trix-contract">{contractName(t, state.contract)}</div>
      )}
    </div>
  );
}
