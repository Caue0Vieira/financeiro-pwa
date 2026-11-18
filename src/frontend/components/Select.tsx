import type { ComponentPropsWithoutRef } from "react";

export function Select({ className, ...props }: ComponentPropsWithoutRef<"select">) {
  return <select {...props} className={className ? `select-control ${className}` : "select-control"} />;
}
