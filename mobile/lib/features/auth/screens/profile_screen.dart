import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/api_config.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/user_model.dart';
import '../../../data/services/local_storage_service.dart';
import '../../inventory/providers/inventory_provider.dart';
import '../providers/auth_provider.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _urlController = TextEditingController();

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

  void _switchRole(UserRole newRole) {
    ref.read(authNotifierProvider.notifier).switchRole(newRole);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Switched persona to ${newRole.displayName}'),
        backgroundColor: AppColors.tealAccent,
      ),
    );
  }

  void _updateBaseUrl() {
    final newUrl = _urlController.text.trim();
    if (newUrl.isNotEmpty) {
      ApiConfig.setCustomBaseUrl(newUrl);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('API Server URL updated to: $newUrl'),
          backgroundColor: AppColors.successGreen,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final currentRole = user?.role ?? UserRole.warehouseOperator;
    final pendingCount = ref.watch(pendingSyncCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Personnel & System Profile'),
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
                color: AppColors.surfaceGraphite,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.borderGraphite),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: AppColors.tealAccent.withValues(alpha: 0.2),
                    child: Text(
                      user != null && user.name.isNotEmpty ? user.name[0] : 'U',
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
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          user?.email ?? 'operator@stockpilot.ai',
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            StatusBadge.status(
                              status: currentRole.displayName.toUpperCase(),
                              customColor: AppColors.tealAccent,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              user?.organizationId ?? 'org_triwiz_01',
                              style: const TextStyle(fontSize: 10, fontFamily: 'monospace', color: AppColors.textSecondaryDark),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Active Facility
            const Text(
              'ASSIGNED WAREHOUSE FACILITY',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.navyDark,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.borderGraphite),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warehouse_outlined, color: AppColors.tealAccent, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.warehouseName ?? 'Central Distribution Hub (Bengaluru)',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        Text(
                          'ID: ${user?.warehouseId ?? "WH-CENTRAL-01"} • Cold-Chain Certified',
                          style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Interactive Role Switcher
            const Text(
              'SWITCH EVALUATION ROLE (TRIWIZATHON)',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 4),
            const Text(
              'Switching roles immediately adapts permissions, dashboards, and operational controls:',
              style: TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: UserRole.values.map((role) {
                final isSelected = role == currentRole;
                return ChoiceChip(
                  label: Text(role.displayName),
                  selected: isSelected,
                  selectedColor: AppColors.tealAccent,
                  labelStyle: TextStyle(
                    color: isSelected ? AppColors.navyDark : Colors.white,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    fontSize: 12,
                  ),
                  backgroundColor: AppColors.surfaceGraphite,
                  onSelected: (_) => _switchRole(role),
                );
              }).toList(),
            ),
            const SizedBox(height: 24),

            // Backend Server Network Endpoint
            const Text(
              'FASTAPI BACKEND NETWORK HOST',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _urlController,
                    decoration: const InputDecoration(
                      hintText: 'http://10.0.2.2:8000',
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.tealAccent,
                    foregroundColor: AppColors.navyDark,
                  ),
                  onPressed: _updateBaseUrl,
                  child: const Text('Save'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              '• 10.0.2.2:8000: Android Studio Emulator host loopback\n• 127.0.0.1:8000: Desktop / Local machine\n• 192.168.x.x:8000: Physical phone over Wi-Fi',
              style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 24),

            // Offline Sync Queue status
            const Text(
              'OFFLINE RESILIENCE STATUS',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.textSecondaryDark),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surfaceGraphite,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.borderGraphite),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Pending Sync Operations', style: TextStyle(fontSize: 12)),
                      Text(
                        '$pendingCount draft actions queued',
                        style: TextStyle(
                          fontSize: 11,
                          color: pendingCount > 0 ? AppColors.warningAmber : AppColors.successGreen,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  if (pendingCount > 0)
                    TextButton(
                      onPressed: () async {
                        await LocalStorageService.clearPendingSyncQueue();
                        ref.invalidate(pendingSyncCountProvider);
                      },
                      child: const Text('Clear Queue', style: TextStyle(color: AppColors.errorRed, fontSize: 11)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 32),

            // Sign Out
            SizedBox(
              width: double.infinity,
              height: 48,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.errorRed,
                  side: const BorderSide(color: AppColors.errorRed),
                ),
                icon: const Icon(Icons.logout),
                label: const Text('SIGN OUT OF STOCKPILOT'),
                onPressed: () {
                  ref.read(authNotifierProvider.notifier).signOut();
                  context.go('/login');
                },
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
