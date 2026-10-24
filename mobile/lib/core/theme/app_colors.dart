import 'package:flutter/material.dart';

/// StockPilot AI Enterprise Minimal 3-Color Design System:
/// 1. Pure White: #FFFFFF
/// 2. Deep Navy:  #17324D
/// 3. Teal:       #0D9488
class AppColors {
  // Brand Palette - Strict 3-Color Enterprise System
  // 1. Pure White: #FFFFFF
  static const Color pureWhite = Color(0xFFFFFFFF);
  static const Color surfaceCardLight = Color(0xFFFFFFFF);
  static const Color surfaceLight = Color(0xFFFFFFFF);

  // 2. Deep Navy: #17324D
  static const Color primaryNavy = Color(0xFF17324D);
  static const Color textPrimaryLight = Color(0xFF17324D);
  static const Color textSecondaryLight = Color(0xB317324D); // Opacity variation
  static const Color textMutedLight = Color(0x8017324D);
  static const Color borderLight = Color(0x2617324D); // Restrained hairline border
  static const Color navyDark = Color(0xFF17324D);
  static const Color surfaceDark = Color(0xFF17324D);
  static const Color surfaceCardDark = Color(0xFF17324D);
  static const Color borderDark = Color(0x33FFFFFF);

  // 3. Teal: #0D9488
  static const Color accentTeal = Color(0xFF0D9488);
  static const Color tealAccent = Color(0xFF0D9488);
  static const Color accentCyan = Color(0xFF0D9488);
  static const Color accentBlue = Color(0xFF0D9488);

  // Status & Operational Indicators using approved 3-color palette
  static const Color success = Color(0xFF0D9488);
  static const Color successBg = Color(0x1A0D9488);
  static const Color successGreen = Color(0xFF0D9488);

  static const Color warning = Color(0xFF17324D);
  static const Color warningBg = Color(0x1A17324D);
  static const Color warningAmber = Color(0xFF17324D);

  static const Color error = Color(0xFF17324D);
  static const Color errorBg = Color(0x1A17324D);
  static const Color errorRed = Color(0xFF17324D);

  static const Color coldChain = Color(0xFF0D9488);
  static const Color coldChainBg = Color(0x1A0D9488);

  // Dark Surface Typography (White on Navy)
  static const Color textPrimaryDark = Color(0xFFFFFFFF);
  static const Color textSecondaryDark = Color(0xB3FFFFFF);
  static const Color textMutedDark = Color(0x80FFFFFF);

  // Convenience Aliases
  static const Color surfaceGraphite = Color(0xFF17324D);
  static const Color borderGraphite = Color(0x2617324D);
  static const Color infoBlue = Color(0xFF0D9488);
  static const Color statusDraft = Color(0x8017324D);
}
