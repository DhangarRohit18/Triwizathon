import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockpilot_mobile/app/app.dart';
import 'package:stockpilot_mobile/features/auth/providers/auth_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('StockPilotApp boots and renders login screen smoke test', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
        ],
        child: const StockPilotApp(),
      ),
    );

    // Initial pump
    await tester.pumpAndSettle();

    // Verify StockPilot AI branding is present on screen
    expect(find.text('STOCKPILOT AI'), findsWidgets);
  });
}
