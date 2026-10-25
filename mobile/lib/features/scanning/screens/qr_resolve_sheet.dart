import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/user_model.dart';
import '../../../data/repositories/inventory_repository.dart';
import '../../auth/providers/auth_provider.dart';
import '../../inventory/providers/inventory_provider.dart';

class QrResolveSheet extends ConsumerStatefulWidget {
  final Map<String, dynamic> resolvedData;
  final VoidCallback onDismiss;

  const QrResolveSheet({
    super.key,
    required this.resolvedData,
    required this.onDismiss,
  });

  @override
  ConsumerState<QrResolveSheet> createState() => _QrResolveSheetState();
}

class _QrResolveSheetState extends ConsumerState<QrResolveSheet> {
  bool _isLoading = false;
  InventoryActionResult? _lastOutcome;
  String? _errorMessage;

  // -------------------------------------------------------------
  // Data extraction helpers
  // -------------------------------------------------------------
  String get _resolvedType => (widget.resolvedData['resolved_type'] ?? 'product').toString().toLowerCase();

  String get _productId {
    final prd = widget.resolvedData['product'];
    if (prd is Map && prd['id'] != null) return prd['id'].toString();
    return widget.resolvedData['product_id']?.toString() ?? 'prd_vax_01';
  }

  String get _productName {
    final prd = widget.resolvedData['product'];
    if (prd is Map && prd['name'] != null) return prd['name'].toString();
    return widget.resolvedData['product_name']?.toString() ?? 'Authorized Item';
  }

  String get _sku {
    final prd = widget.resolvedData['product'];
    if (prd is Map && prd['sku'] != null) return prd['sku'].toString();
    return widget.resolvedData['sku']?.toString() ?? 'SKU-001';
  }

  String get _category {
    final prd = widget.resolvedData['product'];
    if (prd is Map && prd['category'] != null) return prd['category'].toString();
    return widget.resolvedData['category']?.toString() ?? 'Pharmaceuticals';
  }

  String get _warehouseId {
    final wh = widget.resolvedData['warehouse'];
    if (wh is Map && wh['id'] != null) return wh['id'].toString();
    final rawWh = widget.resolvedData['warehouse_id']?.toString();
    if (rawWh != null && rawWh.isNotEmpty) return rawWh;
    final user = ref.read(authNotifierProvider).user;
    return user?.warehouseId ?? '';
  }

  String get _batchNumber {
    final b = widget.resolvedData['batch'];
    if (b is Map && b['batch_number'] != null) return b['batch_number'].toString();
    return widget.resolvedData['batch_number']?.toString() ?? 'BN-${DateTime.now().millisecondsSinceEpoch % 10000}';
  }

  String get _batchId {
    final b = widget.resolvedData['batch'];
    if (b is Map && b['id'] != null) return b['id'].toString();
    return widget.resolvedData['batch_id']?.toString() ?? _batchNumber;
  }

  int get _currentStock {
    final cs = widget.resolvedData['current_stock'] ?? widget.resolvedData['total_available'];
    if (cs is num) return cs.toInt();
    return 0;
  }

  String get _storageType {
    final st = widget.resolvedData['storage_type'] ?? widget.resolvedData['handling'];
    return st != null ? st.toString().toUpperCase() : 'COLD_CHAIN';
  }

  // -------------------------------------------------------------
  // Action Handlers
  // -------------------------------------------------------------
  Future<void> _handleReceiveAction() async {
    final qtyController = TextEditingController(text: '100');
    final batchController = TextEditingController(text: _batchNumber);
    final binController = TextEditingController(text: 'ZONE-A-BIN-01');
    final costController = TextEditingController(text: '22.50');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceGraphite,
        title: const Row(
          children: [
            Icon(Icons.move_to_inbox, color: AppColors.tealAccent, size: 20),
            SizedBox(width: 8),
            Text('Receive Inbound Stock', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildDialogInfo('Product', '$_productName ($_sku)'),
              _buildDialogInfo('Warehouse', _warehouseId),
              const SizedBox(height: 12),
              TextField(
                controller: qtyController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Quantity to Receive',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.numbers, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: batchController,
                decoration: const InputDecoration(
                  labelText: 'Batch / Lot #',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.qr_code, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: binController,
                decoration: const InputDecoration(
                  labelText: 'Storage Bin / Location',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.location_on_outlined, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: costController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'Unit Cost (\$)',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.attach_money, size: 18),
                ),
              ),
            ],
          ),
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
            child: const Text('Confirm Receive'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final qty = int.tryParse(qtyController.text) ?? 100;
    final cost = double.tryParse(costController.text) ?? 22.50;
    final batchNum = batchController.text.trim();
    final bin = binController.text.trim();
    final idempotencyKey = 'MOB-REC-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.receiveStock(
        warehouseId: _warehouseId,
        productId: _productId,
        batchNumber: batchNum,
        quantity: qty,
        unitCost: cost,
        storageBin: bin,
        expiryDate: DateTime.now().add(const Duration(days: 180)).toIso8601String().split('T').first,
        idempotencyKey: idempotencyKey,
      );
    });
  }

  Future<void> _handleDispatchAction() async {
    final qtyController = TextEditingController(text: '25');
    final destController = TextEditingController(text: 'HOSP-METRO-01');
    final reasonController = TextEditingController(text: 'Hospital emergency reorder');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surfaceGraphite,
        title: const Row(
          children: [
            Icon(Icons.outbox, color: AppColors.infoBlue, size: 20),
            SizedBox(width: 8),
            Text('Dispatch Stock', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildDialogInfo('Product', '$_productName ($_sku)'),
              _buildDialogInfo('Available Stock', '$_currentStock units'),
              _buildDialogInfo('Warehouse', _warehouseId),
              const SizedBox(height: 12),
              TextField(
                controller: qtyController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Dispatch Quantity',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.numbers, size: 18),
                  helperText: 'Must not exceed $_currentStock available',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: destController,
                decoration: const InputDecoration(
                  labelText: 'Destination Facility / Hospital ID',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.local_hospital_outlined, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: reasonController,
                decoration: const InputDecoration(
                  labelText: 'Dispatch Reason / Authorization',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.description_outlined, size: 18),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.infoBlue,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm Dispatch'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final qty = int.tryParse(qtyController.text) ?? 25;
    final dest = destController.text.trim();
    final reason = reasonController.text.trim();
    final idempotencyKey = 'MOB-DISP-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.dispatchStock(
        warehouseId: _warehouseId,
        productId: _productId,
        destinationId: dest,
        destinationHospitalId: dest,
        quantity: qty,
        batchNumber: _batchNumber,
        batchId: _batchId,
        reason: reason,
        idempotencyKey: idempotencyKey,
      );
    });
  }

  Future<void> _handleCycleCountAction() async {
    final qtyController = TextEditingController(text: _currentStock.toString());
    final notesController = TextEditingController(text: 'Physical cycle count verified by floor operator');
    final binController = TextEditingController(text: 'ZONE-A-BIN-01');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDlgState) {
          final counted = int.tryParse(qtyController.text) ?? _currentStock;
          final variance = counted - _currentStock;

          return AlertDialog(
            backgroundColor: AppColors.surfaceGraphite,
            title: const Row(
              children: [
                Icon(Icons.checklist, color: AppColors.tealAccent, size: 20),
                SizedBox(width: 8),
                Text('Physical Cycle Count', style: TextStyle(fontSize: 16)),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildDialogInfo('Product', '$_productName ($_sku)'),
                  _buildDialogInfo('Batch #', _batchNumber),
                  _buildDialogInfo('System Balance', '$_currentStock units'),
                  const SizedBox(height: 12),
                  TextField(
                    controller: qtyController,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setDlgState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Physical Counted Quantity',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.calculate_outlined, size: 18),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: variance == 0
                          ? AppColors.successGreen.withValues(alpha: 0.15)
                          : (variance < 0 ? AppColors.errorRed.withValues(alpha: 0.15) : AppColors.warningAmber.withValues(alpha: 0.15)),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Count Variance:', style: TextStyle(fontSize: 12)),
                        Text(
                          variance == 0 ? '0 (Exact match)' : (variance > 0 ? '+$variance (Surplus)' : '$variance (Shortage)'),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: variance == 0 ? AppColors.successGreen : (variance < 0 ? AppColors.errorRed : AppColors.warningAmber),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: binController,
                    decoration: const InputDecoration(
                      labelText: 'Storage Bin',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.location_on_outlined, size: 18),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: notesController,
                    decoration: const InputDecoration(
                      labelText: 'Audit Observation Notes',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.note_alt_outlined, size: 18),
                    ),
                  ),
                ],
              ),
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
                child: const Text('Submit Audit Count'),
              ),
            ],
          );
        },
      ),
    );

    if (confirmed != true) return;

    final countedQty = int.tryParse(qtyController.text) ?? _currentStock;
    final notes = notesController.text.trim();
    final bin = binController.text.trim();
    final idempotencyKey = 'MOB-CNT-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.cycleCount(
        warehouseId: _warehouseId,
        productId: _productId,
        batchId: _batchId,
        countedQuantity: countedQty,
        storageBin: bin,
        notes: notes,
        idempotencyKey: idempotencyKey,
      );
    });
  }

  Future<void> _handleDamageAction() async {
    final qtyController = TextEditingController(text: '5');
    final reasonController = TextEditingController(text: 'Vial fractured during handling');
    String discType = 'damaged';
    String resAction = 'quarantine';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDlgState) => AlertDialog(
          backgroundColor: AppColors.surfaceGraphite,
          title: const Row(
            children: [
              Icon(Icons.report_problem, color: AppColors.errorRed, size: 20),
              SizedBox(width: 8),
              Text('Report Damage / Discrepancy', style: TextStyle(fontSize: 16)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildDialogInfo('Product', '$_productName ($_sku)'),
                _buildDialogInfo('Batch #', _batchNumber),
                _buildDialogInfo('Available Stock', '$_currentStock units'),
                const SizedBox(height: 12),
                TextField(
                  controller: qtyController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Damaged / Discrepant Quantity',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.numbers, size: 18),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: discType,
                  decoration: const InputDecoration(
                    labelText: 'Discrepancy Nature',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'damaged', child: Text('Physical Damage / Breakage')),
                    DropdownMenuItem(value: 'seal_breach', child: Text('Seal / Packaging Breach')),
                    DropdownMenuItem(value: 'temperature_excursion', child: Text('Cold Chain Excursion')),
                    DropdownMenuItem(value: 'missing', child: Text('Physical Shortage / Missing')),
                  ],
                  onChanged: (v) => setDlgState(() => discType = v ?? 'damaged'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: resAction,
                  decoration: const InputDecoration(
                    labelText: 'Resolution Action',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'quarantine', child: Text('Quarantine for Inspection')),
                    DropdownMenuItem(value: 'write_off', child: Text('Immediate Write-Off / Scrap')),
                  ],
                  onChanged: (v) => setDlgState(() => resAction = v ?? 'quarantine'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: reasonController,
                  decoration: const InputDecoration(
                    labelText: 'Damage Incident Details',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.notes, size: 18),
                  ),
                ),
              ],
            ),
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
              child: const Text('Record Damage'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;

    final dmgQty = int.tryParse(qtyController.text) ?? 5;
    final reason = reasonController.text.trim();
    final idempotencyKey = 'MOB-DMG-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      if (resAction == 'write_off') {
        return await repo.resolveDiscrepancy(
          warehouseId: _warehouseId,
          productId: _productId,
          batchId: _batchId,
          discrepancyType: discType,
          quantityDelta: -dmgQty,
          resolutionAction: 'write_off',
          reason: reason,
          idempotencyKey: idempotencyKey,
        );
      } else {
        return await repo.reportDamage(
          warehouseId: _warehouseId,
          productId: _productId,
          batchId: _batchId,
          batchNumber: _batchNumber,
          damagedQuantity: dmgQty,
          damageReason: '$discType: $reason',
          idempotencyKey: idempotencyKey,
        );
      }
    });
  }

  Future<void> _handleTransferReceiveAction() async {
    final transferId = widget.resolvedData['transfer_id']?.toString() ?? widget.resolvedData['transfer']?['id']?.toString() ?? 'trf_001_chi_ny';
    String condition = 'intact';
    final damagedQtyController = TextEditingController(text: '0');
    final notesController = TextEditingController(text: 'Mobile floor QR scan: Cargo verified and acknowledged');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDlgState) => AlertDialog(
          backgroundColor: AppColors.surfaceGraphite,
          title: const Row(
            children: [
              Icon(Icons.assignment_turned_in, color: AppColors.tealAccent, size: 20),
              SizedBox(width: 8),
              Text('Acknowledge Transfer', style: TextStyle(fontSize: 16)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildDialogInfo('Transfer ID', transferId),
                _buildDialogInfo('Status', widget.resolvedData['status']?.toString() ?? 'in_transit'),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: condition,
                  decoration: const InputDecoration(
                    labelText: 'Cargo Condition',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'intact', child: Text('Intact & Compliant')),
                    DropdownMenuItem(value: 'temperature_excursion', child: Text('Temperature Excursion Breached')),
                    DropdownMenuItem(value: 'damaged', child: Text('Packaging / Cargo Damaged')),
                  ],
                  onChanged: (v) => setDlgState(() => condition = v ?? 'intact'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: damagedQtyController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Damaged Units (if any)',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.numbers, size: 18),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: notesController,
                  decoration: const InputDecoration(
                    labelText: 'Inspection Notes',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.notes, size: 18),
                  ),
                ),
              ],
            ),
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
              child: const Text('Acknowledge & Accept'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) return;

    final dmgQty = int.tryParse(damagedQtyController.text) ?? 0;
    final notes = notesController.text.trim();

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.receiveTransfer(
        transferId: transferId,
        damagedQuantity: dmgQty,
        condition: condition,
        notes: notes,
      );
    });
  }

  Future<void> _handleDeliveryReceiptAction() async {
    final recipientController = TextEditingController(text: 'Metro Health Hospital - Receiving Dept');
    final notesController = TextEditingController(text: 'Mobile QR Scan: Cargo received intact with verified seals.');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Row(
          children: [
            Icon(Icons.verified, color: AppColors.tealAccent, size: 20),
            SizedBox(width: 8),
            Text('Confirm Delivery Receipt', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildDialogInfo('Product', '$_productName ($_sku)'),
              _buildDialogInfo('Batch #', _batchNumber),
              _buildDialogInfo('Origin Hub', _warehouseId),
              const SizedBox(height: 12),
              TextField(
                controller: recipientController,
                decoration: const InputDecoration(
                  labelText: 'Delivery Destination / Recipient',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.business_outlined, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: notesController,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Receipt Notes & Chain-of-Custody',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.notes, size: 18),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
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

    final idempotencyKey = 'MOB-DIST-REC-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.dispatchStock(
        warehouseId: _warehouseId,
        productId: _productId,
        destinationId: recipientController.text.trim(),
        destinationHospitalId: recipientController.text.trim(),
        quantity: 1,
        batchNumber: _batchNumber,
        batchId: _batchId,
        reason: 'Distributor delivery confirmed: ${notesController.text.trim()}',
        idempotencyKey: idempotencyKey,
      );
    });
  }

  Future<void> _handleDeliveryExceptionAction() async {
    final qtyController = TextEditingController(text: '1');
    final reasonController = TextEditingController(text: 'Transit excursion / cold chain packaging damaged');

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Row(
          children: [
            Icon(Icons.report_problem, color: AppColors.errorRed, size: 20),
            SizedBox(width: 8),
            Text('Report Delivery Exception', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildDialogInfo('Product', '$_productName ($_sku)'),
              _buildDialogInfo('Batch #', _batchNumber),
              const SizedBox(height: 12),
              TextField(
                controller: qtyController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Impacted Quantity',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.numbers, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: reasonController,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Exception Details / Seal Status',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.warning_amber_rounded, size: 18),
                ),
              ),
            ],
          ),
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
            child: const Text('Submit Exception'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final qty = int.tryParse(qtyController.text) ?? 1;
    final reason = reasonController.text.trim();
    final idempotencyKey = 'MOB-DIST-EXC-${DateTime.now().millisecondsSinceEpoch}-${const Uuid().v4().substring(0, 6)}';

    _executeOperation(() async {
      final repo = ref.read(inventoryRepositoryProvider);
      return await repo.reportDamage(
        warehouseId: _warehouseId,
        productId: _productId,
        batchId: _batchId,
        batchNumber: _batchNumber,
        damagedQuantity: qty,
        damageReason: '[DISTRIBUTOR TRANSIT EXCEPTION] $reason',
        idempotencyKey: idempotencyKey,
      );
    });
  }

  // -------------------------------------------------------------
  // Execution wrapper
  // -------------------------------------------------------------
  Future<void> _executeOperation(Future<InventoryActionResult> Function() fn) async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _lastOutcome = null;
    });

    try {
      final outcome = await fn();

      // Refresh authoritative views
      ref.invalidate(inventoryListProvider);
      ref.invalidate(batchesListProvider);

      setState(() {
        _isLoading = false;
        _lastOutcome = outcome;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = e.toString();
      });
    }
  }

  Widget _buildDialogInfo(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark)),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------
  // UI Builder
  // -------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final isTransfer = _resolvedType == 'transfer';
    final user = ref.watch(authNotifierProvider).user;
    final isDistributor = user?.role == UserRole.distributor;
    final isSuperAdmin = user?.role == UserRole.superAdmin;
    final isFacilityRestricted = user != null &&
        (user.role == UserRole.operator || user.role == UserRole.warehouseManager) &&
        user.warehouseIds.isNotEmpty &&
        !user.canAccessWarehouse(_warehouseId);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Sheet handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.borderGraphite,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Header info
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isTransfer ? 'Transfer Cargo Manifest' : _productName,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppColors.navyDark),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isTransfer
                            ? 'Transfer ID: ${widget.resolvedData["transfer_id"] ?? "TRF-CARGO"}'
                            : 'SKU: $_sku • $_category',
                        style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                      ),
                    ],
                  ),
                ),
                StatusBadge.storage(type: _storageType),
              ],
            ),
            const SizedBox(height: 12),

            // Metrics summary card
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.borderGraphite),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.03),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildMetricCol(
                    isTransfer ? 'TRANSFER STATUS' : 'ACTIVE STOCK',
                    isTransfer ? (widget.resolvedData['status']?.toString().toUpperCase() ?? 'IN_TRANSIT') : '$_currentStock units',
                    AppColors.tealAccent,
                  ),
                  _buildMetricCol(
                    isTransfer ? 'TARGET HUB' : 'BATCH #',
                    isTransfer
                        ? (widget.resolvedData['target_warehouse']?['name']?.toString() ?? 'Assigned WH')
                        : _batchNumber,
                    AppColors.navyDark,
                  ),
                  _buildMetricCol(
                    'LOCATION',
                    _warehouseId,
                    AppColors.infoBlue,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Outcome / Error Banner
            if (_errorMessage != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.errorRed.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.errorRed),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.cancel, color: AppColors.errorRed, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'TRANSACTION REJECTED',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppColors.errorRed),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _errorMessage!,
                            style: const TextStyle(fontSize: 11, color: AppColors.errorRed),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

            if (_lastOutcome != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _lastOutcome!.isOfflineDraft
                      ? AppColors.warningAmber.withValues(alpha: 0.15)
                      : AppColors.successGreen.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: _lastOutcome!.isOfflineDraft ? AppColors.warningAmber : AppColors.successGreen,
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      _lastOutcome!.isOfflineDraft ? Icons.cloud_off : Icons.check_circle,
                      color: _lastOutcome!.isOfflineDraft ? AppColors.warningAmber : AppColors.successGreen,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _lastOutcome!.isOfflineDraft ? 'OFFLINE DRAFT SAVED' : 'COMMITTED & CONFIRMED',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              color: _lastOutcome!.isOfflineDraft ? AppColors.warningAmber : AppColors.successGreen,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _lastOutcome!.message,
                            style: TextStyle(
                              fontSize: 11,
                              color: _lastOutcome!.isOfflineDraft ? AppColors.warningAmber : AppColors.successGreen,
                            ),
                          ),
                          if (_lastOutcome!.transactionId != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              'Tx ID: ${_lastOutcome!.transactionId}',
                              style: const TextStyle(fontSize: 10, fontFamily: 'monospace', color: AppColors.textSecondaryDark),
                            ),
                          ],
                          if (_lastOutcome!.correlationId != null) ...[
                            Text(
                              'Idempotency Key: ${_lastOutcome!.correlationId}',
                              style: const TextStyle(fontSize: 10, fontFamily: 'monospace', color: AppColors.textSecondaryDark),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),

            if (_isLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(16.0),
                  child: CircularProgressIndicator(color: AppColors.tealAccent),
                ),
              )
            else ...[
              // Facility Restriction Warning
              if (isFacilityRestricted) ...[
                Container(
                  margin: const EdgeInsets.only(bottom: 14),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.warningAmber.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.warningAmber),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.lock_outline, color: AppColors.warningAmber, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'FACILITY BOUNDARY: This item is managed at warehouse "$_warehouseId". You are assigned to [${user.warehouseIds.join(", ")}]. Floor stock mutations are locked.',
                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.navyDark),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              // Role-aware action dispatching
              if (isSuperAdmin) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.tealAccent.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.tealAccent.withValues(alpha: 0.4)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.admin_panel_settings_outlined, color: AppColors.tealAccent, size: 20),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'SUPER ADMIN AUDIT VIEW: Verified batch authenticity and ledger record. Operational mutations must be performed by assigned warehouse operators.',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.navyDark),
                        ),
                      ),
                    ],
                  ),
                ),
              ] else if (isDistributor) ...[
                const Text(
                  'DISTRIBUTOR ACTIONS',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.1,
                    color: AppColors.textSecondaryDark,
                  ),
                ),
                const SizedBox(height: 10),
                if (isTransfer) ...[
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.tealAccent,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 44),
                    ),
                    icon: const Icon(Icons.verified, size: 18),
                    label: const Text('CONFIRM TRANSFER RECEIPT'),
                    onPressed: _handleTransferReceiveAction,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                      minimumSize: const Size(double.infinity, 44),
                    ),
                    icon: const Icon(Icons.report_problem, size: 18),
                    label: const Text('REPORT TRANSIT EXCEPTION / TAMPER'),
                    onPressed: _handleDeliveryExceptionAction,
                  ),
                ] else ...[
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.tealAccent,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 44),
                    ),
                    icon: const Icon(Icons.task_alt, size: 18),
                    label: const Text('CONFIRM DELIVERY RECEIPT'),
                    onPressed: _handleDeliveryReceiptAction,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                      minimumSize: const Size(double.infinity, 44),
                    ),
                    icon: const Icon(Icons.report_problem, size: 18),
                    label: const Text('REPORT DELIVERY EXCEPTION / TAMPER'),
                    onPressed: _handleDeliveryExceptionAction,
                  ),
                ],
              ] else if (isFacilityRestricted) ...[
                // Disabled floor actions with clear tooltip/explanation
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.textSecondaryDark,
                    minimumSize: const Size(double.infinity, 44),
                  ),
                  icon: const Icon(Icons.lock, size: 18),
                  label: const Text('MUTATIONS LOCKED (UNASSIGNED FACILITY)'),
                  onPressed: null,
                ),
              ] else ...[
                // Warehouse Operator, Warehouse Manager, Org Admin, Supply Chain Manager
                const Text(
                  'PROPOSED FLOOR ACTIONS',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.1,
                    color: AppColors.textSecondaryDark,
                  ),
                ),
                const SizedBox(height: 10),

                if (isTransfer) ...[
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.tealAccent,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 44),
                    ),
                    icon: const Icon(Icons.assignment_turned_in, size: 18),
                    label: const Text('ACKNOWLEDGE & RECEIVE TRANSFER'),
                    onPressed: _handleTransferReceiveAction,
                  ),
                ] else ...[
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.tealAccent,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          icon: const Icon(Icons.move_to_inbox, size: 18),
                          label: const Text('RECEIVE'),
                          onPressed: _handleReceiveAction,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primaryNavy,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          icon: const Icon(Icons.outbox, size: 18),
                          label: const Text('DISPATCH'),
                          onPressed: _handleDispatchAction,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.checklist, size: 18),
                          label: const Text('CYCLE COUNT'),
                          onPressed: _handleCycleCountAction,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(foregroundColor: AppColors.errorRed),
                          icon: const Icon(Icons.report_problem, size: 18),
                          label: const Text('DAMAGE / DISC'),
                          onPressed: _handleDamageAction,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildMetricCol(String label, String val, Color color) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
        ),
        const SizedBox(height: 2),
        Text(
          val,
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: color),
        ),
      ],
    );
  }
}
