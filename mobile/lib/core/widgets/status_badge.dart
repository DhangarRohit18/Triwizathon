import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

enum BadgeVariant {
  success,
  warning,
  error,
  info,
  coldChain,
  neutral,
}

class StatusBadge extends StatelessWidget {
  final String label;
  final BadgeVariant variant;
  final IconData? icon;
  final Color? customColor;

  const StatusBadge({
    super.key,
    required this.label,
    this.variant = BadgeVariant.neutral,
    this.icon,
    this.customColor,
  });

  factory StatusBadge.status({
    required String status,
    Color? customColor,
  }) {
    final s = status.toUpperCase();
    BadgeVariant v = BadgeVariant.neutral;
    IconData? ic;

    if (s.contains('PENDING') || s.contains('DRAFT')) {
      v = BadgeVariant.warning;
      ic = Icons.hourglass_top;
    } else if (s.contains('APPROV') || s.contains('COMPLET') || s.contains('ONLINE') || s.contains('ACTIVE')) {
      v = BadgeVariant.success;
      ic = Icons.check_circle_outline;
    } else if (s.contains('REJECT') || s.contains('BREACH') || s.contains('OFFLINE') || s.contains('FAIL')) {
      v = BadgeVariant.error;
      ic = Icons.cancel_outlined;
    } else if (s.contains('TRANSIT')) {
      v = BadgeVariant.info;
      ic = Icons.local_shipping_outlined;
    }

    return StatusBadge(
      label: status,
      variant: v,
      icon: ic,
      customColor: customColor,
    );
  }

  factory StatusBadge.severity({required String severity}) {
    final s = severity.toUpperCase();
    if (s.contains('CRITICAL') || s.contains('HIGH') || s.contains('BREACH') || s.contains('URGENT')) {
      return StatusBadge(
        label: severity,
        variant: BadgeVariant.error,
        icon: Icons.warning_amber_rounded,
        customColor: AppColors.errorRed,
      );
    } else if (s.contains('WARNING') || s.contains('MEDIUM')) {
      return StatusBadge(
        label: severity,
        variant: BadgeVariant.warning,
        icon: Icons.info_outline,
        customColor: AppColors.warningAmber,
      );
    }
    return StatusBadge(
      label: severity,
      variant: BadgeVariant.info,
      icon: Icons.check_circle_outline,
      customColor: AppColors.tealAccent,
    );
  }

  factory StatusBadge.storage({required String type}) {
    final t = type.toUpperCase();
    if (t.contains('COLD') || t.contains('FROZEN')) {
      return StatusBadge(
        label: type,
        variant: BadgeVariant.coldChain,
        icon: Icons.ac_unit,
      );
    }
    return StatusBadge(
      label: type,
      variant: BadgeVariant.neutral,
      icon: Icons.inventory_2_outlined,
    );
  }

  factory StatusBadge.fefo({required int daysUntilExpiry}) {
    if (daysUntilExpiry <= 0) {
      return const StatusBadge(
        label: 'EXPIRED',
        variant: BadgeVariant.error,
        icon: Icons.error_outline,
      );
    } else if (daysUntilExpiry <= 30) {
      return StatusBadge(
        label: 'EXP: ${daysUntilExpiry}d (FEFO)',
        variant: BadgeVariant.warning,
        icon: Icons.warning_amber_rounded,
      );
    } else {
      return StatusBadge(
        label: 'EXP: ${daysUntilExpiry}d',
        variant: BadgeVariant.success,
        icon: Icons.calendar_today_outlined,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    Color border;

    if (customColor != null) {
      fg = customColor!;
      bg = customColor!.withValues(alpha: 0.12);
      border = customColor!.withValues(alpha: 0.3);
    } else {
      switch (variant) {
        case BadgeVariant.success:
          bg = AppColors.successBg;
          fg = AppColors.successGreen;
          border = AppColors.successGreen.withValues(alpha: 0.3);
          break;
        case BadgeVariant.warning:
          bg = AppColors.warningBg;
          fg = AppColors.warningAmber;
          border = AppColors.warningAmber.withValues(alpha: 0.3);
          break;
        case BadgeVariant.error:
          bg = AppColors.errorBg;
          fg = AppColors.errorRed;
          border = AppColors.errorRed.withValues(alpha: 0.3);
          break;
        case BadgeVariant.coldChain:
          bg = AppColors.coldChainBg;
          fg = AppColors.coldChain;
          border = AppColors.coldChain.withValues(alpha: 0.3);
          break;
        case BadgeVariant.info:
          bg = AppColors.accentCyan.withValues(alpha: 0.12);
          fg = AppColors.accentCyan;
          border = AppColors.accentCyan.withValues(alpha: 0.25);
          break;
        case BadgeVariant.neutral:
          bg = Colors.white.withValues(alpha: 0.06);
          fg = AppColors.textSecondaryDark;
          border = AppColors.borderDark;
          break;
      }
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: border, width: 0.8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: fg,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
        ],
      ),
    );
  }
}
