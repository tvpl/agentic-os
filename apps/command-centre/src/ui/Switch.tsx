/**
 * A switch on Radix (.specs/features/primitivas): `role="switch"`, `aria-checked`,
 * Space toggles, `disabled` does not. Two looks: the track (a pill with a thumb
 * that slides: the position says on/off without the colour) and, when it is
 * given children, the chip (the children are the face, there is no track).
 */
import type { ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** The chip face: when present there is no track or thumb. */
  children?: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
  "data-testid"?: string;
}

export function Switch({ checked, onCheckedChange, children, className, ...rest }: SwitchProps) {
  const chip = children !== undefined;
  return (
    <SwitchPrimitive.Root
      {...rest}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={["ui-switch", chip ? "chip" : "", className ?? ""].filter(Boolean).join(" ")}
    >
      {chip ? children : <SwitchPrimitive.Thumb className="ui-switch-thumb" />}
    </SwitchPrimitive.Root>
  );
}
