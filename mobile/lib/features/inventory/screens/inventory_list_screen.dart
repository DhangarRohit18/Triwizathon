import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/batch_model.dart';
import '../../../data/models/inventory_model.dart';
import '../providers/inventory_provider.dart';

class InventoryListScreen extends ConsumerStatefulWidget {
  const InventoryListScreen({super.key});

  @override
  ConsumerState<InventoryListScreen> createState() => _InventoryListScreenState();
}

class _InventoryListScreenState extends ConsumerState<InventoryListScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final batchesAsync = ref.watch(batchesListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory & Batches'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(100),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
                child: TextField(
                  controller: _searchController,
                  onChanged: (val) => setState(() => _searchQuery = val.trim().toLowerCase()),
                  decoration: InputDecoration(
                    hintText: 'Search SKU, product name, batch #...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _searchQuery = '');
                            },
                          )
                        : null,
                    filled: true,
                    fillColor: AppColors.surfaceGraphite,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: AppColors.borderGraphite),
                    ),
                  ),
                ),
              ),
              TabBar(
                controller: _tabController,
                indicatorColor: AppColors.tealAccent,
                labelColor: AppColors.tealAccent,
                unselectedLabelColor: AppColors.textSecondaryDark,
                tabs: const [
                  Tab(text: 'Stock by SKU'),
                  Tab(text: 'Batches (FEFO)'),
                ],
              ),
            ],
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Tab 1: Products
          inventoryAsync.when(
            data: (items) {
              final filtered = items.where((i) {
                if (_searchQuery.isEmpty) return true;
                return i.productName.toLowerCase().contains(_searchQuery) ||
                    i.sku.toLowerCase().contains(_searchQuery) ||
                    i.category.toLowerCase().contains(_searchQuery);
              }).toList();

              if (filtered.isEmpty) {
                return const EmptyState(
                  title: 'No inventory items match',
                  subtitle: 'Try adjusting your search query or check warehouse filter.',
                  icon: Icons.inventory_2_outlined,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(inventoryListProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final item = filtered[index];
                    return _buildProductCard(context, item);
                  },
                ),
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(child: Text('Error: $err')),
          ),

          // Tab 2: Batches
          batchesAsync.when(
            data: (batches) {
              final filtered = batches.where((b) {
                if (_searchQuery.isEmpty) return true;
                return b.productName.toLowerCase().contains(_searchQuery) ||
                    b.batchNumber.toLowerCase().contains(_searchQuery);
              }).toList();

              if (filtered.isEmpty) {
                return const EmptyState(
                  title: 'No batches found',
                  subtitle: 'No batches match your query.',
                  icon: Icons.qr_code_2_outlined,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(batchesListProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final batch = filtered[index];
                    return _buildBatchCard(context, batch);
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

  Widget _buildProductCard(BuildContext context, InventoryItemModel item) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: item.isLowStock
              ? AppColors.warningAmber.withValues(alpha: 0.6)
              : AppColors.borderGraphite,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.productName,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'SKU: ${item.sku} • ${item.category}',
                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                    ),
                  ],
                ),
              ),
              StatusBadge.storage(type: item.storageType),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'AVAILABLE',
                    style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
                  ),
                  Text(
                    NumberFormat.decimalPattern().format(item.quantityAvailable),
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: item.isLowStock ? AppColors.warningAmber : AppColors.tealAccent,
                    ),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'SAFETY STOCK',
                    style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
                  ),
                  Text(
                    '${item.safetyStock}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'REORDER PT',
                    style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
                  ),
                  Text(
                    '${item.reorderPoint}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.qr_code, size: 20, color: AppColors.tealAccent),
                tooltip: 'Show QR Code',
                onPressed: () => _showProductQrModal(context, item),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBatchCard(BuildContext context, InventoryBatchModel batch) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: batch.isExpiringSoon
              ? AppColors.warningAmber.withValues(alpha: 0.5)
              : AppColors.borderGraphite,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      batch.productName,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Batch #${batch.batchNumber}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: AppColors.tealAccent,
                      ),
                    ),
                  ],
                ),
              ),
              StatusBadge.fefo(daysUntilExpiry: batch.daysUntilExpiry),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Expiry: ${batch.expiryDate.split("T").first}',
                    style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                  ),
                  Text(
                    'Remaining: ${batch.quantityRemaining} units',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.qr_code_2, size: 22, color: AppColors.tealAccent),
                tooltip: 'Show Batch QR Code',
                onPressed: () => _showBatchQrModal(context, batch),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showBatchQrModal(BuildContext context, InventoryBatchModel batch) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surfaceGraphite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        final qrPayload = 'STOCKPILOT://BATCH/${batch.batchNumber}/WH/${batch.warehouseId}';
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                batch.productName,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 4),
              Text(
                'Batch #${batch.batchNumber} • Expiry: ${batch.expiryDate.split("T").first}',
                style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: QrImageView(
                  data: qrPayload,
                  version: QrVersions.auto,
                  size: 180.0,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Scannable Batch URI: $qrPayload',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showProductQrModal(BuildContext context, InventoryItemModel item) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surfaceGraphite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        final qrPayload = 'PROD:${item.sku}';
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                item.productName,
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 4),
              Text(
                'SKU: ${item.sku}',
                style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: QrImageView(
                  data: qrPayload,
                  version: QrVersions.auto,
                  size: 180.0,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Scan to verify in warehouse: $qrPayload',
                style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
              ),
            ],
          ),
        );
      },
    );
  }
}
