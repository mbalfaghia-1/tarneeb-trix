import type { ReactNode } from 'react';
import {
  SEATS,
  SUIT_IS_RED,
  SUIT_SYMBOL,
  type Card,
  type CompletedTrick,
  type Seat,
  type Suit,
  type TarneebState,
} from '@tarneeb/engine';
import { turnName } from '../game/labels';
import type { T } from '../i18n';
import { SeatView } from './SeatView';
import { Scoreboard } from './Scoreboard';
import { TrickView } from './TrickView';
import { Hand } from './Hand';
import { BiddingModal } from './BiddingModal';
import { TrumpModal } from './TrumpModal';
import { LastTrick } from './LastTrick';

/**
 * The one Tarneeb board, shared by single-player (`TarneebScreen`) and online
 * (`OnlineTarneebBoard`) so they look and behave identically. Assumes the viewer sits
 * at seat 0 (single-player already does; online rotates the state so it does too).
 */
export interface TarneebBoardProps {
  state: TarneebState;
  t: T;
  /** The viewer may act right now (already excludes trick-review pauses). */
  awaitingHuman: boolean;
  reviewTrick: CompletedTrick | null;
  onBid: (amount: number) => void;
  onPass: () => void;
  onSelectTrump: (suit: Suit) => void;
  onPlay: (card: Card) => void;
  /** Real player names (online). Omit to use positional labels (You/Partner/…). */
  nameFor?: (seat: Seat) => string;
  /** Real hand sizes (online redacts other hands). Omit to read them from state. */
  countFor?: (seat: Seat) => number;
  /** Show a countdown bar while awaiting the human. */
  turnTimer?: { limitMs: number; token: string };
  /** "End round" claim button (single-player only). */
  claim?: { canClaim: boolean; onClaim: () => void };
  /** Screen-specific extras rendered inside the board (overlays, leave button). */
  children?: ReactNode;
}

export function TarneebBoard({
  state,
  t,
  awaitingHuman,
  reviewTrick,
  onBid,
  onPass,
  onSelectTrump,
  onPlay,
  nameFor,
  countFor,
  turnTimer,
  claim,
  children,
}: TarneebBoardProps) {
  const label = (s: Seat) => nameFor?.(s) ?? turnName(s, t);

  const humanBidding = awaitingHuman && state.phase === 'bidding';
  const humanTrump = awaitingHuman && state.phase === 'trump-select';

  let status = '';

  return (
    <main className="table">
      <Scoreboard state={state} t={t} />

      {state.phase === 'playing' && state.trump && (
        <div className="trump-indicator" aria-label="trump">
          <span className={SUIT_IS_RED[state.trump] ? 'red' : 'black'}>{SUIT_SYMBOL[state.trump]}</span>
        </div>
      )}

      <LastTrick trick={state.tricks[state.tricks.length - 1] ?? null} nameFor={label} t={t} />

      {SEATS.map((s) => (
        <SeatView
          key={s}
          seat={s}
          state={state}
          t={t}
          name={nameFor?.(s)}
          count={countFor?.(s)}
          justWon={reviewTrick?.winner === s}
          turnTimer={s === 0 && awaitingHuman && turnTimer ? turnTimer : undefined}
        />
      ))}

      <TrickView state={reviewTrick ? { ...state, currentTrick: [] } : state} reviewTrick={reviewTrick} />

      <div className="status-dock">
        {status && <div className="status-banner">{status}</div>}
        {claim?.canClaim && (
          <button type="button" className="pass-btn small end-btn" onClick={claim.onClaim}>
            {t('endRound')}
          </button>
        )}
      </div>

      <div className="hand-dock">
        <Hand state={state} active={awaitingHuman} onPlay={onPlay} />
      </div>

      {humanBidding && <BiddingModal state={state} onBid={onBid} onPass={onPass} t={t} />}
      {humanTrump && <TrumpModal onSelect={onSelectTrump} t={t} />}

      {children}
    </main>
  );
}
