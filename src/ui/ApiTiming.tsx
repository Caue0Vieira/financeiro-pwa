import { useEffect, useRef, useState } from 'react';
import type { FinanceService } from '../contracts';

const sampleSize = 20;

export function ApiTiming({ service, month }: { service: FinanceService; month: string }) {
  const [completed, setCompleted] = useState<number>();
  const [p95, setP95] = useState<number>();
  const [error, setError] = useState(false);
  const run = useRef(0);

  useEffect(() => () => { run.current++; }, [service, month]);

  async function measure() {
    const id = ++run.current;
    setCompleted(0);
    setP95(undefined);
    setError(false);
    const timings: number[] = [];
    try {
      for (let sample = 0; sample < sampleSize; sample++) {
        if (run.current !== id) return;
        const start = performance.now();
        await service.dashboard(month);
        if (run.current !== id) return;
        timings.push(performance.now() - start);
        setCompleted(timings.length);
      }
      timings.sort((a, b) => a - b);
      setP95(timings[Math.ceil(sampleSize * 0.95) - 1]);
    } catch {
      if (run.current === id) setError(true);
    } finally {
      if (run.current === id) setCompleted(undefined);
    }
  }

  return (
    <section className="panel" aria-labelledby="api-timing-heading">
      <div className="panel-head">
        <div>
          <h2 id="api-timing-heading">Tempo de resposta</h2>
          <p>Rode uma vez em Wi-Fi e outra em 4G. A meta é 500 ms no p95.</p>
        </div>
      </div>
      <button type="button" className="button secondary" disabled={completed !== undefined}
        onClick={() => void measure()}>
        Medir API do painel
      </button>
      {completed !== undefined && <p>Consultas concluídas: {completed} de {sampleSize}</p>}
      {p95 !== undefined && <p role="status">p95 de {Math.round(p95)} ms em {sampleSize} consultas.</p>}
      {error && <p role="alert">A medição foi interrompida. Confira a conexão e tente novamente.</p>}
    </section>
  );
}
