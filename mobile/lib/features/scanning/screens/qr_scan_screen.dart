import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../core/theme/app_colors.dart';
import '../../inventory/providers/inventory_provider.dart';
import 'qr_resolve_sheet.dart';

class QrScanScreen extends ConsumerStatefulWidget {
  const QrScanScreen({super.key});

  @override
  ConsumerState<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends ConsumerState<QrScanScreen> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
    torchEnabled: false,
  );

  bool _isProcessing = false;
  DateTime? _lastScannedAt;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_isProcessing) return;

    final List<Barcode> barcodes = capture.barcodes;
    for (final barcode in barcodes) {
      final code = barcode.rawValue;
      if (code != null && code.isNotEmpty) {
        final now = DateTime.now();
        if (_lastScannedAt != null &&
            now.difference(_lastScannedAt!) < const Duration(seconds: 3)) {
          return; // prevent duplicate scanning loop
        }
        _lastScannedAt = now;
        _resolveAndShow(code);
        break;
      }
    }
  }

  Future<void> _resolveAndShow(String code) async {
    setState(() => _isProcessing = true);
    _controller.stop();

    try {
      final repo = ref.read(inventoryRepositoryProvider);
      final resolved = await repo.resolveQrCode(code);

      if (!mounted) return;

      await showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (ctx) => QrResolveSheet(
          resolvedData: resolved,
          onDismiss: () => Navigator.pop(ctx),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to resolve code "$code": $e'),
          backgroundColor: AppColors.errorRed,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isProcessing = false);
        _controller.start();
      }
    }
  }

  void _showManualEntryDialog() {
    final textController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Text('Manual Barcode / QR Identifier Lookup'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter a product SKU, lot barcode, or transfer identifier to resolve against the backend registry:',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: textController,
              decoration: const InputDecoration(
                hintText: 'e.g. PRD-VAX-01 or BATCH-COV-8821',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'SAMPLE IDENTIFIERS (TEST EXAMPLES):',
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.tealAccent),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _buildPresetChip('PRD-VAX-01', textController),
                _buildPresetChip('BN-VX-2026-A1', textController),
                _buildPresetChip('8901234567891', textController),
                _buildPresetChip('trf_001_chi_ny', textController),
                _buildPresetChip('PRD-INS-02', textController),
                _buildPresetChip('BN-IN-2026-C3', textController),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.tealAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              final code = textController.text.trim();
              if (code.isNotEmpty) {
                Navigator.pop(ctx);
                _resolveAndShow(code);
              }
            },
            child: const Text('Resolve'),
          ),
        ],
      ),
    );
  }

  Widget _buildPresetChip(String label, TextEditingController controller) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 11, color: AppColors.navyDark, fontWeight: FontWeight.w600)),
      backgroundColor: Colors.white,
      side: const BorderSide(color: AppColors.tealAccent),
      onPressed: () => controller.text = label,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Barcode & QR Scanner'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on, color: AppColors.tealAccent),
            tooltip: 'Toggle Flashlight',
            onPressed: () => _controller.toggleTorch(),
          ),
          IconButton(
            icon: const Icon(Icons.cameraswitch_outlined),
            onPressed: () => _controller.switchCamera(),
          ),
        ],
      ),
      body: Stack(
        alignment: Alignment.center,
        children: [
          // Live Camera Stream
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error, child) {
              return Center(
                child: Container(
                  padding: const EdgeInsets.all(24),
                  margin: const EdgeInsets.symmetric(horizontal: 24),
                  decoration: BoxDecoration(
                    color: AppColors.primaryNavy,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.borderLight.withValues(alpha: 0.2)),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.camera_alt_outlined, size: 48, color: AppColors.warningAmber),
                      const SizedBox(height: 12),
                      const Text(
                        'Camera Unavailable',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        error.errorCode == MobileScannerErrorCode.permissionDenied
                            ? 'Camera permission was denied. Please grant permission or use manual barcode entry.'
                            : 'Camera hardware initialization failed (${error.errorDetails?.message ?? error.errorCode.name}).',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.tealAccent,
                          foregroundColor: Colors.white,
                        ),
                        onPressed: _showManualEntryDialog,
                        icon: const Icon(Icons.keyboard, size: 16),
                        label: const Text('Manual Identifier Entry'),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),

          // Custom Viewfinder Target Brackets
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.tealAccent, width: 2.5),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Stack(
                children: [
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: Container(
                      height: 2,
                      color: AppColors.tealAccent.withValues(alpha: 0.8),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Top Info Guidance
          Positioned(
            top: 24,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black87,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.borderGraphite),
              ),
              child: const Row(
                children: [
                  Icon(Icons.qr_code_scanner, color: AppColors.tealAccent, size: 16),
                  SizedBox(width: 8),
                  Text(
                    'Align batch or product barcode within frame',
                    style: TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),

          // Manual Entry fallback button at bottom (for Android Studio Emulator)
          Positioned(
            bottom: 30,
            left: 20,
            right: 20,
            child: Column(
              children: [
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.surfaceGraphite,
                    foregroundColor: AppColors.tealAccent,
                    side: const BorderSide(color: AppColors.tealAccent),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  ),
                  icon: const Icon(Icons.keyboard),
                  label: const Text('MANUAL ENTRY / EMULATOR DEMO'),
                  onPressed: _showManualEntryDialog,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Guarantees duplicate scan prevention with server idempotency validation',
                  style: TextStyle(color: Colors.white54, fontSize: 10),
                ),
              ],
            ),
          ),

          if (_isProcessing)
            Container(
              color: Colors.black54,
              child: const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: AppColors.tealAccent),
                    SizedBox(height: 14),
                    Text(
                      'Validating identifier with StockPilot backend...',
                      style: TextStyle(color: Colors.white, fontSize: 13),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
