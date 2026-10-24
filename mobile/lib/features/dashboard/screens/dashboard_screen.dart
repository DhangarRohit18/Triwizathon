import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/kpi_card.dart';
import '../../../core/widgets/offline_banner.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../../inventory/providers/inventory_provider.dart';
import '../../iot/providers/iot_provider.dart';
import '../../transfers/providers/transfers_provider.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final isOperator = user?.role == UserRole.warehouseOperator;
    final isDistributor = user?.role == UserRole.distributor;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.hub_outlined, size: 20, color: AppColors.tealAccent),
                const SizedBox(width: 8),
                Text(
                  'STOCKPILOT AI',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.1,
                      ),
                ),
              ],
            ),
            Text(
              user?.warehouseName ?? 'Central Warehouse (WH-CENTRAL-01)',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondaryDark,
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
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/iot'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(inventoryListProvider);
          ref.invalidate(expiringBatchesProvider);
          ref.invalidate(iotAlertsProvider);
          ref.invalidate(transfersListProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const OfflineBanner(),
              const SizedBox(height: 8),

              // Role Banner
              _buildRoleHeader(context, user),
              const SizedBox(height: 16),

              if (isOperator || isDistributor) ...[
                _buildOperatorSection(context, ref),
              ] else ...[
                _buildManagerSection(context, ref),
              ],
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/scan'),
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('SCAN BARCODE'),
        backgroundColor: AppColors.tealAccent,
        foregroundColor: AppColors.navyDark,
      ),
    );
  }

  Widget _buildRoleHeader(BuildContext context, UserModel? user) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderGraphite),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.tealAccent.withValues(alpha: 0.2),
                child: Text(
                  (user?.name.isNotEmpty == true) ? user!.name[0] : 'U',
                  style: const TextStyle(
                    color: AppColors.tealAccent,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    user?.name ?? 'Authorized Personnel',
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  Text(
                    user?.role.displayName ?? 'Warehouse Operator',
                    style: TextStyle(
                      color: AppColors.tealAccent.withValues(alpha: 0.9),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatusBadge.status(
            status: 'ONLINE',
            customColor: AppColors.successGreen,
          ),
        ],
      ),
    );
  }

  Widget _buildOperatorSection(BuildContext context, WidgetRef ref) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final alertsAsync = ref.watch(iotAlertsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Quick Actions Row
        const Text(
          'QUICK OPERATIONS',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.1,
            color: AppColors.textSecondaryDark,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Receive Stock',
                subtitle: 'Check-in & Putaway',
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
                color: AppColors.infoBlue,
                onTap: () => context.push('/tasks/dispatch'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Cycle Count',
                subtitle: 'Audit Bins',
                icon: Icons.checklist_rtl_outlined,
                color: AppColors.statusDraft,
                onTap: () => context.push('/tasks'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildActionTile(
                context,
                title: 'Report Damage',
                subtitle: 'Log Discrepancy',
                icon: Icons.report_problem_outlined,
                color: AppColors.errorRed,
                onTap: () => context.push('/tasks'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        // Floor Metrics
        const Text(
          'TODAY ON THE FLOOR',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.1,
            color: AppColors.textSecondaryDark,
          ),
        ),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            final lowStock = items.where((i) => i.isLowStock).length;
            return Row(
              children: [
                Expanded(
                  child: KpiCard(
                    title: 'UNITS IN BIN',
                    value: NumberFormat.decimalPattern().format(totalUnits),
                    icon: Icons.inventory_2_outlined,
                    accentColor: AppColors.tealAccent,
                    trendLabel: '${items.length} SKUs active',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: KpiCard(
                    title: 'LOW STOCK SKUs',
                    value: '$lowStock',
                    icon: Icons.warning_amber_rounded,
                    accentColor: lowStock > 0 ? AppColors.warningAmber : AppColors.successGreen,
                    trendLabel: lowStock > 0 ? 'Requires reorder' : 'All levels safe',
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Text('Error loading inventory: $err'),
        ),
        const SizedBox(height: 20),

        // Storage Condition Alerts
        alertsAsync.when(
          data: (alerts) {
            final activeAlerts = alerts.where((a) => !a.acknowledged).toList();
            if (activeAlerts.isEmpty) {
              return Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.successGreen.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.successGreen.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.check_circle_outline, color: AppColors.successGreen, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Cold chain parameters nominal (2.0°C - 8.0°C). No active excursions.',
                        style: TextStyle(fontSize: 12, color: AppColors.successGreen),
                      ),
                    ),
                  ],
                ),
              );
            }
            return Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.errorRed.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.warning_outlined, color: AppColors.errorRed, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        '${activeAlerts.length} ACTIVE STORAGE EXCURSION(S)',
                        style: const TextStyle(
                          color: AppColors.errorRed,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    activeAlerts.first.message,
                    style: const TextStyle(fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  InkWell(
                    onTap: () => context.push('/iot'),
                    child: const Text(
                      'View IoT Telemetry ->',
                      style: TextStyle(
                        color: AppColors.tealAccent,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
          loading: () => const SizedBox.shrink(),
          error: (_, __) => const SizedBox.shrink(),
        ),
      ],
    );
  }

  Widget _buildManagerSection(BuildContext context, WidgetRef ref) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final expiringBatchesAsync = ref.watch(expiringBatchesProvider);
    final pendingTransfersAsync = ref.watch(pendingTransfersProvider);
    final recommendationsAsync = ref.watch(recommendationsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Executive KPIs
        const Text(
          'NETWORK OVERVIEW',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.1,
            color: AppColors.textSecondaryDark,
          ),
        ),
        const SizedBox(height: 10),
        inventoryAsync.when(
          data: (items) {
            final totalUnits = items.fold<int>(0, (sum, i) => sum + i.quantityAvailable);
            final lowStockCount = items.where((i) => i.isLowStock).length;
            return Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: KpiCard(
                        title: 'AVAILABLE STOCK',
                        value: NumberFormat.compact().format(totalUnits),
                        icon: Icons.inventory_2_outlined,
                        accentColor: AppColors.tealAccent,
                        trendLabel: '${items.length} catalog items',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: KpiCard(
                        title: 'STOCKOUT RISK',
                        value: '$lowStockCount',
                        icon: Icons.error_outline,
                        accentColor: lowStockCount > 0 ? AppColors.warningAmber : AppColors.successGreen,
                        trendLabel: lowStockCount > 0 ? 'Urgent transfers req.' : 'Optimal buffers',
                      ),
                    ),
                  ],
                ),
              ],
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Text('Error: $err'),
        ),
        const SizedBox(height: 20),

        // Pending Transfer Approvals
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'PENDING TRANSFERS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.1,
                color: AppColors.textSecondaryDark,
              ),
            ),
            InkWell(
              onTap: () => context.push('/transfers'),
              child: const Text(
                'View All',
                style: TextStyle(color: AppColors.tealAccent, fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        pendingTransfersAsync.when(
          data: (transfers) {
            if (transfers.isEmpty) {
              return Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surfaceGraphite,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.borderGraphite),
                ),
                child: const Text(
                  'No pending transfer requests awaiting manager approval.',
                  style: TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                ),
              );
            }
            return Column(
              children: transfers.take(2).map((t) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceGraphite,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.borderGraphite),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppColors.infoBlue.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.swap_horiz, color: AppColors.infoBlue, size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t.transferNumber,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            ),
                            Text(
                              '${t.originWarehouseName} -> ${t.destinationWarehouseName}',
                              style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                            ),
                          ],
                        ),
                      ),
                      StatusBadge.status(status: t.status),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const CircularProgressIndicator(),
          error: (_, __) => const SizedBox.shrink(),
        ),
        const SizedBox(height: 20),

        // FEFO Alerts: Batches Expiring Soon
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'EXPIRING BATCHES (FEFO PRIORITY)',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.1,
                color: AppColors.textSecondaryDark,
              ),
            ),
            InkWell(
              onTap: () => context.push('/inventory'),
              child: const Text(
                'View Inventory',
                style: TextStyle(color: AppColors.tealAccent, fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        expiringBatchesAsync.when(
          data: (batches) {
            if (batches.isEmpty) {
              return Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surfaceGraphite,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.borderGraphite),
                ),
                child: const Text(
                  'No batches expiring in the next 30 days.',
                  style: TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                ),
              );
            }
            return Column(
              children: batches.take(3).map((b) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceGraphite,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.warningAmber.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            b.productName,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                          ),
                          Text(
                            'Batch #${b.batchNumber} • Qty: ${b.quantityRemaining}',
                            style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                          ),
                        ],
                      ),
                      StatusBadge.fefo(daysUntilExpiry: b.daysUntilExpiry),
                    ],
                  ),
                );
              }).toList(),
            );
          },
          loading: () => const CircularProgressIndicator(),
          error: (_, __) => const SizedBox.shrink(),
        ),
        const SizedBox(height: 20),

        // Distribution Optimization Engine Recommendations
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'OR-TOOLS ALLOCATION ENGINE',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.1,
                color: AppColors.textSecondaryDark,
              ),
            ),
            InkWell(
              onTap: () => context.push('/transfers'),
              child: const Text(
                'Full Plan',
                style: TextStyle(color: AppColors.tealAccent, fontSize: 12),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        recommendationsAsync.when(
          data: (recs) {
            if (recs.isEmpty) {
              return const SizedBox.shrink();
            }
            final top = recs.first;
            return Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppColors.surfaceGraphite,
                    AppColors.tealAccent.withValues(alpha: 0.08),
                  ],
                ),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.tealAccent.withValues(alpha: 0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        top.productName,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.tealAccent.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '${top.recommendedQuantity} units recommended',
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.tealAccent,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${top.sourceWarehouseName} -> ${top.destinationHospitalName}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Rationale: ${top.rationale}',
                    style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Est. Cost: \$${top.estimatedTransportCost.toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                      ),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.tealAccent,
                          foregroundColor: AppColors.navyDark,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                        onPressed: () => context.push('/transfers'),
                        child: const Text('REVIEW & APPROVE'),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
          loading: () => const SizedBox.shrink(),
          error: (_, __) => const SizedBox.shrink(),
        ),
      ],
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
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surfaceGraphite,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.borderGraphite),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: 10),
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
            ),
          ],
        ),
      ),
    );
  }
}
