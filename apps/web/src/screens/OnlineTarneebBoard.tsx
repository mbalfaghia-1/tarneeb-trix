import { SEATS, SUIT_IS_RED, SUIT_SYMBOL, type Card, type Suit, type TarneebState } from '@tarneeb/engine';
import type { RedactedView } from '@tarneeb/room';
import { rotateTarneeb } from '../game/rotate';
import { turnName } from '../game/labels';
import type { T } from '../i18n';
import { SeatView } from '../components/SeatView';
import { Scoreboard } from '../components/Scoreboard';
import { TrickView } from '../components/TrickView';
import { Hand } from '../components/Hand';
import { BiddingModal } from '../components/BiddingModal';
import { TrumpModal } from '../components/TrumpModal';
import { GameOverOverlay } from '../components/Overlays';

export function OnlineTarneebBoard({
  view,
  submit,
  onLeave,
  t,
}: {
  view: RedactedView;
  submit: (action: unknown) => void;
  onLeave: () => void;
  t: T;
}) {
  const seat = view.seat;
  const state = rotateTarneeb(view.state as TarneebState, seat);
  const yourTurn = view.yourTurn;
  const humanBidding = yourTurn && state.phase === 'bidding';
  const humanTrump = yourTurn && state.phase === 'trump-select';

  let status = '';
  if (state.phase === 'game-over') status = '';
  else if (yourTurn) status = t('yourTurn');
  else if (state.phase === 'bidding') status = t('biddingFor', { name: turnName(state.turn, t) });
  else status = t('waitingFor', { name: turnName(state.turn, t) });

  return (
    <main className="table">
      <Scoreboard state={state} t={t} />

      {state.phase === 'playing' && state.trump && (
        <div className="trump-indicator" aria-label="trump">
          <span className={SUIT_IS_RED[state.trump] ? 'red' : 'black'}>{SUIT_SYMBOL[state.trump]}</span>
        </div>
      )}

      {SEATS.map((s) => (
        <SeatView key={s} seat={s} state={state} t={t} />
      ))}

      <TrickView state={state} reviewTrick={null} />

      <div className="status-dock">{status && <div className="status-banner">{status}</div>}</div>

      <div className="hand-dock">
        <Hand
          state={state}
          active={yourTurn}
          onPlay={(c: Card) => submit({ type: 'PLAY', seat, card: c })}
        />
      </div>

      {humanBidding && (
        <BiddingModal
          state={state}
          onBid={(n: number) => submit({ type: 'BID', seat, amount: n })}
          onPass={() => submit({ type: 'PASS', seat })}
          t={t}
        />
      )}
      {humanTrump && (
        <TrumpModal onSelect={(su: Suit) => submit({ type: 'SELECT_TRUMP', seat, suit: su })} t={t} />
      )}

      {state.phase === 'game-over' && <GameOverOverlay state={state} onNewGame={onLeave} t={t} />}
    </main>
  );
}
