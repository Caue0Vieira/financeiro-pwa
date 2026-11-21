import type { BalanceForecast } from "../../contracts";
import { money } from "../format";
import { BalanceChart } from "./charts";
import { Icon } from "./common";

const day = (date: string) => Number(date.slice(8, 10));

/** Home screen: where the balance goes until the end of the month, and the negative-day alert. */
export function ForecastPanel({ forecast, onOpenBills }: { forecast: BalanceForecast; onOpenBills: () => void }) {
  const alreadyNegative = forecast.today < 0;
  return (
    <section className="panel forecast-panel" aria-labelledby="forecast-title">
      <header className="panel-head">
        <div>
          <h2 id="forecast-title">Previsão de saldo</h2>
          <p>
            {forecast.basis === "bank"
              ? "A partir do saldo das contas no Open Finance, com o que vence até o fim do mês."
              : "Sobra do mês nas contas desde o dia 1, com o que vence até o fim do mês."}
          </p>
        </div>
      </header>
      {(forecast.negativeOn || alreadyNegative) && (
        <div className="forecast-alert">
          <Icon name="bell" size={17} />
          <p>
            <strong>
              {alreadyNegative ? "Seu saldo já está negativo" : `Dia ${day(forecast.negativeOn!)} você fica negativo`}
            </strong>
            O pior momento é o dia {day(forecast.lowest.date)}, com <span className="nowrap">{money(forecast.lowest.balance)}</span>.{" "}
            <button type="button" className="text-button" onClick={onOpenBills}>Ver contas a pagar</button>
          </p>
        </div>
      )}
      <dl className="forecast-values">
        <div>
          <dt>Hoje</dt>
          <dd className={forecast.today < 0 ? "negative" : undefined}>{money(forecast.today)}</dd>
        </div>
        <div>
          <dt>Fim do mês</dt>
          <dd className={forecast.end < 0 ? "negative" : undefined}>{money(forecast.end)}</dd>
        </div>
      </dl>
      <BalanceChart forecast={forecast} />
    </section>
  );
}
