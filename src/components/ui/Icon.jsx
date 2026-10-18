// One icon set for the whole interface (lucide), referenced by short names.
import {
  Home, CalendarDays, Users, Package, Wallet, SlidersHorizontal, LogOut, Plus, ChevronLeft, ChevronRight, Search,
  CreditCard, TriangleAlert, Info, Check, X, Moon, Printer, Download, Clock, Menu, KeyRound, Pencil, List, Receipt,
  Landmark, BookOpen, Lock, LockOpen, FileSpreadsheet, Compass, ArrowLeftRight, Ban, Undo2, Play, CircleStop,
  RotateCcw, Database, UserPlus, HandCoins, Thermometer, Droplets, Archive, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';

const ICONS = {
  home: Home, calendar: CalendarDays, users: Users, box: Package, wallet: Wallet, settings: SlidersHorizontal,
  logout: LogOut, plus: Plus, left: ChevronLeft, right: ChevronRight, search: Search, card: CreditCard,
  alert: TriangleAlert, info: Info, check: Check, x: X, moon: Moon, printer: Printer, download: Download,
  clock: Clock, menu: Menu, key: KeyRound, edit: Pencil, list: List, receipt: Receipt, bank: Landmark,
  book: BookOpen, lock: Lock, unlock: LockOpen, excel: FileSpreadsheet, tour: Compass, transfer: ArrowLeftRight,
  ban: Ban, undo: Undo2, play: Play, stop: CircleStop, reset: RotateCcw, database: Database, 'user-plus': UserPlus,
  cash: HandCoins, humidor: Archive, humidity: Droplets, temperature: Thermometer,
  deposit: ArrowDownToLine, withdraw: ArrowUpFromLine,
};

export default function Icon({ name, size, ...props }) {
  const Glyph = ICONS[name] ?? Info;
  return <Glyph aria-hidden="true" focusable="false" strokeWidth={1.8} {...(size ? { size } : {})} {...props} />;
}

export function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2a2b2f" />
      <path d="M32 12 50 32 32 52 14 32Z" fill="none" stroke="#c8925a" strokeWidth="4" />
      <path d="M32 23 41 32 32 41 23 32Z" fill="#c8925a" />
    </svg>
  );
}
