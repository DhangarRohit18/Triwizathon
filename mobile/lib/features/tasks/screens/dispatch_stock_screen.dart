import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/models/inventory_model.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../../inventory/providers/inventory_provider.dart';

class DispatchStockScreen extends ConsumerStatefulWidget {
  const DispatchStockScreen({super.key});

  @override
  ConsumerState<DispatchStockScreen> createState() => _DispatchStockScreenState();
}

class _DispatchStockScreenState extends ConsumerState<DispatchStockScreen> {
  final _formKey = GlobalKey<FormState>();

  String? _selectedProductId;
  String? _selectedWarehouseId;
  String? _selectedBatchNumber;
  String _selectedDestination = 'dest_boston_01';
  final _quantityController = TextEditingController(text: '100');

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _quantityController.dispose();
    super.dispose();
  }

  Future<void> _submitDispatch() async {
    if (!_formKey.currentState!.validate()) return;

    final user = ref.read(authNotifierProvider).user;
    final warehouseId = _selectedWarehouseId ?? user?.warehouseId ?? 'wh_chicago_01';
    final productId = _selectedProductId ?? 'prd_vax_01';
    final batch = _selectedBatchNumber;
    final qty = int.tryParse(_quantityController.text) ?? 0;
    final idempotencyKey = const Uuid().v4();

    // Confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.pureWhite,
        title: const Text(
          'Confirm Stock Outbound Dispatch',
          style: TextStyle(color: AppColors.primaryNavy, fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review outbound inventory reduction:',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
            ),
            const SizedBox(height: 12),
            _buildRow('Product ID', productId),
            _buildRow('Warehouse', warehouseId),
            _buildRow('Batch (FEFO)', batch ?? 'Auto-FEFO Allocation'),
            _buildRow('Destination', _selectedDestination),
            _buildRow('Deduction', '-$qty units'),
            _buildRow('Idempotency Key', '${idempotencyKey.substring(0, 8)}...'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textSecondaryLight)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.tealAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm Dispatch'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final repo = ref.read(inventoryRepositoryProvider);
      final result = await repo.dispatchStock(
        productId: productId,
        warehouseId: warehouseId,
        batchNumber: batch ?? '',
        destinationHospitalId: _selectedDestination,
        quantity: qty,
        idempotencyKey: idempotencyKey,
      );

      ref.invalidate(inventoryListProvider);
      ref.invalidate(batchesListProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.isOfflineDraft
                ? 'Dispatch queued as offline draft. Will sync when reconnected.'
                : 'Successfully dispatched $qty units to $_selectedDestination',
          ),
          backgroundColor: result.isOfflineDraft ? AppColors.warningAmber : AppColors.successGreen,
        ),
      );
      context.pop();
    } catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  Widget _buildRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryLight)),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primaryNavy)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final batchesAsync = ref.watch(batchesListProvider);
    final user = ref.watch(authNotifierProvider).user;
    final isRestrictedWarehouse = user?.role == UserRole.operator || user?.role == UserRole.warehouseManager;
    final assignedWh = user?.warehouseId ?? 'wh_chicago_01';

    return Scaffold(
      backgroundColor: AppColors.pureWhite,
      appBar: AppBar(
        title: const Text('Dispatch Goods (Outbound)'),
        backgroundColor: AppColors.primaryNavy,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.tealAccent.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.shield_outlined, color: AppColors.tealAccent, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Outbound dispatches enforce FEFO (First-Expired, First-Out) priority to prevent stock expiry losses.',
                        style: TextStyle(fontSize: 12, color: AppColors.primaryNavy),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              if (_errorMessage != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
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
                          _errorMessage!,
                          style: const TextStyle(color: AppColors.errorRed, fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),

              // Dispatching Facility
              const Text(
                'DISPATCHING FACILITY',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              if (isRestrictedWarehouse)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.lock_outline, size: 16, color: AppColors.textSecondaryLight),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          user?.warehouseName ?? 'Assigned Hub ($assignedWh)',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
                        ),
                      ),
                      Text(
                        assignedWh,
                        style: const TextStyle(fontSize: 11, fontFamily: 'monospace', color: AppColors.tealAccent, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                )
              else
                DropdownButtonFormField<String>(
                  initialValue: _selectedWarehouseId ?? assignedWh,
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(value: 'wh_chicago_01', child: Text('Central Hub Chicago (wh_chicago_01)')),
                    DropdownMenuItem(value: 'wh_ny_02', child: Text('New York BioLogistics (wh_ny_02)')),
                    DropdownMenuItem(value: 'wh_dallas_02', child: Text('Dallas Cold Storage (wh_dallas_02)')),
                    DropdownMenuItem(value: 'wh_boston_01', child: Text('Boston Distribution Hub (wh_boston_01)')),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _selectedWarehouseId = val);
                  },
                ),
              const SizedBox(height: 16),

              // Product
              const Text(
                'PRODUCT TO DISPATCH',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              inventoryAsync.when(
                data: (items) {
                  final activeItems = items.isNotEmpty
                      ? items
                      : [
                          InventoryItemModel(
                            id: 'prd_vax_01',
                            productId: 'prd_vax_01',
                            productName: 'PneuVax mRNA-1273',
                            productSku: 'PRD-VAX-01',
                            handling: 'COLD_CHAIN',
                            unit: 'vials',
                            warehouseId: assignedWh,
                            warehouseName: 'Central Hub',
                            totalQuantity: 1000,
                            availableQuantity: 850,
                            reservedQuantity: 150,
                            damagedQuantity: 0,
                            safetyStock: 100,
                            reorderPoint: 200,
                          ),
                        ];

                  final currentVal = _selectedProductId ?? activeItems.first.productId;

                  return DropdownButtonFormField<String>(
                    initialValue: activeItems.any((i) => i.productId == currentVal) ? currentVal : activeItems.first.productId,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: activeItems.map((i) {
                      return DropdownMenuItem(
                        value: i.productId,
                        child: Text('${i.productName} (${i.quantityAvailable} avail)', overflow: TextOverflow.ellipsis),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        setState(() {
                          _selectedProductId = val;
                          _selectedBatchNumber = null;
                        });
                      }
                    },
                  );
                },
                loading: () => const LinearProgressIndicator(color: AppColors.tealAccent),
                error: (_, __) => DropdownButtonFormField<String>(
                  initialValue: _selectedProductId ?? 'prd_vax_01',
                  items: const [
                    DropdownMenuItem(value: 'prd_vax_01', child: Text('PneuVax mRNA-1273 (850 avail)')),
                    DropdownMenuItem(value: 'prd_ins_02', child: Text('Insulin Glargine (1,200 avail)')),
                    DropdownMenuItem(value: 'prd_adr_03', child: Text('Adrenaline Auto-Injector (400 avail)')),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _selectedProductId = val);
                  },
                ),
              ),
              const SizedBox(height: 16),

              // Batch Selection (FEFO sorted)
              const Text(
                'BATCH SELECTION (FEFO ORDERED)',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              batchesAsync.when(
                data: (batches) {
                  final prodId = _selectedProductId ?? 'prd_vax_01';
                  final matching = batches.where((b) => b.productId == prodId).toList();
                  final displayBatches = matching.isNotEmpty ? matching : batches;

                  if (displayBatches.isEmpty) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceLight,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.borderLight),
                      ),
                      child: const Text(
                        'Automatic FEFO deduction (Earliest Expiry Batch)',
                        style: TextStyle(fontSize: 13, color: AppColors.textSecondaryLight),
                      ),
                    );
                  }

                  return DropdownButtonFormField<String>(
                    initialValue: displayBatches.any((b) => b.batchNumber == _selectedBatchNumber)
                        ? _selectedBatchNumber
                        : displayBatches.first.batchNumber,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: displayBatches.map((b) {
                      return DropdownMenuItem(
                        value: b.batchNumber,
                        child: Text(
                          '#${b.batchNumber} • ${b.quantityRemaining} units • exp: ${b.expiryDate.split("T").first}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedBatchNumber = val);
                    },
                  );
                },
                loading: () => const LinearProgressIndicator(color: AppColors.tealAccent),
                error: (_, __) => Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: const Text('Automatic FEFO batch allocation enabled'),
                ),
              ),
              const SizedBox(height: 16),

              // Destination Facility
              const Text(
                'DESTINATION LOGISTICS FACILITY',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                initialValue: _selectedDestination,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'dest_boston_01', child: Text('Boston Dark Store (dest_boston_01)')),
                  DropdownMenuItem(value: 'dest_metro_hosp', child: Text('Metro General Hospital Cold Vault')),
                  DropdownMenuItem(value: 'dest_chicago_clinic', child: Text('Chicago Community Health Center')),
                  DropdownMenuItem(value: 'wh_ny_02', child: Text('New York BioLogistics Hub (wh_ny_02)')),
                ],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedDestination = val);
                },
              ),
              const SizedBox(height: 16),

              // Quantity
              const Text(
                'DISPATCH QUANTITY (UNITS)',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _quantityController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                validator: (val) {
                  final n = int.tryParse(val ?? '');
                  if (n == null || n <= 0) return 'Enter valid quantity';
                  return null;
                },
              ),
              const SizedBox(height: 28),

              // Submit Button
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.tealAccent,
                    foregroundColor: Colors.white,
                    textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Icon(Icons.outbox),
                  label: Text(_isSubmitting ? 'VALIDATING LEDGER...' : 'CONFIRM OUTBOUND DISPATCH'),
                  onPressed: _isSubmitting ? null : _submitDispatch,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
