import {
  type ButtonHTMLAttributes,
  cloneElement,
  forwardRef,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Icon, type IconName } from "../studio/icon";
import { join } from "./join";

// The ONE button. Every look is data: a variant, a size, a state. CSS (ui.css)
// selects on the data attributes this component emits and reads only the --ui-*
// tokens (tokens.css); it never knows a colour or a pixel. To add a variant: add
// its name to ButtonVariant, describe it in BUTTON_VARIANTS, give it a block in
// tokens.css and a rule in ui.css (button.test.tsx fails until the CSS exists).

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "go"
  | "link"
  | "glass";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonState = "idle" | "loading" | "pressed";

interface VariantSpec {
  /** The job this variant does, in one sentence: how to choose it. */
  readonly purpose: string;
}

interface SizeSpec {
  /** When to choose this size. */
  readonly purpose: string;
  /** The token that sets the control height (tokens.css). */
  readonly heightToken: string;
}

export const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, VariantSpec>> = {
  primary: {
    purpose: "The one main action of a surface or dialog (accent fill).",
  },
  secondary: {
    purpose: "The default: an ordinary action (outlined on the surface).",
  },
  ghost: {
    purpose:
      "A quiet action or icon-only control (transparent, fills on hover).",
  },
  destructive: {
    purpose:
      "An action that ends or deletes something (red fill): End, Delete.",
  },
  go: {
    purpose: "Start or resume something (green fill): Start session, Resume.",
  },
  link: {
    purpose: "An inline action that reads as text (underline on hover).",
  },
  glass: {
    purpose: "A control on translucent chrome: native panels, toolbars, pills.",
  },
};

export const BUTTON_SIZES: Readonly<Record<ButtonSize, SizeSpec>> = {
  sm: { purpose: "Dense rows and toolbars.", heightToken: "--ui-height-sm" },
  md: { purpose: "The default control.", heightToken: "--ui-height-md" },
  lg: {
    purpose:
      "Top-level live buttons: the 40px hit area the layout rules require.",
    heightToken: "--ui-height-lg",
  },
  icon: {
    purpose: "Icon only: a square the height of md. Needs an aria-label.",
    heightToken: "--ui-height-icon",
  },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon. */
  iconAfter?: IconName;
  /** Busy: disables the control, sets aria-busy and swaps the icon for a spinner. */
  loading?: boolean;
  /** A toggle that is on: sets aria-pressed. */
  pressed?: boolean;
  /** Render the single child element (an <a href>) instead of a <button>. */
  asChild?: boolean;
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      icon,
      iconAfter,
      loading = false,
      pressed,
      asChild = false,
      type = "button",
      className,
      disabled,
      onClick,
      children,
      ...rest
    },
    ref,
  ) {
    const state: ButtonState = loading
      ? "loading"
      : pressed
        ? "pressed"
        : "idle";
    // A loading button is a disabled button: the native shell's cursor and drag
    // probe treats [disabled] and [aria-disabled] as inert controls.
    const inert = Boolean(disabled) || loading;

    const content = (inner: ReactNode) => (
      <>
        {loading ? (
          <span data-slot="button-spinner" aria-hidden="true" />
        ) : icon ? (
          <Icon name={icon} />
        ) : null}
        {inner}
        {iconAfter ? <Icon name={iconAfter} /> : null}
      </>
    );

    const shared = {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      "data-state": state,
      className: join(className),
    };

    // Stops a click on an inert anchor; a real <button> needs no help.
    const blockClick = (event: MouseEvent<HTMLElement>) => {
      if (inert) {
        event.preventDefault();
        return;
      }
      onClick?.(event as MouseEvent<HTMLButtonElement>);
    };

    if (asChild) {
      const child = children;
      if (!isValidElement(child)) return null;
      const element = child as ReactElement<{
        className?: string;
        children?: ReactNode;
        ref?: Ref<HTMLElement>;
      }>;
      return cloneElement(
        element,
        {
          ...rest,
          ...shared,
          className: join(element.props.className, className),
          "aria-busy": loading || undefined,
          "aria-pressed": pressed,
          "aria-disabled": inert || undefined,
          tabIndex: inert ? -1 : undefined,
          onClick: blockClick,
          ref: (node: HTMLElement | null) => {
            setRef(element.props.ref, node);
            setRef(ref as Ref<HTMLElement | null>, node);
          },
        } as Record<string, unknown>,
        content(element.props.children),
      );
    }

    return (
      <button
        {...rest}
        {...shared}
        ref={ref}
        type={type}
        disabled={inert}
        aria-busy={loading || undefined}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {content(children)}
      </button>
    );
  },
);
Button.displayName = "Button";
