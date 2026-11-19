import type { Card } from "../../contracts";
import { cardLabel } from "../format";
import { Field } from "./Field";
import { Select } from "./Select";

/** Where a recurring bill is paid: from the account, or charged on a card (then it joins that card's invoice). */
export function PayWithField({ cards, defaultValue = "" }: { cards: Pick<Card, "id" | "name">[]; defaultValue?: string }) {
  return (
    <Field label="Pago com" full>
      <Select name="payWith" defaultValue={defaultValue}>
        <option value="">Conta (débito, Pix ou boleto)</option>
        {cards.map(({ id, name }) => <option key={id} value={id}>{cardLabel(name)}</option>)}
      </Select>
    </Field>
  );
}
