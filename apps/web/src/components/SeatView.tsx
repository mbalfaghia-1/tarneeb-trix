import { type Seat, type TarneebState } from '@tarneeb/engine';
import { HUMAN_SEAT } from '../game/useTarneebGame';
import { posOf } from '../game/layout';
import type { T } from '../i18n';

function seatName(seat: Seat, t: T): string {
  switch (posOf(seat, HUMAN_SEAT)) {
    case 'bottom':
      return t('youBid');
    case 'top':
      return t('partner');
    case 'left':
      return t('leftOpp');
    case 'right':
      return t('rightOpp');
  }
}

/** The seat's most recent bidding action this round, if any. */
function lastBidLabel(state: TarneebState, seat: Seat, t: T): string | null {
  if (state.phase !== 'bidding') return null;
  for (let i = state.bidLog.length - 1; i >= 0; i--) {
    const e = state.bidLog[i]!;
    if (e.seat === seat) return e.amount === 'pass' ? t('passed') : String(e.amount);
  }
  return null;
}

export function SeatView({
  seat,
  state,
  t,
  justWon = false,
  name,
  count,
}: {
  seat: Seat;
  state: TarneebState;
  t: T;
  justWon?: boolean;
  /** Real player name (online); falls back to the positional label (You/Partner/…). */
  name?: string;
  /** Card count override (online views redact other hands, so pass the real size). */
  count?: number;
}) {
  const pos = posOf(seat, HUMAN_SEAT);
  const isTurn = state.turn === seat && state.phase !== 'hand-over' && state.phase !== 'game-over';
  const label = name ?? seatName(seat, t);
  const cardCount = count ?? state.hands[seat]?.length ?? 0;
  const bidLabel = lastBidLabel(state, seat, t);
  const isDeclarer = state.declarer === seat;

  return (
    <div className={`seat seat-${pos} ${isTurn ? 'turn' : ''} ${justWon ? 'won' : ''}`}>
      {pos !== 'bottom' && (
        <div className="mini-stack" aria-hidden="true">
          {Array.from({ length: Math.min(cardCount, 4) }).map((_, i) => (
            <div className="card back xs" key={i} style={{ left: `${i * 3}px` }} />
          ))}
          {cardCount > 0 && <span className="count">{cardCount}</span>}
        </div>
      )}
      <div className={`nameplate ${isTurn ? 'active' : ''}`}>
        <span className="avatar">{label.charAt(0)}</span>
        <span className="name">{label}</span>
        {isDeclarer && <span className="badge-declarer">★</span>}
      </div>
      {bidLabel && <div className="bid-bubble">{bidLabel}</div>}
    </div>
  );
}
