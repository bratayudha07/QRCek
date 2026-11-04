import type { ReactNode } from "react";

import { Label } from "./label";
import { cn } from "@/lib/utils";

/** Form helpers: shadcn primitives plus a label/hint wrapper. */

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
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
