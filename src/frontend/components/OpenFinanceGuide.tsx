import { Icon } from "./common";

/** Step-by-step for connecting banks through Meu Pluggy (free for personal use), shown in Ajuda e suporte. */
export function OpenFinanceGuide({ onOpenConnections }: { onOpenConnections: () => void }) {
  return (
    <div className="open-finance-guide">
      <h3>Conectar seus bancos (Open Finance)</h3>
      <p className="subtle">
        As compras do cartão e as movimentações da conta entram sozinhas, já na fatura certa. Usa o Meu Pluggy, que é
        grátis para uso pessoal (até 5 conexões, só das suas contas).
      </p>
      <ol>
        <li>
          Em <strong>meu.pluggy.ai</strong>, crie a sua conta e conecte os seus bancos. Cada banco precisa ficar com o
          ponto verde; se aparecer "Reconexão necessária", toque em <strong>Reconectar</strong>.
        </li>
        <li>
          Em <strong>dashboard.pluggy.ai</strong>, abra a sua aplicação. O aviso de teste de 15 dias não afeta o uso
          pessoal.
        </li>
        <li>
          Nas configurações de conectores da aplicação, ative o <strong>MeuPluggy</strong> se ele não aparecer na lista.
        </li>
        <li>
          Crie uma conexão, escolha <strong>MeuPluggy</strong> (não o banco direto), entre com a conta do Meu Pluggy e
          autorize os seus bancos.
        </li>
        <li>Copie o ID de cada conexão (Item ID). Ele tem o formato <code>00000000-0000-0000-0000-000000000000</code>.</li>
        <li>
          Na tela <strong>Open Finance</strong> (no menu lateral ou em <strong>Mais</strong>, no celular), cole o ID e
          toque em <strong>Vincular</strong>. Repita para cada banco.
        </li>
      </ol>
      <p className="subtle">
        Depois disso, os dados atualizam sozinhos uma vez por dia pelo Meu Pluggy. <strong>Sincronizar</strong> traz na
        hora o que o Meu Pluggy já tem.
      </p>
      <details className="form-details">
        <summary>Se algo der errado</summary>
        <ul>
          <li>
            <strong>"Conexão não encontrada"</strong>: o ID foi copiado errado ou é de outra aplicação da Pluggy.
          </li>
          <li>
            <strong>Banco com "Precisa reconectar"</strong>: reconecte o banco no Meu Pluggy e toque em Sincronizar.
          </li>
          <li>
            <strong>Compras que não aparecem</strong>: transações pendentes entram só depois de confirmadas pelo banco.
          </li>
        </ul>
      </details>
      <button type="button" className="text-button" onClick={onOpenConnections}>
        <Icon name="bank" size={15} /> Abrir Open Finance
      </button>
    </div>
  );
}
