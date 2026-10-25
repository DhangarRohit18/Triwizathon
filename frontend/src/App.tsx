import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { RoleGuard } from './components/RoleGuard';

// Pages
import { DashboardPage } from './pages/DashboardPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { ForecastingPage } from './pages/ForecastingPage';
import { InventoryPage } from './pages/InventoryPage';
import { IoTPage } from './pages/IoTPage';
import { QRScannerPage } from './pages/QRScannerPage';
import { WhatsAppPage } from './pages/WhatsAppPage';
import { UsersPage } from './pages/UsersPage';
import { LoginPage } from './pages/LoginPage';
import { ExpressLanePage } from './pages/ExpressLanePage';
import { RuralReachPage } from './pages/RuralReachPage';

import { api } from './services/api';

export const App: React.FC = () => {
  const { theme, setUser } = useAppStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Ensure an authenticated signed session is bootstrapped seamlessly
  useEffect(() => {
    const bootstrapAuth = async () => {
      const curToken = localStorage.getItem('stockpilot_token');
      if (curToken && curToken !== 'demo_token') {
        try {
          const me = await api.auth.getMe();
          setUser(me, curToken);
        } catch (e) {
          console.warn('Session verification failed, requesting authenticated session:', e);
          try {
            const activeRole = useAppStore.getState().activeRole || 'supply_chain_manager';
            const res = await api.auth.switchRole(activeRole);
            setUser(res.user, res.access_token);
          } catch (err) {
            console.warn('Initial session bootstrap fallback:', err);
          }
        }
      } else {
        try {
          const activeRole = useAppStore.getState().activeRole || 'supply_chain_manager';
          const res = await api.auth.switchRole(activeRole);
          setUser(res.user, res.access_token);
        } catch (e) {
          console.warn('Initial session bootstrap fallback:', e);
        }
      }
    };
    bootstrapAuth();
  }, [setUser]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Dedicated 6-Role Login Portal */}
        <Route path="/login" element={<LoginPage />} />

        {/* Authenticated Workspace Layout */}
        <Route
          path="/*"
          element={
            <div className="min-h-screen flex bg-white text-slate-900 antialiased industrial-grid">
              {/* Persistent Collapsible Sidebar with Dynamic Role-Filtered Navigation */}
              <Sidebar />

              {/* Main Content Area */}
              <div className="flex-1 flex flex-col min-w-0">
                <Navbar />

                <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route 
                      path="/optimizer" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager']}>
                          <OptimizerPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/forecasting" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager']}>
                          <ForecastingPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/inventory" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager', 'warehouse_manager', 'distributor', 'operator']}>
                          <InventoryPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/iot" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'warehouse_manager']}>
                          <IoTPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/qr" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'warehouse_manager', 'distributor', 'operator']}>
                          <QRScannerPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/scanner" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'warehouse_manager', 'distributor', 'operator']}>
                          <QRScannerPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/whatsapp" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager', 'warehouse_manager']}>
                          <WhatsAppPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/users" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin']}>
                          <UsersPage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/express" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager', 'warehouse_manager']}>
                          <ExpressLanePage />
                        </RoleGuard>
                      } 
                    />
                    <Route 
                      path="/ruralreach" 
                      element={
                        <RoleGuard allowedRoles={['super_admin', 'org_admin', 'supply_chain_manager', 'warehouse_manager', 'distributor', 'operator']}>
                          <RuralReachPage />
                        </RoleGuard>
                      } 
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </div>
          }
        />
      </Routes>

      {/* Global Toast Notifications */}
      <ToastContainer />
    </BrowserRouter>
  );
};

export default App;
