import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';

// Pages
import { DashboardPage } from './pages/DashboardPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { ForecastingPage } from './pages/ForecastingPage';
import { InventoryPage } from './pages/InventoryPage';
import { IoTPage } from './pages/IoTPage';
import { QRScannerPage } from './pages/QRScannerPage';
import { WhatsAppPage } from './pages/WhatsAppPage';
import { UsersPage } from './pages/UsersPage';

export const App: React.FC = () => {
  const { theme } = useAppStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex bg-slate-100 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 antialiased industrial-grid">
        {/* Persistent Collapsible Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <Navbar />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/optimizer" element={<OptimizerPage />} />
              <Route path="/forecasting" element={<ForecastingPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/iot" element={<IoTPage />} />
              <Route path="/qr" element={<QRScannerPage />} />
              <Route path="/whatsapp" element={<WhatsAppPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>

        {/* Global Toast Notifications */}
        <ToastContainer />
      </div>
    </BrowserRouter>
  );
};

export default App;
