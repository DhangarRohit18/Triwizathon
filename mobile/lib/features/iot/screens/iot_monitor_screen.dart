import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/iot_model.dart';
import '../../../data/models/user_model.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/iot_provider.dart';

class IotMonitorScreen extends ConsumerStatefulWidget {
  const IotMonitorScreen({super.key});

  @override
  ConsumerState<IotMonitorScreen> createState() => _IotMonitorScreenState();
}

class _IotMonitorScreenState extends ConsumerState<IotMonitorScreen>
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

  Future<void> _acknowledgeAlert(String alertId) async {
    try {
      final repo = ref.read(iotRepositoryProvider);
      await repo.acknowledgeAlert(alertId);
      ref.invalidate(iotAlertsProvider);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Alert acknowledged successfully'),
          backgroundColor: AppColors.successGreen,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to acknowledge alert: $e'),
          backgroundColor: AppColors.errorRed,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final devicesAsync = ref.watch(iotDevicesProvider);
    final alertsAsync = ref.watch(iotAlertsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cold Chain IoT Telemetry'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.tealAccent,
          labelColor: AppColors.tealAccent,
          unselectedLabelColor: AppColors.textSecondaryDark,
          tabs: const [
            Tab(text: 'Sensor Devices'),
            Tab(text: 'Excursion Alerts'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Tab 1: Sensor Devices
          devicesAsync.when(
            data: (devices) {
              if (devices.isEmpty) {
                return const EmptyState(
                  title: 'No sensor devices connected',
                  subtitle: 'No telemetry loggers registered for this warehouse facility.',
                  icon: Icons.sensors_off_outlined,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(iotDevicesProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: devices.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final d = devices[index];
                    return _buildDeviceCard(context, d);
                  },
                ),
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(child: Text('Error: $err')),
          ),

          // Tab 2: Excursion Alerts
          alertsAsync.when(
            data: (alerts) {
              if (alerts.isEmpty) {
                return const EmptyState(
                  title: 'Cold Chain Nominal',
                  subtitle: 'No active temperature or humidity breaches detected.',
                  icon: Icons.check_circle_outline,
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(iotAlertsProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: alerts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final a = alerts[index];
                    return _buildAlertCard(context, a);
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

  Widget _buildDeviceCard(BuildContext context, IoTDeviceModel d) {
    final isOnline = d.isOnline;
    final isBreach = d.isBreached;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isBreach
              ? AppColors.errorRed.withValues(alpha: 0.6)
              : AppColors.borderGraphite,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.sensors,
                    size: 18,
                    color: isBreach ? AppColors.errorRed : AppColors.tealAccent,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    d.deviceId,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
              StatusBadge.status(
                status: d.isStale
                    ? 'STALE'
                    : (isOnline ? 'ONLINE' : 'OFFLINE'),
                customColor: d.isStale
                    ? AppColors.warningAmber
                    : (isOnline ? AppColors.successGreen : AppColors.textSecondaryDark),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${d.locationDescription} • ${d.warehouseName}${d.lastSeenText != null ? " • ${d.lastSeenText}" : ""}',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryDark),
          ),
          const SizedBox(height: 14),

          // Gauge dials row
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isBreach ? AppColors.errorRed : AppColors.borderGraphite,
                    ),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'TEMPERATURE',
                        style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${d.temperature.toStringAsFixed(1)}°C',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: isBreach ? AppColors.errorRed : AppColors.tealAccent,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Safe: ${d.minTemp}°C - ${d.maxTemp}°C',
                        style: const TextStyle(fontSize: 9, color: AppColors.textSecondaryDark),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.borderGraphite),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'HUMIDITY',
                        style: TextStyle(fontSize: 10, color: AppColors.textSecondaryDark),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${d.humidity.toStringAsFixed(1)}%',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppColors.infoBlue,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Battery: ${d.batteryLevel}%',
                        style: const TextStyle(fontSize: 9, color: AppColors.textSecondaryDark),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildAlertCard(BuildContext context, IoTAlertModel a) {
    final user = ref.watch(authNotifierProvider).user;
    final canManageAlerts = user?.hasPermission('alerts:manage') ?? (user?.role != UserRole.operator && user?.role != UserRole.distributor);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceGraphite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: a.acknowledged
              ? AppColors.borderGraphite
              : AppColors.errorRed.withValues(alpha: 0.6),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.errorRed),
                  const SizedBox(width: 8),
                  Text(
                    a.severity,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      color: AppColors.errorRed,
                    ),
                  ),
                  if (a.isSimulated) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.warningAmber.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                        border: Border.all(color: AppColors.warningAmber.withValues(alpha: 0.4)),
                      ),
                      child: const Text(
                        'SIMULATED',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: AppColors.warningAmber,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              StatusBadge.status(
                status: a.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE',
                customColor: a.acknowledged ? AppColors.textSecondaryDark : AppColors.errorRed,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            a.message,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            'Device: ${a.deviceId} • Detected: ${a.timestamp.split("T").first}',
            style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
          ),
          if (!a.acknowledged && canManageAlerts) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.errorRed,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                ),
                icon: const Icon(Icons.check, size: 16),
                label: const Text('ACKNOWLEDGE ALARM'),
                onPressed: () => _acknowledgeAlert(a.id),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
