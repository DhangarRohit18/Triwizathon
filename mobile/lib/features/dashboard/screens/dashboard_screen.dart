import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/kpi_card.dart';
import '../../../core/widgets/offline_banner.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/iot_model.dart';
import '../../../data/models/transfer_model.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../../inventory/providers/inventory_provider.dart';
import '../../iot/providers/iot_provider.dart';
import '../../tasks/providers/tasks_provider.dart';
import '../../transfers/providers/transfers_provider.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final role = user?.role ?? UserRole.operator;

    return Scaffold(
      backgroundColor: AppColors.pureWhite,
      appBar: AppBar(
        backgroundColor: AppColors.primaryNavy,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.hub_outlined, size: 18, color: AppColors.tealAccent),
                const SizedBox(width: 8),
                Text(
                  'STOCKPILOT AI',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.1,
                        color: Colors.white,
                      ),
                ),
              ],
            ),
            Text(
              user?.warehouseName ?? 'Enterprise Network',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_scanner, color: AppColors.tealAccent),
            tooltip: 'Quick Scan',
            onPressed: () => context.push('/scan'),
          ),
          if (user?.canAccessIot == true)
            IconButton(
              icon: const Icon(Icons.notifications_outlined, color: Colors.white),
              tooltip: 'Alerts',
              onPressed: () => context.push('/iot'),
            ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.tealAccent,
        onRefresh: () async {
          ref.invalidate(inventoryListProvider);
          ref.invalidate(batchesListProvider);
          ref.invalidate(expiringBatchesProvider);
          ref.invalidate(iotAlertsProvider);
          ref.invalidate(iotDevicesProvider);
          ref.invalidate(transfersListProvider);
          ref.invalidate(tasksListProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 14.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              OfflineBanner(
                pendingCount: ref.watch(pendingSyncCountProvider),
                onSyncNow: () async {
                  final synced = await ref.read(inventoryRepositoryProvider).syncPendingQueue();
                  ref.read(pendingSyncCountProvider.notifier).state =
                      ref.read(localStorageProvider).getPendingQueue().length;
                  ref.invalidate(inventoryListProvider);
                  ref.invalidate(batchesListProvider);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Synchronized $synced queued operations with backend.'),
                        backgroundColor: AppColors.tealAccent,
                      ),
                    );
                  }
                },
              ),
              const SizedBox(height: 6),

              // Role Identity Banner
              _buildRoleBanner(context, user),
              const SizedBox(height: 16),

              // 6 Distinct Role Experiences
              if (role == UserRole.superAdmin)
                _buildSuperAdminDashboard(context, ref, user)
              else if (role == UserRole.orgAdmin)
                _buildOrgAdminDashboard(context, ref, user)
              else if (role == UserRole.supplyChainManager)
                _buildSupplyChainDashboard(context, ref, user)
              else if (role == UserRole.warehouseManager)
                _buildWarehouseManagerDashboard(context, ref, user)
              else if (role == UserRole.distributor)
                _buildDistributorDashboard(context, ref, user)
              else
                _buildOperatorDashboard(context, ref, user),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/scan'),
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('SCAN BARCODE'),
        backgroundColor: AppColors.tealAccent,
        foregroundColor: Colors.white,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Role Header Banner
  // ---------------------------------------------------------------------------
  Widget _buildRoleBanner(BuildContext context, UserModel? user) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceLight,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.primaryNavy,
                child: Text(
                  (user != null && user.name.isNotEmpty) ? user.name[0].toUpperCase() : 'U',
                  style: const TextStyle(
                    color: AppColors.tealAccent,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    user?.name ?? 'Authorized Personnel',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
                  ),
                  Text(
                    user?.role.displayName ?? 'Warehouse Operator',
                    style: const TextStyle(
                      color: AppColors.tealAccent,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatusBadge.status(
            status: 'AUTHENTICATED',
            customColor: AppColors.successGreen,
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // 1. SUPER ADMIN DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildSuperAdminDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final devicesAsync = ref.watch(iotDevicesProvider);
    final alertsAsync = ref.watch(iotAlertsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader('PLATFORM & CLUSTER HEALTH'),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'NETWORK STOCK',
                    value: NumberFormat.compact().format(totalUnits),
                    icon: Icons.inventory_2_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: '${items.length} SKUs across all nodes',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: devicesAsync.when(
                    data: (devs) {
                      final onlineCount = devs.where((d) => d.isOnline).length;
                      return KpiCard(
                        title: 'IOT TELEMETRY',
                        value: '$onlineCount / ${devs.length} Active',
                        icon: Icons.sensors,
                        accentColor: devs.isNotEmpty ? AppColors.successGreen : AppColors.textSecondaryLight,
                        trendLabel: 'Cold-chain telemetry live',
                      );
                    },
                    loading: () => KpiCard(
                      title: 'IOT TELEMETRY',
                      value: 'Checking...',
                      icon: Icons.sensors,
                      accentColor: AppColors.textSecondaryLight,
                    ),
                    error: (_, __) => KpiCard(
                      title: 'IOT TELEMETRY',
                      value: 'Offline',
                      icon: Icons.sensors_off,
                      accentColor: AppColors.errorRed,
                    ),
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load network stock metrics: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('TENANT FACILITIES CLUSTER'),
        const SizedBox(height: 8),
        inventoryAsync.when(
          data: (items) {
            final Map<String, int> warehouseStock = {};
            final Map<String, String> warehouseNames = {};
            for (final i in items) {
              if (i.warehouseId.isNotEmpty) {
                warehouseStock[i.warehouseId] = (warehouseStock[i.warehouseId] ?? 0) + i.quantityAvailable;
                warehouseNames[i.warehouseId] = i.warehouseName.isNotEmpty ? i.warehouseName : 'Facility (${i.warehouseId})';
              }
            }

            if (warehouseStock.isEmpty) {
              return Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.warehouse_outlined, color: AppColors.textSecondaryLight, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'No facility clusters provisioned. Facilities will appear as inventories are registered.',
                        style: TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
                      ),
                    ),
                  ],
                ),
              );
            }

            final nodes = warehouseStock.keys.map((whId) {
              return {
                'id': whId,
                'name': warehouseNames[whId] ?? whId,
                'type': 'Cold Storage & Distribution',
              };
            }).toList();

            return Column(
              children: nodes.map((node) {
                final qty = warehouseStock[node['id']] ?? 0;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(node['name']!, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                          Text('${node['type']} • (${node['id']})', style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight)),
                        ],
                      ),
                      Text(
                        '${NumberFormat.decimalPattern().format(qty)} units',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppColors.tealAccent),
                      ),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load facility clusters: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('CRITICAL EXCURSION ALERTS'),
        const SizedBox(height: 8),
        alertsAsync.when(
          data: (alerts) => _buildAlertsSnippet(context, alerts),
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load alerts: $e'),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // 2. ORGANIZATION ADMIN DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildOrgAdminDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final transfersAsync = ref.watch(pendingTransfersProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader('ORGANIZATION GOVERNANCE & METRICS'),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            final lowStockCount = items.where((i) => i.isLowStock).length;
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'TOTAL STOCK UNITS',
                    value: NumberFormat.compact().format(totalUnits),
                    icon: Icons.inventory_2_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: '${items.length} SKUs in inventory',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: KpiCard(
                    title: 'LOW STOCK RISKS',
                    value: '$lowStockCount SKUs',
                    icon: Icons.warning_amber_rounded,
                    accentColor: lowStockCount > 0 ? AppColors.warningAmber : AppColors.successGreen,
                    trendLabel: lowStockCount > 0 ? 'Requires attention' : 'Inventory balanced',
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load organization inventory: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('PENDING OPERATIONAL REVIEWS'),
        const SizedBox(height: 8),
        transfersAsync.when(
          data: (transfers) => _buildTransfersSnippet(context, transfers),
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load pending transfers: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('AUTHORIZED ADMINISTRATION SHORTCUTS'),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Stock Matrix',
                subtitle: 'Facility Inventory',
                icon: Icons.inventory_2_outlined,
                color: AppColors.tealAccent,
                onTap: () => context.push('/inventory'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Review Transfers',
                subtitle: 'Pending Approvals',
                icon: Icons.rule_outlined,
                color: AppColors.primaryNavy,
                onTap: () => context.push('/transfers'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // 3. SUPPLY CHAIN MANAGER DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildSupplyChainDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final pendingTransfersAsync = ref.watch(pendingTransfersProvider);
    final recommendationsAsync = ref.watch(recommendationsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader('NETWORK IMBALANCE & RISK MONITOR'),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            final lowStock = items.where((i) => i.isLowStock).length;
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'ACTIVE STOCK',
                    value: NumberFormat.compact().format(totalUnits),
                    icon: Icons.inventory_2_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: 'Cross-warehouse total',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: KpiCard(
                    title: 'LOW STOCK RISKS',
                    value: '$lowStock SKUs',
                    icon: Icons.warning_amber_rounded,
                    accentColor: lowStock > 0 ? AppColors.warningAmber : AppColors.successGreen,
                    trendLabel: lowStock > 0 ? 'Requires rebalance' : 'Buffers safe',
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load network stock: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('OR-TOOLS SCIP MIP OPTIMIZATION'),
        const SizedBox(height: 8),
        recommendationsAsync.when(
          data: (recs) {
            if (recs.isEmpty) {
              return Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.check_circle_outline, color: AppColors.successGreen, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'All network hubs balanced. No proactive inter-warehouse rebalances needed.',
                        style: TextStyle(fontSize: 12, color: AppColors.primaryNavy),
                      ),
                    ),
                  ],
                ),
              );
            }

            return Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Mixed-Integer Program Plan',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
                      ),
                      StatusBadge.status(status: 'SOLVED OPTIMAL', customColor: AppColors.successGreen),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${recs.length} routing recommendations generated. Balances transport costs vs stockout probability.',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
                  ),
                  const SizedBox(height: 10),
                  ElevatedButton(
                    onPressed: () => context.push('/transfers'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryNavy,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                    ),
                    child: const Text('Review Allocation Plans', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (_, __) => const SizedBox.shrink(),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('TRANSFERS AWAITING SCM APPROVAL'),
        const SizedBox(height: 8),
        pendingTransfersAsync.when(
          data: (transfers) => _buildTransfersSnippet(context, transfers),
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load transfers: $e'),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // 4. WAREHOUSE MANAGER DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildWarehouseManagerDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final expiringBatchesAsync = ref.watch(expiringBatchesProvider);
    final pendingTransfersAsync = ref.watch(pendingTransfersProvider);
    final devicesAsync = ref.watch(iotDevicesProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader('ASSIGNED FACILITY DOCK OVERVIEW'),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'FACILITY INVENTORY',
                    value: NumberFormat.decimalPattern().format(totalUnits),
                    icon: Icons.warehouse_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: '${items.length} SKUs in bay',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: devicesAsync.when(
                    data: (devs) {
                      final matching = devs.where((d) => d.warehouseId == user?.warehouseId).toList();
                      if (matching.isEmpty) {
                        return const KpiCard(
                          title: 'BAY STORAGE TEMP',
                          value: 'N/A',
                          icon: Icons.sensors_off_outlined,
                          accentColor: AppColors.textSecondaryLight,
                          trendLabel: 'No sensor provisioned in bay',
                        );
                      }
                      final whDev = matching.first;
                      return KpiCard(
                        title: 'BAY STORAGE TEMP',
                        value: '${whDev.currentTemp.toStringAsFixed(1)}°C',
                        icon: Icons.thermostat_outlined,
                        accentColor: whDev.isBreached ? AppColors.errorRed : AppColors.successGreen,
                        trendLabel: '${whDev.tempMinThreshold}°C - ${whDev.tempMaxThreshold}°C target',
                      );
                    },
                    loading: () => KpiCard(
                      title: 'BAY STORAGE TEMP',
                      value: 'Reading...',
                      icon: Icons.thermostat_outlined,
                      accentColor: AppColors.tealAccent,
                    ),
                    error: (_, __) => KpiCard(
                      title: 'BAY STORAGE TEMP',
                      value: 'Offline',
                      icon: Icons.thermostat_outlined,
                      accentColor: AppColors.errorRed,
                    ),
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load facility stock: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('FEFO LOT EXPIRATION RISKS (<= 60 DAYS)'),
        const SizedBox(height: 8),
        expiringBatchesAsync.when(
          data: (batches) {
            if (batches.isEmpty) {
              return _buildInfoCard(
                icon: Icons.check_circle_outline,
                title: 'No Lots Approaching Expiry',
                subtitle: 'All batch inventories have > 60 days remaining shelf-life.',
                color: AppColors.successGreen,
              );
            }
            return Column(
              children: batches.take(3).map((b) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.warningAmber.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(b.batchNumber, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                          Text('${b.productName} • ${b.quantity} units', style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight)),
                        ],
                      ),
                      StatusBadge.status(status: '${b.daysUntilExpiry}d LEFT', customColor: AppColors.warningAmber),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load expiring batches: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('FACILITY TRANSFERS & DISPATCHES'),
        const SizedBox(height: 8),
        pendingTransfersAsync.when(
          data: (transfers) => _buildTransfersSnippet(context, transfers),
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load transfers: $e'),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // 5. DISTRIBUTOR / FLEET OPERATOR DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildDistributorDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final transfersAsync = ref.watch(transfersListProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader('DELIVERY MANIFEST & FLEET OVERVIEW'),
        const SizedBox(height: 10),
        transfersAsync.when(
          data: (transfers) {
            final activeShipments = transfers.where((t) => t.status != 'REJECTED').toList();
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'ASSIGNED DROPS',
                    value: '${activeShipments.length} Runs',
                    icon: Icons.local_shipping_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: 'Fleet transit active',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: KpiCard(
                    title: 'DELIVERY UNITS',
                    value: NumberFormat.compact().format(activeShipments.fold<int>(0, (sum, t) => sum + t.quantity)),
                    icon: Icons.inventory_2_outlined,
                    accentColor: AppColors.primaryNavy,
                    trendLabel: 'Tamper seals certified',
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load fleet delivery manifest: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('ACTIVE ROUTE RUNS & TRANSFERS'),
        const SizedBox(height: 8),
        transfersAsync.when(
          data: (transfers) {
            if (transfers.isEmpty) {
              return _buildInfoCard(
                icon: Icons.local_shipping_outlined,
                title: 'No Active Delivery Drops',
                subtitle: 'No outbound shipments currently assigned to your route manifest.',
                color: AppColors.tealAccent,
              );
            }
            return Column(
              children: transfers.take(3).map((t) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Drop #${t.transferNumber}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                          Text('${t.productName} • ${t.quantity} units -> ${t.destinationWarehouseId}', style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight)),
                        ],
                      ),
                      StatusBadge.status(status: t.status),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load route runs: $e'),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('PERMITTED CATALOG AVAILABILITY'),
        const SizedBox(height: 8),
        inventoryAsync.when(
          data: (items) {
            return Column(
              children: items.take(4).map((i) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(i.productSku, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                          Text(i.productName, style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight)),
                        ],
                      ),
                      Text(
                        '${i.quantityAvailable} ${i.unit}',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.tealAccent),
                      ),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load product availability: $e'),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // 6. WAREHOUSE OPERATOR DASHBOARD
  // ---------------------------------------------------------------------------
  Widget _buildOperatorDashboard(BuildContext context, WidgetRef ref, UserModel? user) {
    final tasksAsync = ref.watch(tasksListProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Hero Scan Card
        GestureDetector(
          onTap: () => context.push('/scan'),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.primaryNavy,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryNavy.withValues(alpha: 0.15),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.tealAccent,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.qr_code_scanner, color: Colors.white, size: 28),
                ),
                const SizedBox(width: 16),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'START SCAN & WAVE PICK',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15, letterSpacing: 0.5),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Scan inbound lots or pick orders via camera',
                        style: TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_ios, color: AppColors.tealAccent, size: 16),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('QUICK WAREHOUSE ACTIONS'),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Receive Stock',
                subtitle: 'Inbound Putaway',
                icon: Icons.move_to_inbox_outlined,
                color: AppColors.tealAccent,
                onTap: () => context.push('/tasks/receive'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Dispatch Stock',
                subtitle: 'Pick & Outbound',
                icon: Icons.outbox_outlined,
                color: AppColors.primaryNavy,
                onTap: () => context.push('/tasks/dispatch'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),

        _buildSectionHeader('ASSIGNED FLOOR TASKS (LIVE BACKEND)'),
        const SizedBox(height: 8),
        tasksAsync.when(
          data: (tasks) {
            final pending = tasks.where((t) => !t.isCompleted).toList();
            if (pending.isEmpty) {
              return _buildInfoCard(
                icon: Icons.check_circle_outline,
                title: 'All Assigned Tasks Completed',
                subtitle: 'No pending pick, putaway, or cycle count tasks for your assigned bay.',
                color: AppColors.successGreen,
              );
            }
            return Column(
              children: pending.take(3).map((t) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                            const SizedBox(height: 2),
                            Text(
                              'Location: ${t.targetLocation} • ${t.requiredQuantity} units',
                              style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      StatusBadge.status(status: t.priority.toUpperCase()),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => _buildErrorCard('Failed to load floor tasks: $e'),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Helper UI Components
  // ---------------------------------------------------------------------------
  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.bold,
        letterSpacing: 1.0,
        color: AppColors.textSecondaryLight,
      ),
    );
  }

  Widget _buildActionTile(
    BuildContext context, {
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surfaceLight,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 24, color: color),
            const SizedBox(height: 8),
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceLight,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        children: [
          Icon(icon, size: 22, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
                ),
                Text(
                  subtitle,
                  style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorCard(String errorMsg) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, size: 18, color: AppColors.errorRed),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              errorMsg,
              style: const TextStyle(color: AppColors.errorRed, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAlertsSnippet(BuildContext context, List<IoTAlertModel> alerts) {
    if (alerts.isEmpty) {
      return _buildInfoCard(
        icon: Icons.check_circle_outline,
        title: 'Cold-Chain Nominal',
        subtitle: 'All telemetry loggers operating within safe thresholds.',
        color: AppColors.successGreen,
      );
    }
    return Column(
      children: alerts.take(3).map((a) {
        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceLight,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.4)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.message, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppColors.primaryNavy)),
                    Text('Device ${a.deviceId} • ${a.timestamp.split("T").first}', style: const TextStyle(fontSize: 10, color: AppColors.textSecondaryLight)),
                  ],
                ),
              ),
              StatusBadge.severity(severity: a.severity),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildTransfersSnippet(BuildContext context, List<TransferModel> transfers) {
    if (transfers.isEmpty) {
      return _buildInfoCard(
        icon: Icons.check_circle_outline,
        title: 'No Pending Transfers',
        subtitle: 'All inter-facility movements have been reviewed.',
        color: AppColors.successGreen,
      );
    }
    return Column(
      children: transfers.take(3).map((t) {
        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surfaceLight,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Transfer #${t.transferNumber}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy)),
                  Text('${t.productName} • ${t.quantity} units', style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight)),
                ],
              ),
              StatusBadge.status(status: t.status),
            ],
          ),
        );
      }).toList(),
    );
  }
}
