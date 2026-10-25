import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/api_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/user_model.dart';
import '../../inventory/providers/inventory_provider.dart';
import '../../iot/providers/iot_provider.dart';
import '../../tasks/providers/tasks_provider.dart';
import '../../transfers/providers/transfers_provider.dart';
import '../providers/auth_provider.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _urlController = TextEditingController();
  bool _isTestingConnection = false;
  String? _urlValidationMessage;

  @override
  void initState() {
    super.initState();
    _urlController.text = ApiConfig.baseUrl;
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _updateBaseUrl() async {
    final rawUrl = _urlController.text.trim();
    setState(() {
      _isTestingConnection = true;
      _urlValidationMessage = null;
    });

    try {
      final normalized = ApiConfig.validateAndNormalizeUrl(rawUrl);
      final apiClient = ref.read(apiClientProvider);

      // Verify connection to the candidate host
      final isReachable = await apiClient.testConnection(normalized);

      if (!mounted) return;

      if (!isReachable) {
        final proceed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Host Reachability Warning'),
            content: Text(
              'Could not establish a connection to "$normalized". '
              'The server might be offline or starting up.\n\n'
              'Do you still want to apply this URL configuration?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.warningAmber),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Apply Anyway'),
              ),
            ],
          ),
        );
        if (proceed != true) {
          setState(() => _isTestingConnection = false);
          return;
        }
      }

      // Apply and persist to client and SharedPreferences
      apiClient.updateBaseUrl(normalized);
      _urlController.text = normalized;

      // Invalidate all cached network providers to fetch from new host
      ref.invalidate(inventoryListProvider);
      ref.invalidate(batchesListProvider);
      ref.invalidate(expiringBatchesProvider);
      ref.invalidate(transfersListProvider);
      ref.invalidate(pendingTransfersProvider);
      ref.invalidate(iotDevicesProvider);
      ref.invalidate(iotAlertsProvider);
      ref.invalidate(tasksListProvider);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(isReachable
                ? 'API Endpoint updated & verified online: $normalized'
                : 'API Endpoint updated: $normalized'),
            backgroundColor: isReachable ? AppColors.successGreen : AppColors.warningAmber,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _urlValidationMessage = e.toString().replaceAll('FormatException: ', ''));
      }
    } finally {
      if (mounted) {
        setState(() => _isTestingConnection = false);
      }
    }
  }

  void _handleSignOut() async {
    await ref.read(authNotifierProvider.notifier).signOut();
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final currentRole = user?.role ?? UserRole.operator;
    final pendingCount = ref.watch(pendingSyncCountProvider);

    return Scaffold(
      backgroundColor: AppColors.pureWhite,
      appBar: AppBar(
        title: const Text('Personnel & System Profile'),
        backgroundColor: AppColors.primaryNavy,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // User Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: AppColors.primaryNavy,
                    child: Text(
                      user != null && user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: AppColors.tealAccent,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? 'Authorized Personnel',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: AppColors.primaryNavy,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? '',
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
                        ),
                        const SizedBox(height: 6),
                        StatusBadge.status(status: currentRole.displayName, customColor: AppColors.tealAccent),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Operational Scoping
            const Text(
              'FACILITY & TENANT ACCESS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: AppColors.textSecondaryLight,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.pureWhite,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Icon(Icons.business_outlined, size: 20, color: AppColors.tealAccent),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Tenant Organization',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: AppColors.primaryNavy,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              user?.orgId ?? 'Unassigned Organization',
                              style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const Divider(height: 18),
                  Row(
                    children: [
                      const Icon(Icons.storefront_outlined, size: 20, color: AppColors.tealAccent),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.warehouseName ?? 'Unassigned Facility',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: AppColors.primaryNavy,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              user?.warehouseId != null
                                  ? 'Primary Facility ID: ${user!.warehouseId}'
                                  : 'Network-Wide Access Granted',
                              style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryLight),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Offline Sync Queue Status
            const Text(
              'TRANSACTION RESILIENCE & CACHE',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: AppColors.textSecondaryLight,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.pureWhite,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Pending Offline Queue',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppColors.primaryNavy),
                      ),
                      Text(
                        pendingCount == 0 ? 'All transactions synced with server' : '$pendingCount operations waiting for sync',
                        style: TextStyle(
                          fontSize: 11,
                          color: pendingCount == 0 ? AppColors.successGreen : AppColors.warningAmber,
                        ),
                      ),
                    ],
                  ),
                  if (pendingCount > 0)
                    ElevatedButton(
                      onPressed: () async {
                        await ref.read(localStorageProvider).clearQueue();
                        ref.invalidate(pendingSyncCountProvider);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.surfaceLight,
                        foregroundColor: AppColors.primaryNavy,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      ),
                      child: const Text('Flush Queue', style: TextStyle(fontSize: 11)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Server Host Configuration
            const Text(
              'GATEWAY CONNECTION CONFIG',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: AppColors.textSecondaryLight,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _urlController,
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace', color: AppColors.primaryNavy),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: AppColors.surfaceLight,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppColors.borderLight),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: const BorderSide(color: AppColors.borderLight),
                      ),
                      errorText: _urlValidationMessage,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _isTestingConnection ? null : _updateBaseUrl,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryNavy,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  ),
                  child: _isTestingConnection
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Save & Test', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                ),
              ],
            ),
            const SizedBox(height: 32),

            // Logout Button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _handleSignOut,
                icon: const Icon(Icons.logout, size: 18, color: AppColors.errorRed),
                label: const Text(
                  'Sign Out from StockPilot',
                  style: TextStyle(color: AppColors.errorRed, fontWeight: FontWeight.bold),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppColors.errorRed),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
