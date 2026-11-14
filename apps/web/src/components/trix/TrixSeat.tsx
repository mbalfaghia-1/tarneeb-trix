import type { RefObject } from 'react';
import { RANK_LABEL, SUIT_IS_RED, SUIT_SYMBOL, scoreTrixDeal, type Seat, type Suit, type TrixState } from '@tarneeb/engine';
import { posOf } from '../../game/layout';
import { turnName } from '../../game/labels';
import type { T } from '../../i18n';

export function TrixSeat({
  seat,
  state,
  t,
  justWon = false,
  name,
  count,
  turnTimer,
  elRef,
}: {
  seat: Seat;
  state: TrixState;
  t: T;
  justWon?: boolean;
  /** Real player name (online); falls back to the positional label. */
  name?: string;
  /** Card count override (online views redact other hands). */
  count?: number;
  /** Countdown timer (only passed for the human seat when awaiting). */
  turnTimer?: { limitMs: number; token: string };
  /** Measures this seat's real rendered height (passed only for the bottom seat,
   *  so the trick area can stay clear of it — see useElementHeight). */
  elRef?: RefObject<HTMLDivElement>;
}) {
  const pos = posOf(seat, 0 as Seat);
  const isTurn =
    (state.phase === 'playing' || state.phase === 'shedding') && state.turn === seat;
  const dealDone = state.phase === 'deal-over' || state.phase === 'game-over';
  // Once the deal is over, hide the remaining-card stack/count — a finished deal can
  // legitimately leave the last shedder holding cards, but showing the count then reads
  // as an error rather than a result.
  const cardCount = count ?? (dealDone ? 0 : state.hands[seat]?.length ?? 0);
  const label = name ?? turnName(seat, t);
  const isKing = state.king === seat;
  const tricks = state.phase === 'playing' ? state.tricksTaken[seat] ?? 0 : 0;
  const finished = state.finishOrder.indexOf(seat);

  // Running penalty tally for Complex deals (uses the real scoring function so
  // doubling bonuses/penalties are reflected immediately).
  const complexPenalty = (() => {
    if (state.phase !== 'playing' || state.contract !== 'complex') return null;
    const delta = scoreTrixDeal('complex', {
      captured: state.captured,
      tricksTaken: state.tricksTaken,
      finishOrder: [],
      doubled: state.doubled,
      doubledLeaders: state.doubledLeaders,
    });
    return delta[seat] ?? 0;
  })();

  // Exposed 2s this seat still holds (removed once played into the layout).
  const twoPlayed = (suit: Suit): boolean => {
    const r = state.layout[suit];
    return r !== null && r.low <= 2;
  };
  const myTwos =
    state.phase === 'shedding'
      ? state.exposedTwos.filter((tw) => tw.holder === seat && !twoPlayed(tw.card.suit))
      : [];

  // Penalty cards this seat revealed & doubled — hidden during the doubling phase
  // (all reveals happen together once everyone has decided), then shown while the
  // seat still holds the card (disappears once played, like the 2s).
  const stillHolds = (c: { suit: Suit; rank: number }): boolean =>
    (state.hands[seat] ?? []).some((h) => h.suit === c.suit && h.rank === c.rank);
  const myDoubled =
    state.phase === 'playing'
      ? state.doubled.filter((d) => d.by === seat && stillHolds(d.card))
      : [];

  return (
    <div ref={elRef} className={`seat seat-${pos} ${isTurn ? 'turn' : ''} ${justWon ? 'won' : ''}`}>
      {pos !== 'bottom' && (
        <div className="mini-stack" aria-hidden="true">
          {Array.from({ length: Math.min(cardCount, 4) }).map((_, i) => (
            <div className="card back xs" key={i} style={{ left: `${i * 3}px` }} />
          ))}
          {cardCount > 0 && <span className="count">{cardCount}</span>}
        </div>
      )}
      <div className={`nameplate ${isTurn ? 'active' : ''}`}>
        <div className="avatar-wrap">
          <span className="avatar">{label.charAt(0)}</span>
          {isTurn && (
            <svg className="turn-ring" viewBox="0 0 44 44" key={turnTimer?.token ?? 'bot'}>
              <circle className="turn-ring-track" cx="22" cy="22" r="18" />
              <circle
                className={`turn-ring-fill ${turnTimer ? 'countdown' : 'bot-ring'}`}
                cx="22" cy="22" r="18"
                style={turnTimer ? { animationDuration: `${turnTimer.limitMs}ms` } : undefined}
              />
            </svg>
          )}
        </div>
        <span className="name">{label}</span>
        {isKing && <span className="badge-declarer">👑</span>}
      </div>
      {state.phase === 'playing' && state.contract === 'diamonds' && (
        <div className="trix-tricks">♦ {(state.captured[seat] ?? []).filter((c) => c.suit === 'D').length}</div>
      )}
      {state.phase === 'playing' && state.contract === 'queens' && (
        <div className="trix-tricks">♛ {(state.captured[seat] ?? []).filter((c) => c.rank === 12).length}</div>
      )}
      {state.phase === 'playing' && state.contract !== 'diamonds' && state.contract !== 'queens' && (
        <div className="trix-tricks">🂠 {tricks}</div>
      )}
      {complexPenalty !== null && <div className="trix-penalty">{complexPenalty}</div>}
      {state.phase === 'shedding' && finished >= 0 && (
        <div className="trix-finish">#{finished + 1}</div>
      )}
      {(myTwos.length > 0 || myDoubled.length > 0) && (
        // Anchored to the SIDE of the seat (not stacked below the nameplate) so a
        // seat holding several doubled cards never grows taller and pushes into
        // the trick area in the middle — it just grows sideways, where there's
        // slack, instead of competing with the trick cards for the same band of
        // vertical space. See .seat-side-badges in theme.css for the per-position
        // anchor direction (always "inward", toward table center).
        <div className="seat-side-badges">
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
      )}
    </div>
  );
}
