import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  CalendarClock,
  Camera,
  Car,
  Coffee,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Download,
  Ellipsis,
  EllipsisVertical,
  Eye,
  EyeOff,
  Heart,
  HeartPulse,
  CircleHelp,
  Gamepad2,
  House,
  Landmark,
  Laptop,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  PiggyBank,
  PieChart,
  Plane,
  Plus,
  Repeat2,
  ReceiptText,
  Search,
  Send,
  Settings2,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Palette,
  Sun,
  Target,
  TrendingUp,
  Upload,
  UserRound,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import type { Entry, Profile } from "../../contracts";
import { shiftMonth } from "../../date";
import brandMark from "../assets/nitido-mark.webp";
import { brandName } from "../brand";
import { dateLabel, kindLabel, money, monthName } from "../format";
import { findMerchant, isShopping } from "../merchants";

export function PixGlyph({
  size = 19,
  strokeWidth: _strokeWidth,
  className,
  ...props
}: {
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
    </svg>
  );
}

const icons = {
  activity: ArrowLeftRight,
  bell: Bell,
  help: CircleHelp,
  gamepad: Gamepad2,
  analytics: BarChart3,
  arrowDown: ArrowDownLeft,
  back: ArrowLeft,
  arrowUp: ArrowUpRight,
  arrowRight: ArrowRight,
  bank: Landmark,
  calendar: CalendarDays,
  camera: Camera,
  card: CreditCard,
  car: Car,
  coffee: Coffee,
  deposit: Download,
  chart: TrendingUp,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  clock: CalendarClock,
  close: X,
  eye: Eye,
  eyeOff: EyeOff,
  food: Utensils,
  goal: Target,
  health: HeartPulse,
  home: LayoutGrid,
  house: House,
  laptop: Laptop,
  logout: LogOut,
  more: Ellipsis,
  moreVertical: EllipsisVertical,
  menu: Menu,
  moon: Moon,
  palette: Palette,
  piggy: PiggyBank,
  pix: PixGlyph,
  budget: PieChart,
  budgetList: ClipboardList,
  heart: Heart,
  plane: Plane,
  plus: Plus,
  repeat: Repeat2,
  receipt: ReceiptText,
  search: Search,
  send: Send,
  settings: Settings2,
  settingsGear: Settings,
  shield: ShieldCheck,
  shopping: ShoppingBag,
  cart: ShoppingCart,
  sun: Sun,
  upload: Upload,
  user: UserRound,
  wallet: Wallet,
};

export type IconName = keyof typeof icons;

export function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={1.85} aria-hidden="true" />;
}

export function BrandMark({ size }: { size: number }) {
  return <img src={brandMark} alt="" width={size} height={size} />;
}

export function Brand() {
  return (
    <span className="brand">
      <BrandMark size={40} />
      {brandName}
    </span>
  );
}

export function Avatar({ profile }: { profile: Profile }) {
  return (
    <span className="avatar" aria-hidden="true">
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" />
      ) : (
        (profile.name.trim()[0] || brandName[0]).toLocaleUpperCase("pt-BR")
      )}
    </span>
  );
}

export const BackNavigation = createContext<(() => void) | null>(null);

export function HeaderMenu({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      const menu = ref.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }

    document.addEventListener("click", closeOutside, true);
    return () => document.removeEventListener("click", closeOutside, true);
  }, []);

  return (
    <details
      className="reference-header-menu"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="icon-button" aria-label={label}>
        <Icon name={icon} size={20} />
      </summary>
      <div className="reference-menu-content">{children}</div>
    </details>
  );
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const goBack = useContext(BackNavigation);
  return (
    <header className="page-heading">
      <div className="page-heading-title">
        {goBack && (
          <button className="icon-button mobile-back" onClick={goBack} aria-label="Voltar">
            <Icon name="back" />
          </button>
        )}
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

export function MonthControl({ month, onMonth }: { month: string; onMonth: (month: string) => void }) {
  return (
    <div className="month-switch">
      <button type="button" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
        <Icon name="chevronLeft" size={17} />
      </button>
      <span aria-live="polite">
        <Icon name="calendar" size={16} />
        {monthName(month)}
      </span>
      <button type="button" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
        <Icon name="chevronRight" size={17} />
      </button>
    </div>
  );
}

const categoryIcons: Record<string, { icon: IconName; tone: string }> = {
  alimentação: { icon: "food", tone: "peach" },
  moradia: { icon: "house", tone: "teal" },
  transporte: { icon: "car", tone: "blue" },
  saúde: { icon: "health", tone: "rose" },
  compras: { icon: "cart", tone: "violet" },
  entretenimento: { icon: "gamepad", tone: "lavender" },
  assinaturas: { icon: "gamepad", tone: "lavender" },
};

export function categoryAppearance(name: string): { icon: IconName; tone: string } {
  return categoryIcons[name.toLocaleLowerCase("pt-BR")] ?? { icon: "receipt", tone: "mint" };
}

/** Icon for an entry: the merchant's logo when known, otherwise its category. */
export function EntryBadge({
  entry,
  compact,
}: {
  entry: Pick<Entry, "description" | "category" | "kind" | "amount">;
  compact?: boolean;
}) {
  const isPix = /\bpix\b/i.test(entry.description) || /^pix$/i.test(entry.category.trim());
  const category = categoryAppearance(entry.category);
  const appearance =
    entry.kind === "saving"
      ? ({ icon: "piggy", tone: "teal" } as const)
      : entry.kind === "card_payment"
        ? ({ icon: "card", tone: "violet" } as const)
        : entry.amount > 0
          ? ({ icon: "arrowDown", tone: "mint" } as const)
          : category;
  const merchant = isPix || entry.kind === "card_payment" ? undefined : findMerchant(entry.description);
  const icon =
    isPix
      ? "pix"
      : appearance.icon === "food" && /caf[eé]/i.test(entry.description)
        ? "coffee"
        : (entry.kind === "expense" || entry.kind === "refund") && isShopping(entry.description)
          ? "cart"
          : compact && appearance.icon === "arrowDown"
            ? "receipt"
            : appearance.icon;
  return (
    <span
      className={`transaction-icon tone-${appearance.tone}${merchant ? " merchant-icon" : ""}`}
      data-tone={icon === "coffee" ? "coffee" : appearance.tone}
      style={merchant ? { backgroundColor: merchant.background } : undefined}
    >
      {merchant ? <img src={merchant.icon} alt="" /> : <Icon name={icon} size={18} />}
    </span>
  );
}

export function EntryRow({
  entry,
  onEdit,
  grouped,
  compact,
  dateText,
}: {
  entry: Entry;
  onEdit: (entry: Entry) => void;
  grouped?: boolean;
  compact?: boolean;
  dateText?: string;
}) {
  const amountText = (entry.amount > 0 ? "+ " : entry.amount < 0 ? "− " : "") + money(Math.abs(entry.amount));
  const badge = <EntryBadge entry={entry} compact={compact} />;
  if (compact) {
    const recentDate = grouped
      ? `${entry.category || kindLabel[entry.kind]}${entry.status === "planned" ? " · Previsto" : ""}`
      : (dateText ?? dateLabel(entry.date));
    return (
      <button
        className="transaction home-entry-row"
        onClick={() => onEdit(entry)}
        aria-label={`Editar ${entry.description}, ${recentDate}, ${amountText}`}
      >
        {badge}
        <span className="transaction-info">
          <strong>{entry.description}</strong>
          <span>
            {recentDate}
            {entry.installmentCount ? ` · ${entry.installmentNumber}/${entry.installmentCount}` : ""}
          </span>
        </span>
        <span className={`transaction-amount ${entry.amount > 0 ? "income" : ""}`}>{amountText}</span>
      </button>
    );
  }
  const label =
    entry.kind === "card_payment" && Math.abs(entry.amount) > (entry.allocatedAmount || 0)
      ? "Fatura a conciliar"
      : entry.category || kindLabel[entry.kind];
  const detail = [
    label,
    !grouped && dateLabel(entry.date),
    entry.status === "planned" && "Previsto",
    entry.installmentCount && `${entry.installmentNumber}/${entry.installmentCount}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="transaction">
      {badge}
      <div className="transaction-info">
        <strong>{entry.description}</strong>
        <span>{detail}</span>
      </div>
      <span className={`transaction-amount ${entry.amount > 0 ? "income" : ""}`}>{amountText}</span>
      <button
        className="icon-button row-edit"
        onClick={() => onEdit(entry)}
        aria-label={`Editar ${entry.description}`}
      >
        <Icon name="more" size={19} />
      </button>
    </div>
  );
}

export function Entries({
  entries,
  onEdit,
  empty = "Adicione um lançamento ou importe um extrato.",
}: {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
  empty?: string;
}) {
  return entries.length ? (
    entries.map((entry) => <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />)
  ) : (
    <p className="empty">{empty}</p>
  );
}
