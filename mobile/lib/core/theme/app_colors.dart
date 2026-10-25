import 'package:flutter/material.dart';

/// StockPilot AI Enterprise Design System:
/// 1. Pure White: #FFFFFF (Background & Surfaces)
/// 2. Deep Navy:  #17324D (Primary Brand, Headers, Navigation)
/// 3. Teal:       #0D9488 (Interactive Accent & Primary Actions)
class AppColors {
  // Brand Palette - Strict Enterprise System
  // 1. Pure White: #FFFFFF
  static const Color pureWhite = Color(0xFFFFFFFF);
  static const Color surfaceCardLight = Color(0xFFFFFFFF);
  static const Color surfaceLight = Color(0xFFF8FAFC);

  // 2. Deep Navy: #17324D
  static const Color primaryNavy = Color(0xFF17324D);
  static const Color textPrimaryLight = Color(0xFF17324D);
  static const Color textSecondaryLight = Color(0xB317324D);
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

  // Accessible Status Indicators with paired text + backgrounds
  static const Color success = Color(0xFF059669);
  static const Color successBg = Color(0xFFECFDF5);
  static const Color successGreen = Color(0xFF059669);

  static const Color warning = Color(0xFFD97706);
  static const Color warningBg = Color(0xFFFFFBEB);
  static const Color warningAmber = Color(0xFFD97706);

  static const Color error = Color(0xFFE11D48);
  static const Color errorBg = Color(0xFFFFF1F2);
  static const Color errorRed = Color(0xFFE11D48);

  static const Color coldChain = Color(0xFF0D9488);
  static const Color coldChainBg = Color(0xFFF0FDFA);

  // Enterprise Light Palette Aliases
  static const Color surfaceGraphite = Color(0xFFF8FAFC);
  static const Color borderGraphite = Color(0x2617324D);
  static const Color textPrimaryDark = Color(0xFF17324D);
  static const Color textSecondaryDark = Color(0xB317324D);
  static const Color textMutedDark = Color(0x8017324D);
  static const Color infoBlue = Color(0xFF0D9488);
  static const Color statusDraft = Color(0x8017324D);
}
