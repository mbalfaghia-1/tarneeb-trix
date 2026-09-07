import { SUIT_IS_RED, SUIT_SYMBOL, teamOf, type TarneebState } from '@tarneeb/engine';
import { HUMAN_SEAT } from '../game/useTarneebGame';
import { Confetti } from './Confetti';
import type { T } from '../i18n';

export function HandOverOverlay({
  state,
  onNext,
  t,
  auto = false,
}: {
  state: TarneebState;
  onNext: () => void;
  t: T;
  /** Online: the server advances automatically — show a note instead of a button. */
  auto?: boolean;
}) {
  const lh = state.lastHand;
  if (!lh) return null;
  const usTeam = teamOf(HUMAN_SEAT);
  const declTeam = teamOf(lh.declarer);
  const made = lh.delta[declTeam] > 0;
  const teamLabel = declTeam === usTeam ? t('us') : t('them');

  return (
    <div className="overlay">
      <div className="panel">
        <div className="panel-title">{t('handOver')}</div>
        <div className={`trump-line ${SUIT_IS_RED[lh.trump] ? 'red' : 'black'}`}>
          {SUIT_SYMBOL[lh.trump]}
        </div>
        <p className="panel-msg">
          {t(made ? 'madeIt' : 'wentDown', {
            team: teamLabel,
            contract: lh.contract,
            won: lh.declarerTricks,
          })}
        </p>
        <div className="score-line">
          {t('us')} {state.scores[usTeam]} : {state.scores[(1 - usTeam) as 0 | 1]} {t('them')}
        </div>
        {auto ? (
          <div className="overlay-auto">{t('nextHand')}…</div>
        ) : (
          <button type="button" className="primary-btn" onClick={onNext}>
            {t('nextHand')}
          </button>
        )}
      </div>
    </div>
  );
}

export function GameOverOverlay({
  state,
  onNewGame,
  t,
}: {
  state: TarneebState;
  onNewGame: () => void;
  t: T;
}) {
  if (state.winner === null) return null;
  const usTeam = teamOf(HUMAN_SEAT);
  const won = state.winner === usTeam;

  return (
    <div className="overlay">
      {won && <Confetti />}
      <div className={`panel ${won ? 'win' : 'lose'}`}>
        <div className="crown">{won ? '👑' : ''}</div>
        <div className="panel-title big">{won ? t('victory') : t('defeat')}</div>
        <p className="panel-msg">{won ? t('youWin') : t('youLose')}</p>
        <div className="score-line">
          {t('finalScore', {
            us: state.scores[usTeam],
            them: state.scores[(1 - usTeam) as 0 | 1],
          })}
        </div>
        <button type="button" className="primary-btn" onClick={onNewGame}>
          {t('newGame')}
        </button>
      </div>
    </div>
  );
}
