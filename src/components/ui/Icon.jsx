// One icon set for the whole interface (lucide), referenced by short names.
import {
  Home, CalendarDays, Users, Package, Wallet, SlidersHorizontal, LogOut, Plus, ChevronLeft, ChevronRight, Search,
  CreditCard, TriangleAlert, Info, Check, X, Moon, Printer, Download, Clock, Menu, KeyRound, Pencil, List, Receipt,
  Landmark, BookOpen, Lock, LockOpen, FileSpreadsheet, Compass, ArrowLeftRight, Ban, Undo2, Play, CircleStop,
  RotateCcw, Database, UserPlus, HandCoins, Thermometer, Droplets, Archive, ArrowDownToLine, ArrowUpFromLine, Trash2,
  DoorOpen,
} from 'lucide-react';

const ICONS = {
  home: Home, rooms: DoorOpen, calendar: CalendarDays, users: Users, box: Package, wallet: Wallet, settings: SlidersHorizontal,
  logout: LogOut, plus: Plus, left: ChevronLeft, right: ChevronRight, search: Search, card: CreditCard,
  alert: TriangleAlert, info: Info, check: Check, x: X, moon: Moon, printer: Printer, download: Download,
  clock: Clock, menu: Menu, key: KeyRound, edit: Pencil, list: List, receipt: Receipt, bank: Landmark,
  book: BookOpen, lock: Lock, unlock: LockOpen, excel: FileSpreadsheet, tour: Compass, transfer: ArrowLeftRight,
  ban: Ban, undo: Undo2, play: Play, stop: CircleStop, reset: RotateCcw, database: Database, 'user-plus': UserPlus,
  cash: HandCoins, humidor: Archive, humidity: Droplets, temperature: Thermometer,
  deposit: ArrowDownToLine, withdraw: ArrowUpFromLine, trash: Trash2,
};

export default function Icon({ name, size, ...props }) {
  const Glyph = ICONS[name] ?? Info;
  return <Glyph aria-hidden="true" focusable="false" strokeWidth={1.8} {...(size ? { size } : {})} {...props} />;
}

export function BrandMark({ className = 'brand-mark' }) {
  return (
    // Limen, « La bague » : a cigar band with the L in its medallion (same drawing as public/favicon.svg).
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#231b15" />
      <path d="M6 24h11M6 40h11M47 24h11M47 40h11" stroke="#d1a16c" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#d1a16c" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="11.5" fill="none" stroke="#a07a52" strokeWidth="1" />
      <path d="M25.4 23h7v1.5h-1.6v14H36l1.3-3h1.4l-.5 4.5H25.4v-1.5H27v-14h-1.6z" fill="#d1a16c" />
    </svg>
  );
}
