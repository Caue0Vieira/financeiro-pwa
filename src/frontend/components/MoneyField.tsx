import { useLayoutEffect, useRef, useState } from "react";
import { money } from "../format";
import { centsFromDigits, centsFromPaste } from "../moneyInput";
import { Field } from "./Field";

type MoneyFieldProps = {
  label: string;
  name: string;
  min?: number;
  required?: boolean;
  full?: boolean;
  "aria-describedby"?: string;
} & (
  | { defaultValue?: number; value?: never; onValueChange?: never }
  | { defaultValue?: never; value: number | undefined; onValueChange: (cents: number | undefined) => void }
);

function positionWithDigitsAfter(text: string, count: number) {
  if (count === 0) return text.length;
  for (let index = text.length - 1; index >= 0; index--) {
    if (/\d/.test(text[index]) && --count === 0) return index;
  }
  return text.search(/\d/);
}

export default function MoneyField({
  label,
  name,
  min = 1,
  required,
  full,
  "aria-describedby": describedBy,
  ...props
}: MoneyFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(props.defaultValue);
  const cents = props.onValueChange ? props.value : draft;
  const formatted = cents === undefined ? "" : money(cents);

  useLayoutEffect(() => {
    ref.current?.setCustomValidity(
      cents !== undefined && cents < min ? `Informe um valor de pelo menos ${money(min)}.` : "",
    );
  }, [cents, min]);

  function update(next: number | undefined, trailingDigits = 0) {
    if (props.onValueChange) props.onValueChange(next);
    else setDraft(next);
    requestAnimationFrame(() => {
      const input = ref.current;
      if (!input || document.activeElement !== input) return;
      const position = Math.max(0, positionWithDigitsAfter(input.value, trailingDigits));
      input.setSelectionRange(position, position);
    });
  }

  return (
    <Field label={label} full={full}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        name={name}
        value={formatted}
        placeholder="R$ 0,00"
        required={required}
        aria-describedby={describedBy}
        onChange={(event) => {
          const input = event.currentTarget;
          const text = input.value;
          const trailingDigits = text.slice(input.selectionStart ?? text.length).replace(/\D/g, "").length;
          const next = centsFromDigits(text);
          if (next === undefined && /\d/.test(text)) return;
          const skippedSeparator =
            next === cents &&
            text !== formatted &&
            (event.nativeEvent as InputEvent).inputType === "deleteContentBackward";
          update(next, trailingDigits + Number(skippedSeparator));
        }}
        onPaste={(event) => {
          event.preventDefault();
          const pasted = centsFromPaste(event.clipboardData.getData("text"));
          if (pasted !== undefined) update(pasted);
        }}
      />
    </Field>
  );
}
