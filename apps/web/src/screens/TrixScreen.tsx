import { SEATS, type TrixMode } from '@tarneeb/engine';
import { useTrixGame } from '../game/useTrixGame';
import { useTrixSounds } from '../lib/useTrixSounds';
import { turnName } from '../game/labels';
import { CONTRACT_ICON } from '../game/trixLabels';
import type { T } from '../i18n';
import { TrixScoreboard } from '../components/trix/TrixScoreboard';
import { TrixSeat } from '../components/trix/TrixSeat';
import { TrixTrick } from '../components/trix/TrixTrick';
import { SheddingBoard } from '../components/trix/SheddingBoard';
import { TrixHand } from '../components/trix/TrixHand';
import { ContractModal } from '../components/trix/ContractModal';
import { DoubleModal } from '../components/trix/DoubleModal';
import { TrixDealOverlay, TrixGameOverlay } from '../components/trix/TrixOverlays';

export function TrixScreen({
  t,
  mode = 'regular',
  partnership = false,
}: {
  t: T;
  mode?: TrixMode;
  partnership?: boolean;
}) {
  const game = useTrixGame(mode, partnership);
  const { state, awaitingHuman } = game;
  useTrixSounds(game);

  const humanContract = awaitingHuman && state.phase === 'contract-select';
  const contractShown = state.contract && (state.phase === 'playing' || state.phase === 'shedding');
  const redContract = state.contract === 'kingOfHearts' || state.contract === 'diamonds';

  let status = '';
  if (state.phase === 'deal-over' || state.phase === 'game-over') status = '';
  else if (awaitingHuman)
    status =
      state.phase === 'contract-select'
        ? t('chooseContract')
        : state.phase === 'doubling'
          ? t('double_title')
          : t('yourTurn');
  else if (state.phase === 'contract-select') status = t('waitingFor', { name: turnName(state.king, t) });
  else if (state.phase === 'doubling') status = t('doublingWait', { name: turnName(state.turn, t) });
  else if (state.turn === 0) status = ''; // our own turn but auto-resolving (e.g. forced pass)
  else status = t('waitingFor', { name: turnName(state.turn, t) });

  return (
    <main className="table">
      <TrixScoreboard state={state} t={t} />

      {contractShown && state.contract && (
        <div className={`trump-indicator ${redContract ? '' : 'dark'}`} aria-label="contract">
          <span className={redContract ? 'red' : 'black'}>{CONTRACT_ICON[state.contract]}</span>
        </div>
      )}

      {SEATS.map((seat) => (
        <TrixSeat
          key={seat}
          seat={seat}
          state={state}
          t={t}
          justWon={game.reviewTrick?.winner === seat}
        />
      ))}

      {state.phase === 'shedding' ? (
        <SheddingBoard state={state} />
      ) : (
        <TrixTrick state={state} reviewTrick={game.reviewTrick} />
      )}

      <div className="status-dock">
        {status && <div className="status-banner">{status}</div>}
        {awaitingHuman && (
          <div className="turn-timer" key={game.turnToken}>
            <div className="turn-timer-fill" style={{ animationDuration: `${game.turnLimitMs}ms` }} />
          </div>
        )}
      </div>

      <div className="hand-dock">
        <TrixHand state={state} active={awaitingHuman} onPlay={game.playCard} />
      </div>

      {humanContract && <ContractModal state={state} onChoose={game.chooseContract} t={t} />}
      {state.phase === 'doubling' && awaitingHuman && (
        <DoubleModal state={state} onSubmit={game.setDouble} t={t} />
      )}
      {state.phase === 'deal-over' && !game.reviewTrick && (
        <TrixDealOverlay state={state} onNext={game.nextDeal} t={t} />
      )}
      {state.phase === 'game-over' && (
        <TrixGameOverlay state={state} onNewGame={game.newGame} t={t} />
      )}
    </main>
  );
}
