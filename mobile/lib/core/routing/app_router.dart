import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/user_model.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/profile_screen.dart';
import '../../features/dashboard/screens/dashboard_screen.dart';
import '../../features/inventory/screens/inventory_list_screen.dart';
import '../../features/iot/screens/iot_monitor_screen.dart';
import '../../features/scanning/screens/qr_scan_screen.dart';
import '../../features/tasks/screens/dispatch_stock_screen.dart';
import '../../features/tasks/screens/receive_stock_screen.dart';
import '../../features/tasks/screens/tasks_screen.dart';
import '../../features/transfers/screens/transfers_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/dashboard',
    redirect: (context, state) {
      final isLoggedIn = authState.isAuthenticated;
      final isLoggingIn = state.matchedLocation == '/login';

      if (!isLoggedIn && !isLoggingIn) {
        return '/login';
      }
      if (isLoggedIn && isLoggingIn) {
        return '/dashboard';
      }

      // Strict role-aware route protection
      if (isLoggedIn && authState.user != null) {
        final user = authState.user!;
        final path = state.matchedLocation;

        // 1. Inbound/Outbound floor tasks restricted from distributor
        if (path.startsWith('/tasks') && !user.canAccessTasks) {
          return '/dashboard';
        }

        // 2. Transfers restricted from warehouse operator
        if (path.startsWith('/transfers') && user.role == UserRole.operator) {
          return '/dashboard';
        }

        // 3. IoT cold-chain telemetry restricted from operator and distributor
        if (path.startsWith('/iot') && !user.canAccessIot) {
          return '/dashboard';
        }
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) {
          return ScaffoldWithBottomNav(child: child);
        },
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/inventory',
            builder: (context, state) => const InventoryListScreen(),
          ),
          GoRoute(
            path: '/tasks',
            builder: (context, state) => const TasksScreen(),
          ),
          GoRoute(
            path: '/transfers',
            builder: (context, state) => const TransfersScreen(),
          ),
          GoRoute(
            path: '/iot',
            builder: (context, state) => const IotMonitorScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
        ],
      ),
      // Full screen modal action routes
      GoRoute(
        path: '/scan',
        builder: (context, state) => const QrScanScreen(),
      ),
      GoRoute(
        path: '/tasks/receive',
        builder: (context, state) => const ReceiveStockScreen(),
      ),
      GoRoute(
        path: '/tasks/dispatch',
        builder: (context, state) => const DispatchStockScreen(),
      ),
    ],
  );
});

class NavItemConfig {
  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;

  const NavItemConfig({
    required this.path,
    required this.label,
    required this.icon,
    required this.selectedIcon,
  });
}

class ScaffoldWithBottomNav extends ConsumerWidget {
  final Widget child;

  const ScaffoldWithBottomNav({super.key, required this.child});

  List<NavItemConfig> _getNavItems(UserRole role) {
    switch (role) {
      case UserRole.operator:
        return const [
          NavItemConfig(path: '/dashboard', label: 'Home', icon: Icons.dashboard_outlined, selectedIcon: Icons.dashboard),
          NavItemConfig(path: '/tasks', label: 'Pick & Tasks', icon: Icons.assignment_outlined, selectedIcon: Icons.assignment),
          NavItemConfig(path: '/inventory', label: 'Hub Stock', icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
          NavItemConfig(path: '/profile', label: 'Profile', icon: Icons.person_outline, selectedIcon: Icons.person),
        ];

      case UserRole.distributor:
        return const [
          NavItemConfig(path: '/dashboard', label: 'Manifest', icon: Icons.local_shipping_outlined, selectedIcon: Icons.local_shipping),
          NavItemConfig(path: '/inventory', label: 'Availability', icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
          NavItemConfig(path: '/transfers', label: 'Deliveries', icon: Icons.swap_horiz_outlined, selectedIcon: Icons.swap_horiz),
          NavItemConfig(path: '/profile', label: 'Profile', icon: Icons.person_outline, selectedIcon: Icons.person),
        ];

      case UserRole.warehouseManager:
        return const [
          NavItemConfig(path: '/dashboard', label: 'Facility', icon: Icons.storefront_outlined, selectedIcon: Icons.storefront),
          NavItemConfig(path: '/inventory', label: 'Batches', icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
          NavItemConfig(path: '/transfers', label: 'Transfers', icon: Icons.swap_horiz_outlined, selectedIcon: Icons.swap_horiz),
          NavItemConfig(path: '/iot', label: 'Cold-Chain', icon: Icons.thermostat_outlined, selectedIcon: Icons.thermostat),
          NavItemConfig(path: '/profile', label: 'Profile', icon: Icons.person_outline, selectedIcon: Icons.person),
        ];

      case UserRole.supplyChainManager:
        return const [
          NavItemConfig(path: '/dashboard', label: 'MIP Solver', icon: Icons.hub_outlined, selectedIcon: Icons.hub),
          NavItemConfig(path: '/inventory', label: 'Network', icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
          NavItemConfig(path: '/transfers', label: 'Approvals', icon: Icons.rule_outlined, selectedIcon: Icons.rule),
          NavItemConfig(path: '/iot', label: 'Telemetry', icon: Icons.thermostat_outlined, selectedIcon: Icons.thermostat),
          NavItemConfig(path: '/profile', label: 'Profile', icon: Icons.person_outline, selectedIcon: Icons.person),
        ];

      case UserRole.orgAdmin:
      case UserRole.superAdmin:
        return const [
          NavItemConfig(path: '/dashboard', label: 'Governance', icon: Icons.admin_panel_settings_outlined, selectedIcon: Icons.admin_panel_settings),
          NavItemConfig(path: '/inventory', label: 'Matrix', icon: Icons.inventory_2_outlined, selectedIcon: Icons.inventory_2),
          NavItemConfig(path: '/iot', label: 'Excursions', icon: Icons.notifications_active_outlined, selectedIcon: Icons.notifications_active),
          NavItemConfig(path: '/profile', label: 'Profile', icon: Icons.person_outline, selectedIcon: Icons.person),
        ];
    }
  }

  int _calculateIndex(String currentPath, List<NavItemConfig> items) {
    for (int i = 0; i < items.length; i++) {
      if (currentPath.startsWith(items[i].path)) {
        return i;
      }
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authNotifierProvider);
    final role = auth.user?.role ?? UserRole.operator;
    final navItems = _getNavItems(role);

    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = _calculateIndex(location, navItems);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex.clamp(0, navItems.length - 1),
        onDestinationSelected: (idx) {
          if (idx >= 0 && idx < navItems.length) {
            context.go(navItems[idx].path);
          }
        },
        backgroundColor: AppColors.pureWhite,
        elevation: 3,
        indicatorColor: AppColors.tealAccent.withValues(alpha: 0.15),
        destinations: navItems.map((item) {
          return NavigationDestination(
            icon: Icon(item.icon, color: AppColors.textSecondaryLight),
            selectedIcon: Icon(item.selectedIcon, color: AppColors.tealAccent),
            label: item.label,
          );
        }).toList(),
      ),
    );
  }
}
