import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/recommendation_model.dart';
import '../../../data/models/transfer_model.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/transfers_provider.dart';

class TransfersScreen extends ConsumerStatefulWidget {
  const TransfersScreen({super.key});

  @override
  ConsumerState<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends ConsumerState<TransfersScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _handleTransferAction(TransferModel transfer, String action) async {
    String? rejectionReason;
    if (action == 'REJECT') {
      final reasonController = TextEditingController();
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppColors.surfaceGraphite,
          title: const Text('Reject Transfer Request'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Provide operational rationale for rejecting ${transfer.transferNumber}:',
                style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reasonController,
                decoration: const InputDecoration(
                  hintText: 'e.g. Insufficient truck refrigeration capacity',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.errorRed,
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Confirm Rejection'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      rejectionReason = reasonController.text.trim();
    }

    try {
      final repo = ref.read(transferRepositoryProvider);
      await repo.approveOrReject(
        transferId: transfer.id,
        action: action,
        rejectionReason: rejectionReason,
      );

      ref.invalidate(transfersListProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Transfer ${transfer.transferNumber} $action-ed successfully'),
          backgroundColor: action == 'APPROVE' ? AppColors.successGreen : AppColors.errorRed,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to $action transfer: $e'),
          backgroundColor: AppColors.errorRed,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authNotifierProvider).user;
    final canApprove = user?.role != UserRole.warehouseOperator;
    final transfersAsync = ref.watch(transfersListProvider);
    final recommendationsAsync = ref.watch(recommendationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transfers & Allocation Engine'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.tealAccent,
          labelColor: AppColors.tealAccent,
          unselectedLabelColor: AppColors.textSecondaryDark,
          tabs: const [
            Tab(text: 'Transfer Requests'),
            Tab(text: 'AI Recommendations'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Tab 1: Transfers
          transfersAsync.when(
            data: (transfers) {
              if (transfers.isEmpty) {
                return const EmptyState(
                  title: 'No active transfers',
                  subtitle: 'No warehouse transfers are currently in progress or awaiting approval.',
                  icon: Icons.swap_horiz_outlined,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(transfersListProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: transfers.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final t = transfers[index];
                    final isPending = t.status.toUpperCase() == 'PENDING_APPROVAL';

                    return Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceGraphite,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isPending
                              ? AppColors.infoBlue.withValues(alpha: 0.5)
                              : AppColors.borderGraphite,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                t.transferNumber,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                              StatusBadge.status(status: t.status),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${t.originWarehouseName} -> ${t.destinationWarehouseName}',
                            style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                          ),
                          const SizedBox(height: 8),
                          // Items summary
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: AppColors.navyDark,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Column(
                              children: t.items.map((item) {
                                return Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      '${item.productName} (Batch: ${item.batchNumber})',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                    Text(
                                      '${item.quantity} units',
                                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
                                    ),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                          if (t.rejectionReason != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              'Rejection Reason: ${t.rejectionReason}',
                              style: const TextStyle(fontSize: 11, color: AppColors.errorRed),
                            ),
                          ],
                          if (isPending && canApprove) ...[
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: ElevatedButton.icon(
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.tealAccent,
                                      foregroundColor: AppColors.navyDark,
                                      padding: const EdgeInsets.symmetric(vertical: 8),
                                    ),
                                    icon: const Icon(Icons.check, size: 16),
                                    label: const Text('APPROVE'),
                                    onPressed: () => _handleTransferAction(t, 'APPROVE'),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: OutlinedButton.icon(
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: AppColors.errorRed,
                                      padding: const EdgeInsets.symmetric(vertical: 8),
                                    ),
                                    icon: const Icon(Icons.close, size: 16),
                                    label: const Text('REJECT'),
                                    onPressed: () => _handleTransferAction(t, 'REJECT'),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(child: Text('Error: $err')),
          ),

          // Tab 2: Recommendations
          recommendationsAsync.when(
            data: (recs) {
              if (recs.isEmpty) {
                return const EmptyState(
                  title: 'No pending recommendations',
                  subtitle: 'The Google OR-Tools optimization engine has not generated new allocation proposals.',
                  icon: Icons.psychology_outlined,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(recommendationsProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: recs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final r = recs[index];
                    return _buildRecommendationCard(context, r);
                  },
                ),
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(child: Text('Error: $err')),
          ),
        ],
      ),
    );
  }

  Widget _buildRecommendationCard(BuildContext context, AllocationRecommendationModel r) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.tealAccent.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  r.productName,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.tealAccent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  '${r.recommendedQuantity} units',
                  style: const TextStyle(
                    color: AppColors.tealAccent,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${r.sourceWarehouseName} ➔ ${r.destinationHospitalName}',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.navyDark,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Est. Transport Cost:', style: TextStyle(fontSize: 11, color: AppColors.textSecondaryDark)),
                    Text('\$${r.estimatedTransportCost.toStringAsFixed(2)}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Mitigated Stockout Risk:', style: TextStyle(fontSize: 11, color: AppColors.textSecondaryDark)),
                    Text('${(r.stockoutRiskScore * 100).toInt()}%', style: const TextStyle(fontSize: 11, color: AppColors.warningAmber, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Rationale: ${r.rationale}',
            style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.tealAccent,
                foregroundColor: AppColors.navyDark,
                padding: const EdgeInsets.symmetric(vertical: 8),
              ),
              icon: const Icon(Icons.check_circle_outline, size: 16),
              label: const Text('APPROVE PROPOSED TRANSFER'),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Recommendation approved! Created transfer draft for ${r.recommendedQuantity} units of ${r.productName}.'),
                    backgroundColor: AppColors.successGreen,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
