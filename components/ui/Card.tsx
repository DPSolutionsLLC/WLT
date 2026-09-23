import type { ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
  // An anchor target, so a deep link can land on one card in a long list — /prayers#sunday-<id>
  // is how the Sacrament hub's Prayer pill arrives on the right Sunday (p4-sacrament-a).
  // Deliberately the ONLY pass-through prop: a `...rest` spread here would let any caller put
  // an onClick on a presentational wrapper and quietly make it a control with no focus ring and
  // no keyboard path.
  id?: string;
};

export function Card({ children, className = "", id }: CardProps) {
  return (
    <div
      id={id}
      className={`rounded-lg border border-border bg-surface-raised p-4 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
