// One icon set for the whole interface (lucide), referenced by short names.
import {
  Home, CalendarDays, Users, Package, Wallet, SlidersHorizontal, LogOut, Plus, ChevronLeft, ChevronRight, Search,
  CreditCard, TriangleAlert, Info, Check, X, Moon, Printer, Download, Clock, Menu, KeyRound, Pencil, List, Receipt,
  Landmark, BookOpen, Lock, LockOpen, FileSpreadsheet, Compass, ArrowLeftRight, Ban, Undo2, Play, CircleStop,
  RotateCcw, Database, UserPlus, HandCoins, Thermometer, Droplets, Archive, ArrowDownToLine, ArrowUpFromLine, Trash2,
  DoorOpen, Eye, EyeOff,
} from 'lucide-react';

const ICONS = {
  home: Home, rooms: DoorOpen, calendar: CalendarDays, users: Users, box: Package, wallet: Wallet, settings: SlidersHorizontal,
  logout: LogOut, plus: Plus, left: ChevronLeft, right: ChevronRight, search: Search, card: CreditCard,
  alert: TriangleAlert, info: Info, check: Check, x: X, moon: Moon, printer: Printer, download: Download,
  clock: Clock, menu: Menu, key: KeyRound, edit: Pencil, list: List, receipt: Receipt, bank: Landmark,
  book: BookOpen, lock: Lock, unlock: LockOpen, excel: FileSpreadsheet, tour: Compass, transfer: ArrowLeftRight,
  ban: Ban, undo: Undo2, play: Play, stop: CircleStop, reset: RotateCcw, database: Database, 'user-plus': UserPlus,
  cash: HandCoins, humidor: Archive, humidity: Droplets, temperature: Thermometer,
  deposit: ArrowDownToLine, withdraw: ArrowUpFromLine, trash: Trash2, eye: Eye, 'eye-off': EyeOff,
};

export default function Icon({ name, size, ...props }) {
  const Glyph = ICONS[name] ?? Info;
  return <Glyph aria-hidden="true" focusable="false" strokeWidth={1.8} {...(size ? { size } : {})} {...props} />;
}
