import { RANK_LABEL, SUIT_IS_RED, SUIT_SYMBOL, type Seat, type Suit, type TrixState } from '@tarneeb/engine';
import { posOf } from '../../game/layout';
import { turnName } from '../../game/labels';
import type { T } from '../../i18n';

export function TrixSeat({
  seat,
  state,
  t,
  justWon = false,
}: {
  seat: Seat;
  state: TrixState;
  t: T;
  justWon?: boolean;
}) {
  const pos = posOf(seat, 0 as Seat);
  const isTurn =
    (state.phase === 'playing' || state.phase === 'shedding') && state.turn === seat;
  const dealDone = state.phase === 'deal-over' || state.phase === 'game-over';
  // Once the deal is over, hide the remaining-card stack/count — a finished deal can
  // legitimately leave the last shedder holding cards, but showing the count then reads
  // as an error rather than a result.
  const count = dealDone ? 0 : state.hands[seat]?.length ?? 0;
  const isKing = state.king === seat;
  const tricks = state.phase === 'playing' ? state.tricksTaken[seat] ?? 0 : 0;
  const finished = state.finishOrder.indexOf(seat);

  // Exposed 2s this seat still holds (removed once played into the layout).
  const twoPlayed = (suit: Suit): boolean => {
    const r = state.layout[suit];
    return r !== null && r.low <= 2;
  };
  const myTwos =
    state.phase === 'shedding'
      ? state.exposedTwos.filter((tw) => tw.holder === seat && !twoPlayed(tw.card.suit))
      : [];

  // Penalty cards this seat revealed & doubled — shown only while the seat still
  // holds the card (it disappears once the card has been played, like the 2s).
  const stillHolds = (c: { suit: Suit; rank: number }): boolean =>
    (state.hands[seat] ?? []).some((h) => h.suit === c.suit && h.rank === c.rank);
  const myDoubled =
    state.phase === 'doubling' || state.phase === 'playing'
      ? state.doubled.filter((d) => d.by === seat && stillHolds(d.card))
      : [];

  return (
    <div className={`seat seat-${pos} ${isTurn ? 'turn' : ''} ${justWon ? 'won' : ''}`}>
      {pos !== 'bottom' && (
        <div className="mini-stack" aria-hidden="true">
          {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
            <div className="card back xs" key={i} style={{ left: `${i * 3}px` }} />
          ))}
          {count > 0 && <span className="count">{count}</span>}
        </div>
      )}
      <div className={`nameplate ${isTurn ? 'active' : ''}`}>
        <span className="avatar">{turnName(seat, t).charAt(0)}</span>
        <span className="name">{turnName(seat, t)}</span>
        {isKing && <span className="badge-declarer">👑</span>}
      </div>
      {state.phase === 'playing' && <div className="trix-tricks">🂠 {tricks}</div>}
      {state.phase === 'shedding' && finished >= 0 && (
        <div className="trix-finish">#{finished + 1}</div>
      )}
      {myTwos.length > 0 && (
        <div className="seat-twos">
          {myTwos.map((tw) => (
            <span key={tw.card.suit} className={`two-chip ${SUIT_IS_RED[tw.card.suit] ? 'red' : ''}`}>
              2{SUIT_SYMBOL[tw.card.suit]}
            </span>
          ))}
        </div>
      )}
      {myDoubled.length > 0 && (
        <div className="seat-doubled">
          <span className="dbl-tag">{t('doubled_label')}</span>
          {myDoubled.map((d) => (
            <span
              key={`${d.card.rank}${d.card.suit}`}
              className={`two-chip ${SUIT_IS_RED[d.card.suit] ? 'red' : ''}`}
            >
              {RANK_LABEL[d.card.rank]}
              {SUIT_SYMBOL[d.card.suit]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
