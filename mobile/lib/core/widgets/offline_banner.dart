import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class OfflineBanner extends StatelessWidget {
  final bool isOffline;
  final int pendingCount;
  final VoidCallback? onSyncNow;

  const OfflineBanner({
    super.key,
    this.isOffline = false,
    this.pendingCount = 0,
    this.onSyncNow,
  });

  @override
  Widget build(BuildContext context) {
    if (!isOffline && pendingCount == 0) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: isOffline ? AppColors.warningBg : AppColors.accentCyan.withValues(alpha: 0.12),
      child: Row(
        children: [
          Icon(
            isOffline ? Icons.wifi_off : Icons.sync,
            size: 14,
            color: isOffline ? AppColors.warning : AppColors.accentCyan,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              isOffline
                ? 'Offline Mode. Actions stored in local queue ($pendingCount pending).'
                : '$pendingCount pending action(s) ready to synchronize.',
              style: TextStyle(
                color: isOffline ? AppColors.warning : AppColors.accentCyan,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (onSyncNow != null && !isOffline)
            TextButton(
              onPressed: onSyncNow,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('SYNC NOW', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
    );
  }
}
