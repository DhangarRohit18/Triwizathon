import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../core/theme/app_colors.dart';
import '../../inventory/providers/inventory_provider.dart';

class ReceiveStockScreen extends ConsumerStatefulWidget {
  const ReceiveStockScreen({super.key});

  @override
  ConsumerState<ReceiveStockScreen> createState() => _ReceiveStockScreenState();
}

class _ReceiveStockScreenState extends ConsumerState<ReceiveStockScreen> {
  final _formKey = GlobalKey<FormState>();

  String _selectedProductId = 'PROD-COV-VAX-01';
  String _selectedWarehouseId = 'WH-CENTRAL-01';
  final _batchNumberController = TextEditingController(text: 'BN-${DateTime.now().millisecondsSinceEpoch % 100000}');
  final _quantityController = TextEditingController(text: '500');
  final _unitCostController = TextEditingController(text: '18.50');
  DateTime _expiryDate = DateTime.now().add(const Duration(days: 270));

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _batchNumberController.dispose();
    _quantityController.dispose();
    _unitCostController.dispose();
    super.dispose();
  }

  Future<void> _submitReceipt() async {
    if (!_formKey.currentState!.validate()) return;

    final qty = int.tryParse(_quantityController.text) ?? 0;
    final cost = double.tryParse(_unitCostController.text) ?? 0.0;
    final batch = _batchNumberController.text.trim();
    final idempotencyKey = const Uuid().v4();

    // Confirm predicted stock mutation with the user
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceGraphite,
        title: const Text('Confirm Stock Inbound'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Review predicted inventory ledger impact:',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 12),
            _buildConfirmationRow('Product ID', _selectedProductId),
            _buildConfirmationRow('Batch Number', batch),
            _buildConfirmationRow('Quantity', '+$qty units'),
            _buildConfirmationRow('Unit Cost', '\$${cost.toStringAsFixed(2)}'),
            _buildConfirmationRow('Expiry Date', DateFormat('yyyy-MM-dd').format(_expiryDate)),
            _buildConfirmationRow('Idempotency Key', '${idempotencyKey.substring(0, 8)}...'),
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
      await repo.receiveStock(
        productId: _selectedProductId,
        warehouseId: _selectedWarehouseId,
        batchNumber: batch,
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
          content: Text('Successfully received $qty units of $_selectedProductId (Batch: $batch)'),
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

  Widget _buildConfirmationRow(String label, String value) {
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Receive Goods (Putaway)'),
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
                  color: AppColors.tealAccent.withValues(alpha: 0.1),
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
                        style: TextStyle(fontSize: 12, color: AppColors.tealAccent),
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

              // Product Selection
              const Text(
                'PRODUCT SKU',
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
                        child: Text('${i.productName} (${i.sku})', overflow: TextOverflow.ellipsis),
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

              // Warehouse destination
              const Text(
                'RECEIVING FACILITY',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<String>(
                value: _selectedWarehouseId,
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem(value: 'WH-CENTRAL-01', child: Text('Central Distribution Warehouse (Bengaluru)')),
                  DropdownMenuItem(value: 'WH-NORTH-02', child: Text('North Regional Hub (Delhi)')),
                  DropdownMenuItem(value: 'WH-WEST-03', child: Text('West Regional Hub (Mumbai)')),
                ],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedWarehouseId = val);
                },
              ),
              const SizedBox(height: 16),

              // Batch Number
              const Text(
                'MANUFACTURER BATCH / LOT #',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _batchNumberController,
                decoration: const InputDecoration(
                  hintText: 'e.g. BATCH-COV-9901',
                  border: OutlineInputBorder(),
                ),
                validator: (val) => (val == null || val.trim().isEmpty) ? 'Batch number required' : null,
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
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
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
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
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
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
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
                    color: AppColors.surfaceGraphite,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderGraphite),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        DateFormat('yyyy-MM-dd').format(_expiryDate),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
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
                    foregroundColor: AppColors.navyDark,
                    textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                  icon: _isSubmitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: AppColors.navyDark, strokeWidth: 2),
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
