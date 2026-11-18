import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type FieldProps = ComponentPropsWithoutRef<"input"> & { label: string; full?: boolean; children?: ReactNode };

export function Field({ label, children, full = false, ...props }: FieldProps) {
  return (
    <label className={full ? "field full" : "field"}>
      {label}
      {children ?? <input inputMode={props.type === "number" ? "numeric" : undefined} {...props} />}
    </label>
  );
}

export function FileField({ label, full, onChange, ...props }: Omit<FieldProps, "type" | "children">) {
  const [filename, setFilename] = useState("");
  return (
    <Field label={label} full={full}>
      <span className="file-picker">
        <span className="file-picker-button" aria-hidden="true">
          Escolher arquivo
        </span>
        <span className="file-picker-name" aria-hidden="true" title={filename}>
          {filename || "Nenhum arquivo selecionado"}
        </span>
        <input
          {...props}
          type="file"
          onChange={(event) => {
            setFilename(event.target.files?.[0]?.name ?? "");
            onChange?.(event);
          }}
        />
      </span>
    </Field>
  );
}
