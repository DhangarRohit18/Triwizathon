import 'dart:developer' as developer;
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'features/auth/providers/auth_provider.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize SharedPreferences for local caching and offline queues
  final prefs = await SharedPreferences.getInstance();

  // Initialize Firebase using the shared 'triwizathon' project configuration
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    developer.log('Firebase initialized successfully for StockPilot AI (triwizathon)');
  } catch (e) {
    // If native google-services.json is not configured or in offline test environment,
    // gracefully continue so the app still runs seamlessly with FastAPI & local storage.
    developer.log('Firebase initialization skipped or failed: $e');
  }

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ],
      child: const StockPilotApp(),
    ),
  );
}
