import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_badge.dart';
import '../../../data/models/task_model.dart';
import '../providers/tasks_provider.dart';

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen>
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

  Future<void> _completeTask(WarehouseTaskModel task) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white,
        title: const Text('Confirm Task Completion', style: TextStyle(color: AppColors.primaryNavy, fontWeight: FontWeight.bold)),
        content: Text('Mark "${task.title}" as completed on warehouse floor?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textSecondaryLight)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.tealAccent, foregroundColor: Colors.white),
            child: const Text('Complete Task'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ref.read(taskRepositoryProvider).completeTask(task.id);
        ref.invalidate(tasksListProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Task "${task.title}" marked completed!'),
              backgroundColor: AppColors.successGreen,
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: AppColors.errorRed),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final tasksAsync = ref.watch(tasksListProvider);

    return Scaffold(
      backgroundColor: AppColors.pureWhite,
      appBar: AppBar(
        title: const Text('Warehouse Operations & Tasks'),
        backgroundColor: AppColors.primaryNavy,
        foregroundColor: Colors.white,
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.tealAccent,
          indicatorWeight: 3,
          labelColor: AppColors.tealAccent,
          unselectedLabelColor: Colors.white70,
          labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          tabs: const [
            Tab(text: 'Pending Tasks'),
            Tab(text: 'Completed'),
          ],
        ),
      ),
      body: tasksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.tealAccent)),
        error: (err, stack) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 48, color: AppColors.errorRed),
                const SizedBox(height: 12),
                Text('Failed to load tasks: $err', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.errorRed)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.invalidate(tasksListProvider),
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.primaryNavy),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (tasks) {
          final pending = tasks.where((t) => !t.isCompleted).toList();
          final completed = tasks.where((t) => t.isCompleted).toList();

          return TabBarView(
            controller: _tabController,
            children: [
              _buildTaskList(pending, isPending: true),
              _buildTaskList(completed, isPending: false),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/scan'),
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('SCAN ITEM'),
        backgroundColor: AppColors.tealAccent,
        foregroundColor: Colors.white,
      ),
    );
  }

  Widget _buildTaskList(List<WarehouseTaskModel> list, {required bool isPending}) {
    if (list.isEmpty) {
      return EmptyState(
        icon: isPending ? Icons.check_circle_outline : Icons.assignment_turned_in_outlined,
        title: isPending ? 'No Pending Tasks' : 'No Completed Tasks Yet',
        subtitle: isPending ? 'All warehouse operations are up to date' : 'Completed tasks will appear here',
      );
    }

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(tasksListProvider),
      color: AppColors.tealAccent,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: list.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final task = list[index];
          return Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.pureWhite,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.borderLight),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryNavy.withValues(alpha: 0.03),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        task.title,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                          color: AppColors.primaryNavy,
                        ),
                      ),
                    ),
                    StatusBadge.status(status: task.priority.toUpperCase()),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  task.description,
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondaryLight),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Icon(Icons.location_on_outlined, size: 14, color: AppColors.tealAccent),
                    const SizedBox(width: 4),
                    Text(
                      task.targetLocation,
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.primaryNavy),
                    ),
                    const Spacer(),
                    if (isPending)
                      ElevatedButton.icon(
                        onPressed: () => _completeTask(task),
                        icon: const Icon(Icons.check, size: 14),
                        label: const Text('Complete', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.tealAccent,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          minimumSize: Size.zero,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                        ),
                      )
                    else
                      const Row(
                        children: [
                          Icon(Icons.check_circle, size: 14, color: AppColors.successGreen),
                          SizedBox(width: 4),
                          Text('COMPLETED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.successGreen)),
                        ],
                      ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
