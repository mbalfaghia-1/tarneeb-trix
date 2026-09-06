import { SEATS, SUIT_IS_RED, SUIT_SYMBOL } from '@tarneeb/engine';
import { useTarneebGame } from '../game/useTarneebGame';
import { turnName } from '../game/labels';
import { useGameSounds } from '../lib/useGameSounds';
import type { T } from '../i18n';
import { SeatView } from '../components/SeatView';
import { Scoreboard } from '../components/Scoreboard';
import { TrickView } from '../components/TrickView';
import { Hand } from '../components/Hand';
import { BiddingModal } from '../components/BiddingModal';
import { TrumpModal } from '../components/TrumpModal';
import { LastTrick } from '../components/LastTrick';
import { GameOverOverlay, HandOverOverlay } from '../components/Overlays';

export function TarneebScreen({ t }: { t: T }) {
  const game = useTarneebGame();
  const { state, awaitingHuman } = game;
  useGameSounds(game);

  const humanBidding = awaitingHuman && state.phase === 'bidding';
  const humanTrump = awaitingHuman && state.phase === 'trump-select';

  let status = '';
  if (state.phase === 'game-over') status = '';
  else if (awaitingHuman) status = t('yourTurn');
  else if (state.phase === 'bidding') status = t('biddingFor', { name: turnName(state.turn, t) });
  else status = t('waitingFor', { name: turnName(state.turn, t) });

  return (
    <main className="table">
      <Scoreboard state={state} t={t} />

      {state.phase === 'playing' && state.trump && (
        <div className="trump-indicator" aria-label="trump">
          <span className={SUIT_IS_RED[state.trump] ? 'red' : 'black'}>
            {SUIT_SYMBOL[state.trump]}
          </span>
        </div>
      )}

      <LastTrick trick={state.tricks[state.tricks.length - 1] ?? null} nameFor={(s) => turnName(s, t)} t={t} />

      {SEATS.map((seat) => (
        <SeatView
          key={seat}
          seat={seat}
          state={state}
          t={t}
          justWon={game.reviewTrick?.winner === seat}
        />
      ))}

      <TrickView state={state} reviewTrick={game.reviewTrick} />

      <div className="status-dock">
        {status && <div className="status-banner">{status}</div>}
        {game.canClaim && (
          <button type="button" className="pass-btn small end-btn" onClick={game.claim}>
            {t('endRound')}
          </button>
        )}
        {awaitingHuman && (
          <div className="turn-timer" key={game.turnToken}>
            <div className="turn-timer-fill" style={{ animationDuration: `${game.turnLimitMs}ms` }} />
          </div>
        )}
      </div>

      <div className="hand-dock">
        <Hand state={state} active={awaitingHuman} onPlay={game.playCard} />
      </div>

      {humanBidding && <BiddingModal state={state} onBid={game.bid} onPass={game.pass} t={t} />}
      {humanTrump && <TrumpModal onSelect={game.selectTrump} t={t} />}

      {state.phase === 'hand-over' && !game.reviewTrick && (
        <HandOverOverlay state={state} onNext={game.nextHand} t={t} />
      )}
      {state.phase === 'game-over' && !game.reviewTrick && (
        <GameOverOverlay state={state} onNewGame={game.newGame} t={t} />
      )}
    </main>
  );
}
