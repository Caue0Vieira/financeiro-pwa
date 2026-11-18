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
  { name: "Uber", category: "Transporte", icon: uber, background: "#13161c", match: /\buber\b/ },
  { name: "Netflix", category: "Assinaturas", icon: netflix, background: "#181619", match: /\bnetflix\b/ },
  { name: "Claude", category: "Assinaturas", icon: claude, background: "#f9e9df", match: /\b(claude|anthropic)\b/ },
  { name: "Gemini", category: "Assinaturas", icon: gemini, background: "#e9efff", match: /\b(gemini|google ai)\b/ },
  { name: "Prime Video", category: "Assinaturas", icon: primeVideo, background: "#fff", match: /\b(prime\s*video|amazon\s*prime|amzn\s*prime)\b/ },
  { name: "iFood", category: "Alimentação", icon: ifood, background: "#ffe8ea", match: /\bifood\b/ },
  { name: "Shopee", category: "Compras", icon: shopee, background: "#ffe9df", match: /\bshopee\b/ },
  { name: "Spotify", category: "Assinaturas", icon: spotify, background: "#daf5e6", match: /\bspotify\b/ },
  { name: "Starbucks", category: "Alimentação", icon: starbucks, background: "#006241", match: /\bstarbucks\b/ },
  { name: "Walmart", category: "Compras", icon: walmart, background: "#0058b5", match: /\bwal\s*mart\b/ },
  { name: "YouTube", category: "Assinaturas", icon: youtube, background: "#ffe8ea", match: /\byoutube\b/ },
];

export function findMerchant(description: string) {
  const normalized = description.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return merchants.find(({ match }) => match.test(normalized));
}

export function isShopping(description: string) {
  return /^(compra|compras)$/i.test(description.trim()) ||
    /\b(mercado|supermercado|amazon|carrinho)\b/i.test(description);
}
