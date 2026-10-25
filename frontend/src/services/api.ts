import { useAppStore } from '../store/useAppStore';

const API_BASE = '/api/v1';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = useAppStore.getState().token;
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized: clear expired or invalid session credentials
  if (response.status === 401) {
    useAppStore.getState().setUser(null, null);
    localStorage.removeItem('stockpilot_token');
  }

  if (!response.ok) {
    let errorDetail = 'Network request failed';
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = response.statusText;
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export const api = {
  // Auth & Roles
  auth: {
    login: (body: any) => request<any>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    getMe: () => request<any>('/auth/me'),
    inviteUser: (body: any) => request<any>('/auth/invite', { method: 'POST', body: JSON.stringify(body) }),
    listUsers: () => request<any[]>('/auth/users'),
    updateUser: (userId: string, body: any) => request<any>(`/auth/users/${userId}`, { method: 'PUT', body: JSON.stringify(body) }),
    toggleUserActive: (userId: string) => request<any>(`/auth/users/${userId}/toggle-active`, { method: 'POST' }),
    switchRole: (role: string) => request<any>('/auth/demo/switch-role', { method: 'POST', body: JSON.stringify({ role }) }),
  },

  // Warehouses & Destinations
  warehouses: {
    list: () => request<any[]>('/warehouses'),
    listDestinations: () => request<any[]>('/warehouses/destinations'),
    create: (body: any) => request<any>('/warehouses', { method: 'POST', body: JSON.stringify(body) }),
    toggleOperational: (id: string) => request<any>(`/warehouses/${id}/toggle-operational`, { method: 'POST' }),
  },

  // Products & QR
  products: {
    list: () => request<any[]>('/products'),
    create: (body: any) => request<any>('/products', { method: 'POST', body: JSON.stringify(body) }),
    resolveQr: (code: string) => request<any>(`/products/resolve-qr?code=${encodeURIComponent(code)}`),
  },

  // Inventory & Ledger
  inventory: {
    list: (params?: { warehouse_id?: string; product_id?: string }) => {
      const search = new URLSearchParams();
      if (params?.warehouse_id && params.warehouse_id !== 'all') search.set('warehouse_id', params.warehouse_id);
      if (params?.product_id) search.set('product_id', params.product_id);
      return request<any[]>(`/inventory?${search.toString()}`);
    },
    listBatches: (params?: { warehouse_id?: string; product_id?: string }) => {
      const search = new URLSearchParams();
      if (params?.warehouse_id && params.warehouse_id !== 'all') search.set('warehouse_id', params.warehouse_id);
      if (params?.product_id) search.set('product_id', params.product_id);
      return request<any[]>(`/inventory/batches?${search.toString()}`);
    },
    listMovements: (limit = 50) => request<any[]>(`/inventory/movements?limit=${limit}`),
    receiveStock: (body: any) => request<any>('/inventory/receive', { method: 'POST', body: JSON.stringify(body) }),
    dispatchStock: (body: any) => request<any>('/inventory/dispatch', { method: 'POST', body: JSON.stringify(body) }),
    adjustStock: (body: any) => request<any>('/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
    reportDamage: (body: any) => request<any>('/inventory/damage', { method: 'POST', body: JSON.stringify(body) }),
    cycleCount: (body: any) => request<any>('/inventory/cycle-count', { method: 'POST', body: JSON.stringify(body) }),
    resolveDiscrepancy: (body: any) => request<any>('/inventory/discrepancy/resolve', { method: 'POST', body: JSON.stringify(body) }),
    reconcile: (warehouse_id: string, product_id?: string) => {
      const search = new URLSearchParams();
      search.set('warehouse_id', warehouse_id);
      if (product_id) search.set('product_id', product_id);
      return request<any>(`/inventory/reconcile?${search.toString()}`);
    },
  },

  // Transfers
  transfers: {
    list: () => request<any[]>('/transfers'),
    create: (body: any) => request<any>('/transfers', { method: 'POST', body: JSON.stringify(body) }),
    approveOrReject: (body: any) => request<any>('/transfers/approve', { method: 'POST', body: JSON.stringify(body) }),
    dispatch: (body: any) => request<any>('/transfers/dispatch', { method: 'POST', body: JSON.stringify(body) }),
    receive: (body: any) => request<any>('/transfers/receive', { method: 'POST', body: JSON.stringify(body) }),
    cancel: (body: any) => request<any>('/transfers/cancel', { method: 'POST', body: JSON.stringify(body) }),
  },

  // Warehouse Floor Tasks
  tasks: {
    list: (params?: { warehouse_id?: string; status?: string }) => {
      const search = new URLSearchParams();
      if (params?.warehouse_id && params.warehouse_id !== 'all') search.set('warehouse_id', params.warehouse_id);
      if (params?.status) search.set('status', params.status);
      const qs = search.toString();
      return request<any[]>(`/tasks${qs ? `?${qs}` : ''}`);
    },
    complete: (taskId: string, body?: { notes?: string; scanned_units?: number; condition?: string }) =>
      request<any>(`/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: 'POST',
        body: JSON.stringify(body || {}),
      }),
  },

  // Google OR-Tools Optimizer
  optimization: {
    run: (body: any) => request<any>('/optimization/run', { method: 'POST', body: JSON.stringify(body) }),
    listRuns: () => request<any[]>('/optimization/runs'),
    getRun: (id: string) => request<any>(`/optimization/run/${id}`),
    createTransferFromRecommendation: (run_id: string, recommendation_id: string, notes?: string) =>
      request<any>('/optimization/create-transfer', {
        method: 'POST',
        body: JSON.stringify({ run_id, recommendation_id, notes }),
      }),
  },

  // Demand Forecasting
  forecast: {
    getProductForecast: (productId: string, horizonDays = 14) => 
      request<any>(`/forecast/product/${productId}?horizon_days=${horizonDays}`),
  },

  // IoT Cold Chain
  iot: {
    getDevices: () => request<any[]>('/iot/devices'),
    getReadings: (deviceId?: string) => request<any[]>(`/iot/readings${deviceId ? `?device_id=${deviceId}` : ''}`),
    getAlerts: () => request<any[]>('/iot/alerts'),
    acknowledgeAlert: (id: string) => request<any>(`/iot/alerts/${id}/acknowledge`, { method: 'POST' }),
    injectSimulator: (body: any) => request<any>('/iot/simulator/inject', { method: 'POST', body: JSON.stringify(body) }),
  },

  // WhatsApp
  whatsapp: {
    simulateChat: (message_text: string, from_number?: string) => 
      request<any>('/whatsapp/simulator/chat', { method: 'POST', body: JSON.stringify({ message_text, from_number }) }),
    getLogs: () => request<any[]>('/whatsapp/logs'),
    getBridgeStatus: () => request<any>('/whatsapp/bridge/status'),
    pairBridge: (phone: string) => request<any>('/whatsapp/bridge/pair', { method: 'POST', body: JSON.stringify({ phone }) }),
  },

  // Audit Logs
  audit: {
    list: (limit = 50) => request<any[]>(`/audit?limit=${limit}`),
  },

  // Express Lane Fast Fulfillment (Quick-Commerce Model)
  express: {
    getConfig: () => request<any>('/express/config'),
    updateConfig: (body: any) => request<any>('/express/config', { method: 'POST', body: JSON.stringify(body) }),
    getSosClocks: (sku = 'PRD-VAX-01') => request<any>(`/express/sos?sku=${sku}`),
    evaluateOptions: (nodeId: string, sku: string, stock?: number, hour?: number) => {
      const params = new URLSearchParams();
      if (stock !== undefined) params.append('stock', stock.toString());
      if (hour !== undefined) params.append('hour', hour.toString());
      const qs = params.toString();
      return request<any>(`/express/evaluate/${nodeId}/${sku}${qs ? `?${qs}` : ''}`);
    },
    rationContention: (items: any[]) => request<any>('/express/contention', { method: 'POST', body: JSON.stringify(items) }),
    approve: (body: any) => request<any>('/express/approve', { method: 'POST', body: JSON.stringify(body) }),
    getTransfers: () => request<any>('/express/transfers'),
    simulate: () => request<any>('/express/simulate'),
  },
};
