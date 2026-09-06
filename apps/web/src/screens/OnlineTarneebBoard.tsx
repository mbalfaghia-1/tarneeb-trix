import {
  SEATS,
  SUIT_IS_RED,
  SUIT_SYMBOL,
  type Card,
  type Seat,
  type Suit,
  type TarneebState,
} from '@tarneeb/engine';
import type { RedactedView } from '@tarneeb/room';
import { rotateTarneeb } from '../game/rotate';
import type { T } from '../i18n';
import { SeatView } from '../components/SeatView';
import { Scoreboard } from '../components/Scoreboard';
import { TrickView } from '../components/TrickView';
import { Hand } from '../components/Hand';
import { BiddingModal } from '../components/BiddingModal';
import { TrumpModal } from '../components/TrumpModal';
import { LastTrick } from '../components/LastTrick';
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

  // Rotated seat s ↔ real seat (s + viewer) % 4 → real occupant name / card count.
  const nameFor = (s: Seat) => view.occupants[(s + seat) % 4]?.name ?? '';
  const countFor = (s: Seat) => view.handCounts[(s + seat) % 4] ?? 0;

  let status = '';
  if (state.phase === 'game-over') status = '';
  else if (yourTurn) status = t('yourTurn');
  else if (state.phase === 'bidding') status = t('biddingFor', { name: nameFor(state.turn) });
  else status = t('waitingFor', { name: nameFor(state.turn) });

  return (
    <main className="table">
      <Scoreboard state={state} t={t} />

      {state.phase === 'playing' && state.trump && (
        <div className="trump-indicator" aria-label="trump">
          <span className={SUIT_IS_RED[state.trump] ? 'red' : 'black'}>{SUIT_SYMBOL[state.trump]}</span>
        </div>
      )}

      <LastTrick trick={state.tricks[state.tricks.length - 1] ?? null} nameFor={nameFor} t={t} />

      {SEATS.map((s) => (
        <SeatView key={s} seat={s} state={state} t={t} name={nameFor(s)} count={countFor(s)} />
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
