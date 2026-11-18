import { brandName } from "../brand";
import { Brand, Icon } from "../components/common";
import "./welcome.css";

export default function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="welcome-page">
      <div className="welcome-content">
        <div className="welcome-copy">
          <Brand />
          <h1>Suas finanças, com clareza.</h1>
          <p>Acompanhe seus gastos, planeje o mês e organize suas metas.</p>
        </div>
        <button className="button welcome-start" onClick={onContinue}>
          Entrar no {brandName} <Icon name="arrowRight" size={19} />
        </button>
      </div>
    </main>
  );
}
