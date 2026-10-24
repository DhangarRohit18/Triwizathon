import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/task_model.dart';
import '../../../data/services/local_storage_service.dart';
import '../../inventory/providers/inventory_provider.dart';

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Local sample interactive tasks for warehouse floor operators
  final List<WarehouseTaskModel> _tasks = [
    WarehouseTaskModel(
      id: 'TASK-REC-01',
      title: 'Inbound Receipt: 500 vials Covaxin',
      description: 'Verify cold-chain tamper seals and temperature loggers for Batch #8821',
      type: TaskType.receiving,
      status: 'PENDING',
      priority: 'HIGH',
      assignedTo: 'Warehouse Operator',
      targetLocation: 'Zone A - Cold Room Bin 03',
      createdAt: DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
    ),
    WarehouseTaskModel(
      id: 'TASK-DISP-02',
      title: 'Dispatch Order: Apollo Hospital Central',
      description: 'Pick 200 vials Insulin Glargine (FEFO priority Batch #4412)',
      type: TaskType.dispatch,
      status: 'PENDING',
      priority: 'HIGH',
      assignedTo: 'Warehouse Operator',
      targetLocation: 'Dock 2 - Outbound Staging',
      createdAt: DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
    ),
    WarehouseTaskModel(
      id: 'TASK-COUNT-03',
      title: 'Cycle Count: Biologics Storage Rack B',
      description: 'Physical audit of Monoclonal Antibodies (SKU-MAB-ONC-04)',
      type: TaskType.cycleCount,
      status: 'PENDING',
      priority: 'MEDIUM',
      assignedTo: 'Warehouse Operator',
      targetLocation: 'Zone B - Shelf 12',
      createdAt: DateTime.now().subtract(const Duration(minutes: 45)).toIso8601String(),
    ),
    WarehouseTaskModel(
      id: 'TASK-DMG-04',
      title: 'Inspect Damaged Packaging: Adrenaline Ampoules',
      description: 'Report seal damage and record batch discrepancy for Batch #9931',
      type: TaskType.damage,
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      assignedTo: 'Warehouse Operator',
      targetLocation: 'Quarantine Bay Q-01',
      createdAt: DateTime.now().subtract(const Duration(minutes: 20)).toIso8601String(),
    ),
  ];

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

  void _toggleTaskStatus(int index) {
    setState(() {
      final current = _tasks[index];
      final newStatus = current.status == 'COMPLETED' ? 'PENDING' : 'COMPLETED';
      _tasks[index] = WarehouseTaskModel(
        id: current.id,
        title: current.title,
        description: current.description,
        type: current.type,
        status: newStatus,
        priority: current.priority,
        assignedTo: current.assignedTo,
        targetLocation: current.targetLocation,
        createdAt: current.createdAt,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final pendingCount = ref.watch(pendingSyncCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Warehouse Operations'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.tealAccent,
          labelColor: AppColors.tealAccent,
          unselectedLabelColor: AppColors.textSecondaryDark,
          tabs: [
            Tab(text: 'Floor Tasks (${_tasks.where((t) => t.status != "COMPLETED").length})'),
            Tab(text: 'Sync Queue ($pendingCount)'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Tab 1: Floor Tasks
          ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: _tasks.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final task = _tasks[index];
              final isDone = task.status == 'COMPLETED';

              return Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surfaceGraphite,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isDone
                        ? AppColors.borderGraphite
                        : AppColors.tealAccent.withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Checkbox(
                      value: isDone,
                      activeColor: AppColors.tealAccent,
                      checkColor: AppColors.navyDark,
                      onChanged: (_) => _toggleTaskStatus(index),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                task.id,
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: AppColors.tealAccent,
                                ),
                              ),
                              StatusBadge.status(status: task.status),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            task.title,
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              decoration: isDone ? TextDecoration.lineThrough : null,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            task.description,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.textSecondaryDark,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              const Icon(Icons.location_on_outlined, size: 14, color: AppColors.tealAccent),
                              const SizedBox(width: 4),
                              Text(
                                task.targetLocation,
                                style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),

          // Tab 2: Sync Queue (Offline drafts)
          FutureBuilder<List<Map<String, dynamic>>>(
            future: LocalStorageService.getPendingSyncQueue(),
            builder: (context, snapshot) {
              final items = snapshot.data ?? [];
              if (items.isEmpty) {
                return const EmptyState(
                  title: 'All operations synchronized',
                  subtitle: 'No offline drafts or pending actions waiting in the sync queue.',
                  icon: Icons.cloud_done_outlined,
                );
              }

              return ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final draft = items[index];
                  return Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceGraphite,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.warningAmber.withValues(alpha: 0.4)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              draft['action'] ?? 'PENDING_OPERATION',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppColors.warningAmber,
                              ),
                            ),
                            StatusBadge.status(status: 'DRAFT'),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Idempotency Key: ${draft['idempotency_key'] ?? "N/A"}',
                          style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Timestamp: ${draft['timestamp'] ?? ""}',
                          style: const TextStyle(fontSize: 11, color: AppColors.textSecondaryDark),
                        ),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ],
      ),
      bottomNavigationBar: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          color: AppColors.surfaceGraphite,
          border: Border(top: BorderSide(color: AppColors.borderGraphite)),
        ),
        child: Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.tealAccent,
                  foregroundColor: AppColors.navyDark,
                ),
                icon: const Icon(Icons.move_to_inbox),
                label: const Text('RECEIVE STOCK'),
                onPressed: () => context.push('/tasks/receive'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.infoBlue,
                  foregroundColor: Colors.white,
                ),
                icon: const Icon(Icons.outbox),
                label: const Text('DISPATCH STOCK'),
                onPressed: () => context.push('/tasks/dispatch'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
