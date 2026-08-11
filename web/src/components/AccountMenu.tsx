import { useEffect, useRef, useState } from "react";

import type { Translator } from "../i18n";

/**
 * The signed-in account control: an avatar that opens a menu.
 *
 * Replaces a bare "sign out" link that sat in the header at all times -- the
 * single most destructive control in the app, one stray tap away, next to the
 * language select. Behind a menu it takes two deliberate actions.
 *
 * The avatar is drawn here rather than fetched. The design export points at a
 * `googleusercontent.com` image, and this app ships `img-src 'self'`
 * (vite.config.ts), so a remote avatar would be blocked outright. There is
 * also no profile-image feature to source one from.
 *
 * Built to hold more items than it ships with -- the language select is the
 * obvious next tenant -- which is why it is a `menu` with `menuitem`s rather
 * than a single button wearing a popover.
 */
export function AccountMenu({ t, onSignOut }: { t: Translator; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // `pointerdown`, not `click`: a click that starts outside and ends inside
    // should still close the menu, and this fires before focus moves.
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }

    // Escape returns focus to the trigger. Without that, dismissing the menu
    // from the keyboard drops the focus ring at the top of the document and
    // the user has to tab back in from the beginning.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account" ref={wrap}>
      <button
        ref={trigger}
        className="avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.t("accountMenu")}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.75" />
          <path d="M12 13.4c-3.6 0-6.6 2.2-6.6 4.9 0 .9.8 1.6 1.8 1.6h9.6c1 0 1.8-.7 1.8-1.6 0-2.7-3-4.9-6.6-4.9Z" />
        </svg>
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {t.t("authSignOut")}
          </button>
        </div>
      )}
    </div>
  );
}
