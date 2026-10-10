/**
 * The hint of a control that has only an icon, on Radix (.specs/features/primitivas).
 * It appears with the keyboard focus and after the pointer rests on the control,
 * is `role="tooltip"` referenced by `aria-describedby`, and goes away with Escape
 * without moving focus. It never replaces the control's name: the control keeps
 * its own `aria-label`, so touch and the platform's accessibility tree still have it.
 */
import {
  cloneElement,
  createContext,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/** Whether a provider is already above (one provider keeps the "skip the delay" window between neighbours). */
const InProvider = createContext(false);

/** Mount once, at the root of an app (the shell, the gallery). A `Tooltip` outside one brings its own. */
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <InProvider.Provider value>
      <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
        {children}
      </TooltipPrimitive.Provider>
    </InProvider.Provider>
  );
}

export interface TooltipProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** What the hint says: the control's name, and the key that runs it when it has one. No label, no hint. */
  label?: ReactNode;
  /** The control: one element that takes a ref (a button, a link). */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * Props and ref given to a `Tooltip` go to its control, so a `Tooltip` can sit
 * under another Radix trigger (`asChild`) and the two share one element.
 */
export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(function Tooltip(
  { label, children, side = "top", align = "center", ...forwarded },
  ref,
) {
  const inProvider = useContext(InProvider);
  if (label === undefined || label === null || label === false || label === "")
    return cloneElement(children, { ...forwarded, ref } as Record<string, unknown>);
  const tip = (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild {...forwarded} ref={ref}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="ui-tip"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return inProvider ? tip : <UiProvider>{tip}</UiProvider>;
});
