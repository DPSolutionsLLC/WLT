import type { ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface-raised p-4 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
