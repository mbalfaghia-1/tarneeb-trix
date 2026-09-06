import { useState } from 'react';
import type { T } from '../i18n';

/**
 * A "leave game" button for the online boards + a confirm dialog. Leaving mid-game
 * abandons the seat (the server fills it with a bot), so we double-check first.
 */
export function LeaveButton({ onLeave, t }: { onLeave: () => void; t: T }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="leave-btn"
        onClick={() => setOpen(true)}
        aria-label={t('leaveGame')}
        title={t('leaveGame')}
      >
        🚪
      </button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">{t('leaveGame')}</div>
            <p className="panel-msg">{t('leaveConfirm')}</p>
            <div className="mode-choice">
              <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>
                {t('cancel')}
              </button>
              <button type="button" className="primary-btn" onClick={onLeave}>
                {t('leaveGame')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
