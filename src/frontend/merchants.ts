import chatgpt from "./assets/merchants/chatgpt.svg";
import claude from "./assets/merchants/claude.svg";
import gemini from "./assets/merchants/googlegemini.svg";
import ifood from "./assets/merchants/ifood.svg";
import netflix from "./assets/merchants/netflix.svg";
import primeVideo from "./assets/merchants/prime-video.png";
import shopee from "./assets/merchants/shopee.svg";
import spotify from "./assets/merchants/spotify.svg";
import starbucks from "./assets/merchants/starbucks.svg";
import uber from "./assets/merchants/uber.svg";
import walmart from "./assets/merchants/walmart.svg";
import youtube from "./assets/merchants/youtube.svg";

export const merchants = [
  { name: "iFood", category: "Alimentação", icon: ifood, background: "#ffe8ea", match: /\b(ifood|delivery|rappi|ze\s*delivery|aiqfome)\b/ },
  { name: "ChatGPT", category: "Assinaturas", icon: chatgpt, background: "#e6f9f3", match: /\b(chatgpt|openai|chat\s*gpt|gpt)\b/ },
  { name: "Uber", category: "Transporte", icon: uber, background: "#13161c", match: /\b(uber|99app|99pop|99\b|cabify)\b/ },
  { name: "Netflix", category: "Assinaturas", icon: netflix, background: "#181619", match: /\bnetflix\b/ },
  { name: "Spotify", category: "Assinaturas", icon: spotify, background: "#daf5e6", match: /\bspotify\b/ },
  { name: "Shopee", category: "Compras", icon: shopee, background: "#ffe9df", match: /\b(shopee|mercado\s*livre|mercadolivre|shein|aliexpress)\b/ },
  { name: "Prime Video", category: "Assinaturas", icon: primeVideo, background: "#fff", match: /\b(prime\s*video|amazon\s*prime|amzn\s*prime)\b/ },
  { name: "Claude", category: "Assinaturas", icon: claude, background: "#f9e9df", match: /\b(claude|anthropic)\b/ },
  { name: "Gemini", category: "Assinaturas", icon: gemini, background: "#e9efff", match: /\b(gemini|google ai)\b/ },
  { name: "Starbucks", category: "Alimentação", icon: starbucks, background: "#006241", match: /\bstarbucks\b/ },
  { name: "Walmart", category: "Mercado", icon: walmart, background: "#0058b5", match: /\b(wal\s*mart|carrefour|pao de acucar|assai|atacad(ao)?)\b/ },
  { name: "YouTube", category: "Assinaturas", icon: youtube, background: "#ffe8ea", match: /\byoutube\b/ },
];

export function findMerchant(description: string) {
  const normalized = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return merchants.find(({ match }) => match.test(normalized));
}

export function isShopping(description: string) {
  return /^(compra|compras)$/i.test(description.trim()) ||
    /\b(mercado|supermercado|amazon|carrinho|loja|magalu|magazine)\b/i.test(description);
}

export function inferCategory(description: string): string {
  const merchant = findMerchant(description);
  if (merchant) return merchant.category;
  if (isShopping(description)) return "Compras";

  const norm = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\b(delivery|restaurante|padaria|lanche|burger|pizza|mcdonald|bar|acougue|cafe|alimentacao|refeicao)\b/.test(norm)) {
    return "Alimentação";
  }
  if (/\b(mercado|supermercado|hipermercado|hortifruti|sacolao)\b/.test(norm)) {
    return "Mercado";
  }
  if (/\b(combustivel|gasolina|etanol|posto|estacionamento|pedagio|onibus|metro|passagem)\b/.test(norm)) {
    return "Transporte";
  }
  if (/\b(farmacia|drogaria|droga|medico|hospital|consulta|exame|dentista|remedio|saude)\b/.test(norm)) {
    return "Saúde";
  }
  if (/\b(assinatura|mensalidade|streaming|software|nuvem|icloud|google\s*storage|hbo|disney|max|crunchyroll)\b/.test(norm)) {
    return "Assinaturas";
  }
  if (/\b(luz|energia|agua|gas|internet|aluguel|condominio|iptu)\b/.test(norm)) {
    return "Moradia";
  }
  if (/\b(cinema|teatro|show|festa|lazer|viagem|hotel|passeio)\b/.test(norm)) {
    return "Lazer";
  }

  return "";
}
