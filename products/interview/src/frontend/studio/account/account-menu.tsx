import type { ProductMember } from "@omnitech/platform-contracts";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icon";
import { useSessionOpen } from "../live/use-session-open";
import { identityOf } from "./account-model";
import { SignOutDialog } from "./sign-out-dialog";

// The sidebar footer's account: avatar, name and a line, opening a menu with
// only the places that exist today (connected accounts; for the local user,
// signing in with a real account) and Sign out where there is a session to
// end. A popover menu: arrow keys move, Escape and an outside click close.
export function AccountMenu({
  member,
  tenant,
  secondary,
}: {
  member: ProductMember;
  tenant: string;
  // The footer's second line for a local user (the open artifact).
  secondary?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const liveSession = useSessionOpen();
  const who = identityOf(member);
  const local = member.kind === "local";

  const items = () => [
    ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  }

  const here = () => window.location.pathname + window.location.search;

  return (
    <div className="studio-account" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="studio-account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${who.name}`}
        title="Account"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="studio-avatar" aria-hidden="true">
          {who.initials}
        </span>
        <span className="studio-identity-text">
          <span className="studio-identity-name">{who.name}</span>
          <span className="studio-identity-sub">
            <span className="studio-online" aria-hidden="true" />
            {local && secondary ? `local · ${secondary}` : who.detail}
          </span>
        </span>
        <Icon name="unfold_more" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="studio-account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
        >
          <div className="studio-account-head">
            <span className="studio-avatar" aria-hidden="true">
              {who.initials}
            </span>
            <span>
              <span className="studio-identity-name">{who.name}</span>
              <span className="studio-account-detail">{who.detail}</span>
            </span>
          </div>
          <a
            role="menuitem"
            className="studio-account-item"
            href={`/t/${encodeURIComponent(tenant)}/settings/integrations`}
            onClick={() => close(false)}
          >
            <Icon name="settings" />
            Connected accounts
          </a>
          {local ? (
            <a
              role="menuitem"
              className="studio-account-item"
              href={`/sign-in?next=${encodeURIComponent(here())}`}
            >
              <Icon name="link" />
              Sign in with an account
            </a>
          ) : null}
          {member.canSignOut ? (
            <button
              type="button"
              role="menuitem"
              className="studio-account-item danger"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
            >
              <Icon name="close" />
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <SignOutDialog
          kind={member.kind}
          liveSession={liveSession}
          onCancel={() => {
            setConfirming(false);
            trigger.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
