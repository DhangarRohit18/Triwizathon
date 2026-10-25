import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../core/theme/app_colors.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../../inventory/providers/inventory_provider.dart';

class ReceiveStockScreen extends ConsumerStatefulWidget {
  const ReceiveStockScreen({super.key});

  @override
  ConsumerState<ReceiveStockScreen> createState() => _ReceiveStockScreenState();
}

class _ReceiveStockScreenState extends ConsumerState<ReceiveStockScreen> {
  final _formKey = GlobalKey<FormState>();

  String? _selectedProductId;
  String? _selectedWarehouseId;
  final _batchNumberController = TextEditingController();
  final _quantityController = TextEditingController(text: '500');
  final _unitCostController = TextEditingController(text: '22.50');
  final _storageBinController = TextEditingController(text: 'ZONE-A-BIN-01');
  DateTime _expiryDate = DateTime.now().add(const Duration(days: 270));

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _batchNumberController.text = 'BN-${DateTime.now().millisecondsSinceEpoch % 100000}';
  }

  @override
  void dispose() {
    _batchNumberController.dispose();
    _quantityController.dispose();
    _unitCostController.dispose();
    _storageBinController.dispose();
    super.dispose();
  }

  Future<void> _submitReceipt() async {
    if (!_formKey.currentState!.validate()) return;

    final user = ref.read(authNotifierProvider).user;
    final warehouseId = _selectedWarehouseId ?? user?.warehouseId;
    if (warehouseId == null || warehouseId.isEmpty) {
      setState(() => _errorMessage = 'A valid warehouse facility must be assigned or selected before receiving stock.');
      return;
    }
    final productId = _selectedProductId;
    if (productId == null || productId.isEmpty) {
      setState(() => _errorMessage = 'Please select a registered product SKU from the live catalog.');
      return;
    }
    final qty = int.tryParse(_quantityController.text) ?? 0;
    final cost = double.tryParse(_unitCostController.text) ?? 0.0;
    final batch = _batchNumberController.text.trim();
    final storageBin = _storageBinController.text.trim();
    final idempotencyKey = const Uuid().v4();

    // Confirm predicted stock mutation with the user
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.pureWhite,
        title: const Text(
          'Confirm Stock Inbound',
          style: TextStyle(color: AppColors.primaryNavy, fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review predicted inventory ledger impact:',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
            ),
            const SizedBox(height: 12),
            _buildConfirmationRow('Product ID', productId),
            _buildConfirmationRow('Warehouse', warehouseId),
            _buildConfirmationRow('Batch Number', batch),
            _buildConfirmationRow('Storage Bin', storageBin),
            _buildConfirmationRow('Quantity', '+$qty units'),
            _buildConfirmationRow('Unit Cost', '\$${cost.toStringAsFixed(2)}'),
            _buildConfirmationRow('Expiry Date', DateFormat('yyyy-MM-dd').format(_expiryDate)),
            _buildConfirmationRow('Idempotency Key', '${idempotencyKey.substring(0, 8)}...'),
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
            child: const Text('Confirm Receipt'),
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
      final result = await repo.receiveStock(
        productId: productId,
        warehouseId: warehouseId,
        batchNumber: batch,
        storageBin: storageBin,
        quantity: qty,
        unitCost: cost,
        expiryDate: _expiryDate.toIso8601String(),
        idempotencyKey: idempotencyKey,
      );

      ref.invalidate(inventoryListProvider);
      ref.invalidate(batchesListProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.isOfflineDraft
                ? 'Receipt queued as offline draft. Will sync when reconnected.'
                : 'Successfully received $qty units into $warehouseId (Batch: $batch)',
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

  Widget _buildConfirmationRow(String label, String value) {
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
    final user = ref.watch(authNotifierProvider).user;
    final assignedWh = user?.warehouseId ?? '';
    final hasAssignedWarehouse = assignedWh.isNotEmpty;
    final isRestrictedWarehouse = (user?.role == UserRole.operator || user?.role == UserRole.warehouseManager) && hasAssignedWarehouse;

    return Scaffold(
      backgroundColor: AppColors.pureWhite,
      appBar: AppBar(
        title: const Text('Receive Goods (Putaway)'),
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
                    Icon(Icons.verified_outlined, color: AppColors.tealAccent, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Every receipt mutation is validated with an idempotency key to prevent duplicate inventory movements.',
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

              // Product Selection
              const Text(
                'PRODUCT SKU',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              inventoryAsync.when(
                data: (items) {
                  if (items.isEmpty) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceLight,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.borderLight),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.inventory_2_outlined, color: AppColors.textSecondaryLight, size: 18),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'No products currently registered in this facility ledger.',
                              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
                            ),
                          ),
                        ],
                      ),
                    );
                  }

                  final currentVal = _selectedProductId ?? items.first.productId;
                  if (_selectedProductId == null) {
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted && _selectedProductId == null) {
                        setState(() => _selectedProductId = items.first.productId);
                      }
                    });
                  }

                  return DropdownButtonFormField<String>(
                    initialValue: items.any((i) => i.productId == currentVal) ? currentVal : items.first.productId,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: items.map((i) {
                      return DropdownMenuItem(
                        value: i.productId,
                        child: Text('${i.productName} (${i.productSku})', overflow: TextOverflow.ellipsis),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedProductId = val);
                    },
                  );
                },
                loading: () => const LinearProgressIndicator(color: AppColors.tealAccent),
                error: (e, _) => Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.errorBg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.3)),
                  ),
                  child: Text('Unable to load verified catalog: $e', style: const TextStyle(fontSize: 12, color: AppColors.errorRed)),
                ),
              ),
              const SizedBox(height: 16),

              // Receiving Facility
              const Text(
                'RECEIVING FACILITY',
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
                inventoryAsync.when(
                  data: (items) {
                    final Set<String> authorizedWarehouses = {};
                    if (user?.warehouseId != null && user!.warehouseId!.isNotEmpty) {
                      authorizedWarehouses.add(user.warehouseId!);
                    }
                    if (user?.warehouseIds != null) {
                      authorizedWarehouses.addAll(user!.warehouseIds);
                    }
                    for (final i in items) {
                      if (i.warehouseId.isNotEmpty) {
                        authorizedWarehouses.add(i.warehouseId);
                      }
                    }

                    if (authorizedWarehouses.isEmpty) {
                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceLight,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.borderLight),
                        ),
                        child: const Text('No authorized facilities provisioned for this identity.', style: TextStyle(fontSize: 12, color: AppColors.textSecondaryLight)),
                      );
                    }

                    final initialWh = _selectedWarehouseId ?? (authorizedWarehouses.contains(user?.warehouseId) ? user?.warehouseId : authorizedWarehouses.first);
                    if (_selectedWarehouseId == null && initialWh != null) {
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (mounted && _selectedWarehouseId == null) {
                          setState(() => _selectedWarehouseId = initialWh);
                        }
                      });
                    }

                    return DropdownButtonFormField<String>(
                      initialValue: authorizedWarehouses.contains(initialWh) ? initialWh : authorizedWarehouses.first,
                      decoration: const InputDecoration(border: OutlineInputBorder()),
                      items: authorizedWarehouses.map((wh) {
                        return DropdownMenuItem(
                          value: wh,
                          child: Text('Facility ($wh)'),
                        );
                      }).toList(),
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedWarehouseId = val);
                      },
                    );
                  },
                  loading: () => const LinearProgressIndicator(color: AppColors.tealAccent),
                  error: (_, __) => TextFormField(
                    initialValue: _selectedWarehouseId ?? user?.warehouseId ?? '',
                    decoration: const InputDecoration(
                      labelText: 'Facility Code (e.g. WH-FACILITY-01)',
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (val) => setState(() => _selectedWarehouseId = val.trim()),
                  ),
                ),
              const SizedBox(height: 16),

              // Batch Number
              const Text(
                'MANUFACTURER BATCH / LOT #',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _batchNumberController,
                decoration: const InputDecoration(
                  hintText: 'e.g. BN-VAX-2026-A1',
                  border: OutlineInputBorder(),
                ),
                validator: (val) => (val == null || val.trim().isEmpty) ? 'Batch number required' : null,
              ),
              const SizedBox(height: 16),

              // Storage Bin
              const Text(
                'STORAGE LOCATION / BIN',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _storageBinController,
                decoration: const InputDecoration(
                  hintText: 'e.g. ZONE-A-BIN-01',
                  border: OutlineInputBorder(),
                ),
                validator: (val) => (val == null || val.trim().isEmpty) ? 'Storage bin required' : null,
              ),
              const SizedBox(height: 16),

              // Quantity & Cost row
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'QUANTITY (UNITS)',
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
                      ],
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'UNIT COST (\$)',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
                        ),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: _unitCostController,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(border: OutlineInputBorder()),
                          validator: (val) {
                            final c = double.tryParse(val ?? '');
                            if (c == null || c < 0) return 'Enter valid cost';
                            return null;
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Expiry Date Picker
              const Text(
                'BATCH EXPIRY DATE (FEFO ENFORCEMENT)',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryLight),
              ),
              const SizedBox(height: 6),
              InkWell(
                onTap: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _expiryDate,
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 365 * 5)),
                  );
                  if (picked != null) setState(() => _expiryDate = picked);
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        DateFormat('yyyy-MM-dd').format(_expiryDate),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppColors.primaryNavy),
                      ),
                      const Icon(Icons.calendar_today, size: 18, color: AppColors.tealAccent),
                    ],
                  ),
                ),
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
                      : const Icon(Icons.check_circle_outline),
                  label: Text(_isSubmitting ? 'VALIDATING WITH SERVER...' : 'CONFIRM INBOUND RECEIPT'),
                  onPressed: _isSubmitting ? null : _submitReceipt,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
