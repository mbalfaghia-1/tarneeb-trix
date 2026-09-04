import { SEATS, trixTeamScores, type Seat, type TrixState } from '@tarneeb/engine';
import { turnName } from '../../game/labels';
import { contractName } from '../../game/trixLabels';
import { Confetti } from '../Confetti';
import type { T } from '../../i18n';

function ScoreRows({ state, t, delta }: { state: TrixState; t: T; delta?: readonly number[] }) {
  return (
    <div className="trix-result">
      {SEATS.map((seat) => {
        const d = delta?.[seat] ?? 0;
        return (
          <div className="trix-result-row" key={seat}>
            <span className="who">{turnName(seat, t)}</span>
            {delta && (
              <span className={d >= 0 ? 'pos' : 'neg'}>
                {d > 0 ? '+' : ''}
                {d}
              </span>
            )}
            <span className="tot">{state.scores[seat] ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TrixDealOverlay({ state, onNext, t }: { state: TrixState; onNext: () => void; t: T }) {
  const dr = state.dealResult;
  if (!dr) return null;
  return (
    <div className="overlay">
      <div className="panel">
        <div className="panel-title">{contractName(t, dr.contract)}</div>
        <ScoreRows state={state} t={t} delta={dr.delta} />
        <button type="button" className="primary-btn" onClick={onNext}>
          {t('nextDeal')}
        </button>
      </div>
    </div>
  );
}

export function TrixGameOverlay({
  state,
  onNewGame,
  t,
}: {
  state: TrixState;
  onNewGame: () => void;
  t: T;
}) {
  if (state.winner === null) return null;
  const humanWon = state.winner === 0; // team 0 (You + Partner) or seat 0
  const [teamUs, teamThem] = trixTeamScores(state.scores);
  let title: string;
  if (state.winner === 'tie') title = t('tie');
  else if (state.partnership) title = humanWon ? t('yourTeamWins') : t('theyWin');
  else title = t('gameWinner', { name: turnName(state.winner as Seat, t) });

  return (
    <div className="overlay">
      {humanWon && <Confetti />}
      <div className={`panel ${humanWon ? 'win' : 'lose'}`}>
        <div className="crown">{humanWon ? '👑' : ''}</div>
        <div className="panel-title big">{title}</div>
        {state.partnership && (
          <div className="score-line">
            {t('us')} {teamUs} : {teamThem} {t('them')}
          </div>
        )}
        <ScoreRows state={state} t={t} />
        <button type="button" className="primary-btn" onClick={onNewGame}>
          {t('newGame')}
        </button>
      </div>
    </div>
  );
}
