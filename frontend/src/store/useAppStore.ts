import { create } from 'zustand';
import { User, RoleType } from '../types';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface AppState {
  user: User | null;
  token: string | null;
  activeRole: RoleType;
  selectedWarehouseId: string;
  theme: 'dark' | 'light';
  toasts: Toast[];
  setUser: (user: User | null, token: string | null) => void;
  setActiveRole: (role: RoleType) => void;
  setSelectedWarehouseId: (id: string) => void;
  toggleTheme: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: {
    id: 'usr_supplychain',
    email: 'supplychain@stockpilot.ai',
    full_name: 'Elena Rostova',
    role: 'supply_chain_manager',
    org_id: 'org_triwiz_01',
    warehouse_id: null,
    phone_number: '+13125550103',
    is_active: true,
    created_at: new Date().toISOString(),
  },
  token: localStorage.getItem('stockpilot_token') || 'demo_token',
  activeRole: (localStorage.getItem('stockpilot_role') as RoleType) || 'supply_chain_manager',
  selectedWarehouseId: 'all',
  theme: (localStorage.getItem('stockpilot_theme') as 'dark' | 'light') || 'light',
  toasts: [],

  setUser: (user, token) => {
    if (token) localStorage.setItem('stockpilot_token', token);
    else localStorage.removeItem('stockpilot_token');
    set({ user, token, activeRole: user?.role || 'operator' });
  },

  setActiveRole: (role: RoleType) => {
    localStorage.setItem('stockpilot_role', role);
    const currentUser = get().user;
    if (currentUser) {
      set({ activeRole: role, user: { ...currentUser, role } });
    } else {
      set({ activeRole: role });
    }
  },

  setSelectedWarehouseId: (id: string) => set({ selectedWarehouseId: id }),

  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('stockpilot_theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme: nextTheme });
  },

  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 4500);
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
