import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/theme/app_colors.dart';
import '../../inventory/providers/inventory_provider.dart';

class DispatchStockScreen extends ConsumerStatefulWidget {
  const DispatchStockScreen({super.key});

  @override
  ConsumerState<DispatchStockScreen> createState() => _DispatchStockScreenState();
}

class _DispatchStockScreenState extends ConsumerState<DispatchStockScreen> {
  final _formKey = GlobalKey<FormState>();

  String _selectedProductId = 'PROD-COV-VAX-01';
  String _selectedWarehouseId = 'WH-CENTRAL-01';
  String _selectedBatchNumber = 'BATCH-COV-8821';
  String _selectedDestination = 'HOSP-METRO-01';
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

    final qty = int.tryParse(_quantityController.text) ?? 0;
    final idempotencyKey = const Uuid().v4();

    // Confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceGraphite,
        title: const Text('Confirm Stock Outbound Dispatch'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review outbound inventory reduction:',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 12),
            _buildRow('Product ID', _selectedProductId),
            _buildRow('Batch (FEFO)', _selectedBatchNumber),
            _buildRow('Destination', _selectedDestination),
            _buildRow('Deduction', '-$qty units'),
            _buildRow('Idempotency Key', '${idempotencyKey.substring(0, 8)}...'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.tealAccent,
              foregroundColor: AppColors.navyDark,
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
      await repo.dispatchStock(
        productId: _selectedProductId,
        warehouseId: _selectedWarehouseId,
        batchNumber: _selectedBatchNumber,
        destinationHospitalId: _selectedDestination,
        quantity: qty,
        idempotencyKey: idempotencyKey,
      );

      ref.invalidate(inventoryListProvider);
      ref.invalidate(batchesListProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Successfully dispatched $qty units to $_selectedDestination'),
          backgroundColor: AppColors.successGreen,
        ),
      );
      context.pop();
    } catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = e.toString();
      });
    }
  }

  Widget _buildRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark)),
          Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inventoryAsync = ref.watch(inventoryListProvider);
    final batchesAsync = ref.watch(batchesListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dispatch Goods (Outbound)'),
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
                  color: AppColors.infoBlue.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.infoBlue.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.shield_outlined, color: AppColors.infoBlue, size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Outbound dispatches enforce FEFO (First-Expired, First-Out) priority to prevent stock expiry losses.',
                        style: TextStyle(fontSize: 12, color: AppColors.infoBlue),
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
                    color: AppColors.errorRed.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.errorRed),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: const TextStyle(color: AppColors.errorRed, fontSize: 13),
                  ),
                ),

              // Product
              const Text(
                'PRODUCT TO DISPATCH',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              inventoryAsync.when(
                data: (items) {
                  return DropdownButtonFormField<String>(
                    value: _selectedProductId,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                    items: items.map((i) {
                      return DropdownMenuItem(
                        value: i.productId,
                        child: Text('${i.productName} (${i.quantityAvailable} avail)'),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedProductId = val);
                    },
                  );
                },
                loading: () => const LinearProgressIndicator(),
                error: (_, __) => DropdownButtonFormField<String>(
                  value: _selectedProductId,
                  items: const [
                    DropdownMenuItem(value: 'PROD-COV-VAX-01', child: Text('Covaxin Vaccine')),
                    DropdownMenuItem(value: 'PROD-INS-GLA-02', child: Text('Insulin Glargine')),
                  ],
                  onChanged: (val) => setState(() => _selectedProductId = val!),
                ),
              ),
              const SizedBox(height: 16),

              // Batch Selection (FEFO sorted)
              const Text(
                'BATCH SELECTION (FEFO ORDERED)',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              batchesAsync.when(
                data: (batches) {
                  final matching = batches.where((b) => b.productId == _selectedProductId).toList();
                  final displayBatches = matching.isNotEmpty ? matching : batches;
                  return DropdownButtonFormField<String>(
                    value: displayBatches.any((b) => b.batchNumber == _selectedBatchNumber)
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
                loading: () => const LinearProgressIndicator(),
                error: (_, __) => TextFormField(
                  initialValue: _selectedBatchNumber,
                  onChanged: (val) => _selectedBatchNumber = val,
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(height: 16),

              // Destination Hospital
              const Text(
                'DESTINATION HEALTHCARE FACILITY',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                value: _selectedDestination,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'HOSP-METRO-01', child: Text('Apollo Hospital Central (Metro)')),
                  DropdownMenuItem(value: 'HOSP-FORTIS-02', child: Text('Fortis Super Speciality Hub')),
                  DropdownMenuItem(value: 'HOSP-MANIPAL-03', child: Text('Manipal Hospital North')),
                  DropdownMenuItem(value: 'HOSP-DIST-RURAL', child: Text('District General Hospital (Rural)')),
                ],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedDestination = val);
                },
              ),
              const SizedBox(height: 16),

              // Quantity
              const Text(
                'DISPATCH QUANTITY (UNITS)',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _quantityController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  hintText: 'e.g. 100',
                  border: OutlineInputBorder(),
                ),
                validator: (val) {
                  final n = int.tryParse(val ?? '');
                  if (n == null || n <= 0) return 'Enter a valid dispatch quantity';
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
                    backgroundColor: AppColors.infoBlue,
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
                  label: Text(_isSubmitting ? 'VALIDATING WITH SERVER...' : 'CONFIRM OUTBOUND DISPATCH'),
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
