import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

import { Label } from "./label";
import { cn } from "@/lib/utils";

/** Form helpers: shadcn primitives plus a label/hint/error wrapper. */

export { Checkbox } from "./checkbox";
export { Input } from "./input";
export { Label } from "./label";
export { Radio } from "./radio";
export { Select } from "./select";
export { Textarea } from "./textarea";

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  /** Inline validation message. Also marks the control invalid for AT. */
  error?: string;
  children: ReactNode;
  className?: string;
}

type ControlProps = Record<string, unknown>;

/**
 * Wraps one form control with a label, an optional hint, and an inline error.
 *
 * When `error` is set, the single child element receives `aria-invalid` and an
 * `aria-describedby` that points at the message, so screen readers announce
 * the problem without the caller wiring ids by hand.
 */
export function Field({ label, htmlFor, hint, required, error, children, className }: FieldProps) {
  const generatedId = useId();
  const hintId = `${htmlFor ?? generatedId}-hint`;
  const errorId = `${htmlFor ?? generatedId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  let control = children;
  if (isValidElement(children) && describedBy !== "") {
    const props = children.props as ControlProps;
    const existing = typeof props["aria-describedby"] === "string" ? props["aria-describedby"] : "";
    const merged = [existing, describedBy].filter(Boolean).join(" ");

    control = cloneElement(children as ReactElement<ControlProps>, {
      "aria-invalid": error ? true : props["aria-invalid"],
      "aria-describedby": merged === "" ? undefined : merged,
    });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
